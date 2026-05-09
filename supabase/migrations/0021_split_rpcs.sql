-- =============================================================================
-- 0021_split_rpcs.sql
-- Phase 2: accumulation RPC updates and new cross-transition RPCs.
--
-- (1) Recreate accumulate_trail_cells and accumulate_trail_transitions with
--     p_session_id so they track contributing_sessions per cell.
-- (2) New accumulate_candidate_transitions — stores F→G within a cluster.
-- (3) New accumulate_route_to_candidate_transitions — stores C→F cross-boundary.
-- (4) Query helpers for the two new transition tables.
-- =============================================================================

-- ── 1. accumulate_trail_cells — add session tracking ─────────────────────────

drop function if exists public.accumulate_trail_cells(text, jsonb);

create function public.accumulate_trail_cells(
  p_route_id   text,
  p_session_id uuid,
  p_cells      jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c       jsonb;
  p_count integer;
  p_lon   double precision;
  p_lat   double precision;
begin
  for c in select * from jsonb_array_elements(p_cells)
  loop
    p_count := (c->>'pointCount')::integer;
    p_lon   := (c->>'lon')::double precision;
    p_lat   := (c->>'lat')::double precision;

    insert into public.trail_cells (
      route_id, cell_key, geom,
      point_count, session_count, contributing_sessions,
      avg_accuracy, avg_altitude, last_seen_at, quality_score
    )
    values (
      p_route_id,
      c->>'cellKey',
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
      p_count,
      1,
      array[p_session_id],
      (c->>'avgAccuracy')::double precision,
      (c->>'avgAltitude')::double precision,
      (c->>'lastSeenAt')::timestamptz,
      (c->>'qualityScore')::double precision
    )
    on conflict (route_id, cell_key) do update set
      geom = st_setsrid(st_makepoint(
        (trail_cells.point_count * st_x(trail_cells.geom::geometry) + p_count * p_lon) /
          (trail_cells.point_count + p_count),
        (trail_cells.point_count * st_y(trail_cells.geom::geometry) + p_count * p_lat) /
          (trail_cells.point_count + p_count)
      ), 4326)::geography,
      point_count          = trail_cells.point_count + p_count,
      session_count        = trail_cells.session_count +
        case when p_session_id = any(trail_cells.contributing_sessions) then 0 else 1 end,
      contributing_sessions = case
        when p_session_id = any(trail_cells.contributing_sessions)
          then trail_cells.contributing_sessions
        else array_append(trail_cells.contributing_sessions, p_session_id)
      end,
      avg_accuracy  = case
        when trail_cells.avg_accuracy is null then (c->>'avgAccuracy')::double precision
        when (c->>'avgAccuracy') is null       then trail_cells.avg_accuracy
        else (trail_cells.avg_accuracy * trail_cells.point_count +
              (c->>'avgAccuracy')::double precision * p_count) /
             (trail_cells.point_count + p_count)
      end,
      avg_altitude  = case
        when trail_cells.avg_altitude is null then (c->>'avgAltitude')::double precision
        when (c->>'avgAltitude') is null       then trail_cells.avg_altitude
        else (trail_cells.avg_altitude * trail_cells.point_count +
              (c->>'avgAltitude')::double precision * p_count) /
             (trail_cells.point_count + p_count)
      end,
      last_seen_at  = greatest(trail_cells.last_seen_at, (c->>'lastSeenAt')::timestamptz),
      quality_score = greatest(0, least(1,
        case
          when trail_cells.avg_accuracy is null then (c->>'qualityScore')::double precision
          when (c->>'avgAccuracy') is null       then trail_cells.quality_score
          else 1 - (trail_cells.avg_accuracy * trail_cells.point_count +
                    (c->>'avgAccuracy')::double precision * p_count) /
                   (trail_cells.point_count + p_count) / 100
        end
      ));
  end loop;
end;
$$;

-- ── 2. accumulate_trail_transitions — add session tracking ────────────────────

drop function if exists public.accumulate_trail_transitions(text, jsonb);

create function public.accumulate_trail_transitions(
  p_route_id    text,
  p_session_id  uuid,
  p_transitions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t       jsonb;
  p_count integer;
begin
  for t in select * from jsonb_array_elements(p_transitions)
  loop
    p_count := (t->>'transitionCount')::integer;

    insert into public.trail_cell_transitions (
      route_id, from_cell_key, to_cell_key,
      transition_count, session_count, contributing_sessions, edge_cost
    )
    values (
      p_route_id,
      t->>'fromCellKey',
      t->>'toCellKey',
      p_count,
      1,
      array[p_session_id],
      1.0 / greatest(1, p_count)
    )
    on conflict (route_id, from_cell_key, to_cell_key) do update set
      transition_count     = trail_cell_transitions.transition_count + p_count,
      session_count        = trail_cell_transitions.session_count +
        case when p_session_id = any(trail_cell_transitions.contributing_sessions) then 0 else 1 end,
      contributing_sessions = case
        when p_session_id = any(trail_cell_transitions.contributing_sessions)
          then trail_cell_transitions.contributing_sessions
        else array_append(trail_cell_transitions.contributing_sessions, p_session_id)
      end,
      edge_cost = 1.0 / greatest(1, trail_cell_transitions.transition_count + p_count);
  end loop;
end;
$$;

-- ── 3. accumulate_candidate_transitions ───────────────────────────────────────
-- Stores transitions between candidate cells (e.g. F→G within a cluster).

create function public.accumulate_candidate_transitions(
  p_mountain_id text,
  p_session_id  uuid,
  p_transitions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t       jsonb;
  p_count integer;
begin
  for t in select * from jsonb_array_elements(p_transitions)
  loop
    p_count := (t->>'transitionCount')::integer;

    insert into public.candidate_cell_transitions (
      mountain_id, from_cell_key, to_cell_key,
      transition_count, session_count, contributing_sessions, last_seen_at
    )
    values (
      p_mountain_id,
      t->>'fromCellKey',
      t->>'toCellKey',
      p_count,
      1,
      array[p_session_id],
      now()
    )
    on conflict (mountain_id, from_cell_key, to_cell_key) do update set
      transition_count     = candidate_cell_transitions.transition_count + p_count,
      session_count        = candidate_cell_transitions.session_count +
        case when p_session_id = any(candidate_cell_transitions.contributing_sessions) then 0 else 1 end,
      contributing_sessions = case
        when p_session_id = any(candidate_cell_transitions.contributing_sessions)
          then candidate_cell_transitions.contributing_sessions
        else array_append(candidate_cell_transitions.contributing_sessions, p_session_id)
      end,
      last_seen_at = now();
  end loop;
end;
$$;

-- ── 4. accumulate_route_to_candidate_transitions ──────────────────────────────
-- Stores cross-boundary transitions (C→F or F→C) as branch-point signals.

create function public.accumulate_route_to_candidate_transitions(
  p_mountain_id text,
  p_route_id    text,
  p_session_id  uuid,
  p_direction   public.cross_transition_direction,
  p_transitions jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t       jsonb;
  p_count integer;
begin
  for t in select * from jsonb_array_elements(p_transitions)
  loop
    p_count := (t->>'transitionCount')::integer;

    insert into public.route_to_candidate_transitions (
      mountain_id, route_id, from_cell_key, to_cell_key,
      direction, transition_count, session_count, contributing_sessions, last_seen_at
    )
    values (
      p_mountain_id,
      p_route_id,
      t->>'fromCellKey',
      t->>'toCellKey',
      p_direction,
      p_count,
      1,
      array[p_session_id],
      now()
    )
    on conflict (route_id, from_cell_key, to_cell_key, direction) do update set
      transition_count     = route_to_candidate_transitions.transition_count + p_count,
      session_count        = route_to_candidate_transitions.session_count +
        case when p_session_id = any(route_to_candidate_transitions.contributing_sessions) then 0 else 1 end,
      contributing_sessions = case
        when p_session_id = any(route_to_candidate_transitions.contributing_sessions)
          then route_to_candidate_transitions.contributing_sessions
        else array_append(route_to_candidate_transitions.contributing_sessions, p_session_id)
      end,
      last_seen_at = now();
  end loop;
end;
$$;

-- ── 5. Query helpers ──────────────────────────────────────────────────────────

create function public.candidate_cell_transitions_for_mountain(
  p_mountain_id text
)
returns table (
  from_cell_key         text,
  to_cell_key           text,
  transition_count      integer,
  session_count         integer,
  contributing_sessions uuid[],
  last_seen_at          timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    from_cell_key,
    to_cell_key,
    transition_count,
    session_count,
    contributing_sessions,
    last_seen_at
  from public.candidate_cell_transitions
  where mountain_id = p_mountain_id;
$$;

create function public.route_to_candidate_transitions_for_mountain(
  p_mountain_id text
)
returns table (
  route_id              text,
  from_cell_key         text,
  to_cell_key           text,
  direction             public.cross_transition_direction,
  transition_count      integer,
  session_count         integer,
  contributing_sessions uuid[],
  last_seen_at          timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    route_id,
    from_cell_key,
    to_cell_key,
    direction,
    transition_count,
    session_count,
    contributing_sessions,
    last_seen_at
  from public.route_to_candidate_transitions
  where mountain_id = p_mountain_id;
$$;
