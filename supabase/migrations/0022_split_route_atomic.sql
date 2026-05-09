-- =============================================================================
-- 0022_split_route_atomic.sql
-- Phase 4: atomic route split execution.
--
-- split_route_atomic performs in a single transaction:
--   1. INSERT new segment B route and branch route into routes table.
--   2. Reassign trail_cells for segment B and branch.
--   3. Reassign trail_cell_transitions accordingly.
--   4. Transfer candidate cluster cells → trail_cells for branch route.
--   5. Recompute session_route_assignments based on contributing_sessions.
--   6. Clean up candidate_cells, candidate_cell_transitions,
--      and route_to_candidate_transitions for the processed cluster.
--
-- The original route_id is preserved as segment A (the "keep" segment).
-- Segment B and branch get new route IDs supplied by the caller.
-- =============================================================================

create function public.split_route_atomic(
  p_mountain_id              text,
  p_original_route_id        text,
  p_branch_point_cell_key    text,
  p_segment_b_route_id       text,
  p_segment_b_cell_keys      text[],
  p_branch_route_id          text,
  p_branch_cell_keys         text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mountain_id text;
  v_display_name text;
  v_seg_b_key text;
  v_branch_key text;
  v_session_ids uuid[];
  v_session_id uuid;
begin
  -- ── 0. Resolve mountain_id from original route ────────────────────────────

  select mountain_id, display_name
    into v_mountain_id, v_display_name
    from public.routes
   where id = p_original_route_id;

  if not found then
    raise exception 'Route % not found', p_original_route_id;
  end if;

  -- ── 1. Insert new routes ──────────────────────────────────────────────────

  insert into public.routes (id, mountain_id, display_name)
  values
    (p_segment_b_route_id, v_mountain_id, v_display_name || ' (cont.)'),
    (p_branch_route_id,    v_mountain_id, 'New Branch');

  -- ── 2. Reassign trail_cells for segment B ────────────────────────────────

  update public.trail_cells
     set route_id = p_segment_b_route_id
   where route_id = p_original_route_id
     and cell_key = any(p_segment_b_cell_keys)
     and cell_key <> p_branch_point_cell_key;

  -- Branch point cell C stays in segment A (original route).
  -- It is duplicated into segment B so both sides match correctly.

  insert into public.trail_cells (
    route_id, cell_key, geom,
    point_count, session_count, contributing_sessions,
    avg_accuracy, avg_altitude, last_seen_at, quality_score
  )
  select
    p_segment_b_route_id,
    cell_key,
    geom,
    point_count,
    session_count,
    contributing_sessions,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    quality_score
  from public.trail_cells
  where route_id = p_original_route_id
    and cell_key = p_branch_point_cell_key
  on conflict (route_id, cell_key) do nothing;

  -- ── 3. Reassign trail_cell_transitions for segment B ─────────────────────

  -- Transitions where both cells are in segment B (excluding branch point)
  update public.trail_cell_transitions
     set route_id = p_segment_b_route_id
   where route_id = p_original_route_id
     and from_cell_key = any(p_segment_b_cell_keys)
     and to_cell_key   = any(p_segment_b_cell_keys)
     and from_cell_key <> p_branch_point_cell_key
     and to_cell_key   <> p_branch_point_cell_key;

  -- Transitions crossing the branch point (branch_point → seg_b or seg_b → branch_point)
  -- duplicate into segment B so path traversal works in both directions
  insert into public.trail_cell_transitions (
    route_id, from_cell_key, to_cell_key,
    transition_count, session_count, contributing_sessions, edge_cost
  )
  select
    p_segment_b_route_id,
    from_cell_key,
    to_cell_key,
    transition_count,
    session_count,
    contributing_sessions,
    edge_cost
  from public.trail_cell_transitions
  where route_id = p_original_route_id
    and (
      (from_cell_key = p_branch_point_cell_key and to_cell_key = any(p_segment_b_cell_keys))
      or
      (to_cell_key = p_branch_point_cell_key and from_cell_key = any(p_segment_b_cell_keys))
    )
  on conflict (route_id, from_cell_key, to_cell_key) do nothing;

  -- ── 4. Transfer candidate cluster cells → trail_cells (branch route) ─────

  insert into public.trail_cells (
    route_id, cell_key, geom,
    point_count, session_count, contributing_sessions,
    avg_accuracy, avg_altitude, last_seen_at, quality_score
  )
  select
    p_branch_route_id,
    cell_key,
    geom,
    point_count,
    session_count,
    contributing_sessions,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    coalesce(
      case
        when avg_accuracy is not null
          then greatest(0, least(1, 1 - avg_accuracy / 100))
        else 0.7
      end,
      0.7
    )
  from public.candidate_cells
  where mountain_id = p_mountain_id
    and cell_key = any(p_branch_cell_keys)
  on conflict (route_id, cell_key) do nothing;

  -- Also duplicate branch point cell C into branch route so it connects
  insert into public.trail_cells (
    route_id, cell_key, geom,
    point_count, session_count, contributing_sessions,
    avg_accuracy, avg_altitude, last_seen_at, quality_score
  )
  select
    p_branch_route_id,
    cell_key,
    geom,
    point_count,
    session_count,
    contributing_sessions,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    quality_score
  from public.trail_cells
  where route_id = p_original_route_id
    and cell_key = p_branch_point_cell_key
  on conflict (route_id, cell_key) do nothing;

  -- Transfer transitions between candidate cells (F→G)
  insert into public.trail_cell_transitions (
    route_id, from_cell_key, to_cell_key,
    transition_count, session_count, contributing_sessions, edge_cost
  )
  select
    p_branch_route_id,
    from_cell_key,
    to_cell_key,
    transition_count,
    session_count,
    contributing_sessions,
    1.0 / greatest(1, transition_count)
  from public.candidate_cell_transitions
  where mountain_id = p_mountain_id
    and from_cell_key = any(p_branch_cell_keys)
    and to_cell_key   = any(p_branch_cell_keys)
  on conflict (route_id, from_cell_key, to_cell_key) do nothing;

  -- Transfer C→F cross transition into branch route trail_cell_transitions
  insert into public.trail_cell_transitions (
    route_id, from_cell_key, to_cell_key,
    transition_count, session_count, contributing_sessions, edge_cost
  )
  select
    p_branch_route_id,
    from_cell_key,
    to_cell_key,
    transition_count,
    session_count,
    contributing_sessions,
    1.0 / greatest(1, transition_count)
  from public.route_to_candidate_transitions
  where route_id  = p_original_route_id
    and direction = 'route_to_candidate'
    and from_cell_key = p_branch_point_cell_key
    and to_cell_key   = any(p_branch_cell_keys)
  on conflict (route_id, from_cell_key, to_cell_key) do nothing;

  -- ── 5. Recompute session_route_assignments ────────────────────────────────
  -- For each session that was assigned to the original route:
  --   - Keep (session, segmentA) if the session touched any segmentA cell
  --   - Add  (session, segmentB) if the session touched any segmentB cell
  --   - Add  (session, branch)   if the session touched any branch cluster cell
  -- Cell ownership is determined via trail_cells.contributing_sessions.

  -- Sessions in segment B
  select array_agg(distinct s)
    into v_session_ids
    from (
      select unnest(contributing_sessions) as s
        from public.trail_cells
       where route_id = p_segment_b_route_id
    ) sub;

  if v_session_ids is not null then
    foreach v_session_id in array v_session_ids
    loop
      insert into public.session_route_assignments
        (session_id, route_id, contributed_cell_count, contributed_transition_count)
      values (
        v_session_id,
        p_segment_b_route_id,
        (select count(*)::integer from public.trail_cells
          where route_id = p_segment_b_route_id
            and v_session_id = any(contributing_sessions)),
        (select count(*)::integer from public.trail_cell_transitions
          where route_id = p_segment_b_route_id
            and v_session_id = any(contributing_sessions))
      )
      on conflict (session_id, route_id) do nothing;
    end loop;
  end if;

  -- Sessions in branch route
  select array_agg(distinct s)
    into v_session_ids
    from (
      select unnest(contributing_sessions) as s
        from public.trail_cells
       where route_id = p_branch_route_id
    ) sub;

  if v_session_ids is not null then
    foreach v_session_id in array v_session_ids
    loop
      insert into public.session_route_assignments
        (session_id, route_id, contributed_cell_count, contributed_transition_count)
      values (
        v_session_id,
        p_branch_route_id,
        (select count(*)::integer from public.trail_cells
          where route_id = p_branch_route_id
            and v_session_id = any(contributing_sessions)),
        (select count(*)::integer from public.trail_cell_transitions
          where route_id = p_branch_route_id
            and v_session_id = any(contributing_sessions))
      )
      on conflict (session_id, route_id) do nothing;
    end loop;
  end if;

  -- Remove original-route assignments for sessions that no longer touch any
  -- segment A cell (they went entirely to branch or segment B).
  delete from public.session_route_assignments sra
   where sra.route_id = p_original_route_id
     and not exists (
       select 1 from public.trail_cells tc
        where tc.route_id = p_original_route_id
          and sra.session_id = any(tc.contributing_sessions)
     );

  -- ── 6. Clean up candidate data ────────────────────────────────────────────

  delete from public.candidate_cell_transitions
   where mountain_id = p_mountain_id
     and from_cell_key = any(p_branch_cell_keys)
     and to_cell_key   = any(p_branch_cell_keys);

  delete from public.route_to_candidate_transitions
   where route_id = p_original_route_id
     and (
       from_cell_key = any(p_branch_cell_keys)
       or to_cell_key = any(p_branch_cell_keys)
     );

  delete from public.candidate_cells
   where mountain_id = p_mountain_id
     and cell_key = any(p_branch_cell_keys);

end;
$$;
