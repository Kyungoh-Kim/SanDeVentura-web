-- =============================================================================
-- 0011_operator_views_v2.sql
-- Replaces operator_route_quality_detail and operator_quality_summary (0008)
-- to aggregate by route_id instead of mountain_id.
-- =============================================================================

-- ── operator_route_quality_detail ─────────────────────────────────────────────
-- One row per route.  Mountains with no routes appear once with 'none' state.

create or replace view public.operator_route_quality_detail as
with latest_trails as (
  select distinct on (route_id)
    route_id,
    confidence_level as route_state,
    confidence,
    version,
    session_count,
    branch_ambiguity_score,
    gps_quality_score,
    updated_at
  from public.canonical_trails
  order by route_id, version desc
),
route_session_counts as (
  select
    route_id,
    coalesce(sum(accepted_point_count), 0)::integer as accepted_point_count,
    coalesce(sum(rejected_point_count), 0)::integer as rejected_point_count
  from public.hiking_sessions
  where route_id is not null
  group by route_id
),
route_latest_points as (
  select
    hs.route_id,
    max(tp.recorded_at) as latest_evidence_at
  from public.track_points tp
  join public.hiking_sessions hs on hs.id = tp.session_id
  where hs.route_id is not null
  group by hs.route_id
),
route_latest_rejected as (
  select
    hs.route_id,
    max(rtp.recorded_at) as latest_rejected_evidence_at
  from public.rejected_track_points rtp
  join public.hiking_sessions hs on hs.id = rtp.session_id
  where hs.route_id is not null
  group by hs.route_id
)
select
  r.id                                           as route_id,
  r.mountain_id,
  m.display_name                                 as mountain_display_name,
  r.display_name                                 as route_display_name,
  coalesce(lt.route_state, 'none')               as route_state,
  lt.confidence,
  lt.version,
  coalesce(lt.session_count, 0)                  as session_count,
  lt.branch_ambiguity_score,
  lt.gps_quality_score,
  coalesce(rsc.accepted_point_count, 0)          as accepted_point_count,
  coalesce(rsc.rejected_point_count, 0)          as rejected_point_count,
  greatest(
    rlp.latest_evidence_at,
    rlr.latest_rejected_evidence_at
  )                                              as latest_evidence_at,
  lt.updated_at
from public.routes r
join public.mountains m on m.id = r.mountain_id
left join latest_trails        lt  on lt.route_id  = r.id
left join route_session_counts rsc on rsc.route_id = r.id
left join route_latest_points  rlp on rlp.route_id = r.id
left join route_latest_rejected rlr on rlr.route_id = r.id
union all
-- Mountains that have no routes
select
  null::text             as route_id,
  m.id                   as mountain_id,
  m.display_name         as mountain_display_name,
  null::text             as route_display_name,
  'none'::text           as route_state,
  null::double precision as confidence,
  null::integer          as version,
  0                      as session_count,
  null::double precision as branch_ambiguity_score,
  null::double precision as gps_quality_score,
  0                      as accepted_point_count,
  0                      as rejected_point_count,
  null::timestamptz      as latest_evidence_at,
  null::timestamptz      as updated_at
from public.mountains m
where not exists (
  select 1 from public.routes r2 where r2.mountain_id = m.id
)
order by mountain_id, route_id nulls last;

-- ── operator_quality_summary ──────────────────────────────────────────────────
-- route_coverage = covered routes / total routes (routes with no canonical trail
-- or mountains with no routes count as 'none').

create or replace view public.operator_quality_summary as
with route_counts as (
  select
    count(*)::integer as total_routes,
    count(*) filter (
      where route_state in ('recommended', 'reference')
    )::integer        as covered_routes
  from public.operator_route_quality_detail
),
upload_counts as (
  select
    count(*)::integer                                               as total_sessions,
    count(*) filter (
      where status in ('accepted', 'uploaded', 'ingested', 'complete')
    )::integer                                                      as successful_sessions,
    count(*) filter (
      where status in ('queued', 'retry', 'local', 'pending')
    )::integer                                                      as queued_uploads
  from public.hiking_sessions
),
event_counts as (
  select
    count(*) filter (where event_name = 'snap_requested')::integer as snap_requests,
    count(*) filter (where event_name = 'trail_served')::integer   as trail_served
  from public.mvp_events
)
select
  case
    when upload_counts.total_sessions = 0 then null
    else upload_counts.successful_sessions::double precision /
         upload_counts.total_sessions
  end                                         as upload_success_rate,
  coalesce(upload_counts.queued_uploads, 0)   as queued_uploads,
  case
    when route_counts.total_routes = 0 then null
    else route_counts.covered_routes::double precision /
         route_counts.total_routes
  end                                         as route_coverage,
  coalesce(event_counts.snap_requests, 0)     as snap_requests,
  coalesce(event_counts.trail_served, 0)      as trail_served
from route_counts, upload_counts, event_counts;
