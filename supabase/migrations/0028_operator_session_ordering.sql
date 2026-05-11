-- =============================================================================
-- 0028_operator_session_ordering.sql
-- Expose session timestamps to the operator session read model so the UI can
-- sort newest sessions first without relying on random UUID ordering.
-- =============================================================================

create or replace view public.operator_session_ingestion as
with exact_by_session as (
  select
    session_id,
    count(distinct route_id) filter (where target_kind = 'route')::integer as matched_route_count,
    count(*) filter (where target_kind = 'route')::integer as matched_route_cell_count,
    coalesce(sum(point_count) filter (where target_kind = 'route'), 0)::integer as matched_route_point_count,
    count(*) filter (where target_kind = 'candidate')::integer as candidate_cell_count,
    coalesce(sum(point_count) filter (where target_kind = 'candidate'), 0)::integer as candidate_point_count,
    count(*)::integer as exact_cell_count
  from public.session_cell_attributions
  group by session_id
),
approx_route_by_session as (
  select
    session_id,
    count(distinct route_id)::integer as matched_route_count,
    coalesce(sum(contributed_cell_count), 0)::integer as matched_route_cell_count
  from public.session_route_assignments
  group by session_id
),
approx_candidate_by_session as (
  select
    session_id,
    count(*)::integer as candidate_cell_count
  from (
    select
      unnest(contributing_sessions) as session_id,
      cell_key
    from public.candidate_cells
  ) candidate_sessions
  group by session_id
)
select
  hs.id as session_id,
  hs.mountain_id,
  m.display_name as mountain_display_name,
  hs.route_id,
  hs.status as pipeline_state,
  hs.status as upload_state,
  hs.upload_consent_version as consent_version,
  hs.accepted_point_count,
  hs.rejected_point_count,
  null::text as last_error,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_count, 0)
    else coalesce(approx_route_by_session.matched_route_count, 0)
  end as matched_route_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_cell_count, 0)
    else coalesce(approx_route_by_session.matched_route_cell_count, 0)
  end as matched_route_cell_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_point_count, 0)
    else null::integer
  end as matched_route_point_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.candidate_cell_count, 0)
    else coalesce(approx_candidate_by_session.candidate_cell_count, 0)
  end as candidate_cell_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.candidate_point_count, 0)
    else null::integer
  end as candidate_point_count,
  case
    when coalesce(exact_by_session.exact_cell_count, 0) > 0 then 'exact'
    when coalesce(approx_route_by_session.matched_route_cell_count, 0) > 0
      or coalesce(approx_candidate_by_session.candidate_cell_count, 0) > 0
      then 'approximate'
    else 'none'
  end as attribution_precision,
  hs.started_at,
  hs.ended_at,
  hs.created_at
from public.hiking_sessions hs
join public.mountains m on m.id = hs.mountain_id
left join exact_by_session on exact_by_session.session_id = hs.id
left join approx_route_by_session on approx_route_by_session.session_id = hs.id
left join approx_candidate_by_session on approx_candidate_by_session.session_id = hs.id;
