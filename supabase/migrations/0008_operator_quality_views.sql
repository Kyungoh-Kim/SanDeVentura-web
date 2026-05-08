create or replace view public.operator_route_quality_detail as
with latest_trails as (
  select distinct on (canonical_trails.mountain_id)
    canonical_trails.mountain_id,
    canonical_trails.confidence_level as route_state,
    canonical_trails.confidence,
    canonical_trails.version,
    canonical_trails.session_count,
    canonical_trails.branch_ambiguity_score,
    canonical_trails.gps_quality_score,
    canonical_trails.updated_at
  from public.canonical_trails
  order by canonical_trails.mountain_id, canonical_trails.version desc
),
session_counts as (
  select
    hiking_sessions.mountain_id,
    coalesce(sum(hiking_sessions.accepted_point_count), 0)::integer
      as accepted_point_count,
    coalesce(sum(hiking_sessions.rejected_point_count), 0)::integer
      as rejected_point_count
  from public.hiking_sessions
  group by hiking_sessions.mountain_id
),
latest_points as (
  select
    track_points.mountain_id,
    max(track_points.recorded_at) as latest_evidence_at
  from public.track_points
  group by track_points.mountain_id
),
latest_rejected_points as (
  select
    hiking_sessions.mountain_id,
    max(rejected_track_points.recorded_at) as latest_rejected_evidence_at
  from public.rejected_track_points
  join public.hiking_sessions
    on hiking_sessions.id = rejected_track_points.session_id
  group by hiking_sessions.mountain_id
)
select
  mountains.id as mountain_id,
  mountains.display_name,
  coalesce(latest_trails.route_state, 'none') as route_state,
  latest_trails.confidence,
  latest_trails.version,
  coalesce(latest_trails.session_count, 0) as session_count,
  latest_trails.branch_ambiguity_score,
  latest_trails.gps_quality_score,
  coalesce(session_counts.accepted_point_count, 0) as accepted_point_count,
  coalesce(session_counts.rejected_point_count, 0) as rejected_point_count,
  greatest(
    latest_points.latest_evidence_at,
    latest_rejected_points.latest_rejected_evidence_at
  ) as latest_evidence_at,
  latest_trails.updated_at
from public.mountains
left join latest_trails on latest_trails.mountain_id = mountains.id
left join session_counts on session_counts.mountain_id = mountains.id
left join latest_points on latest_points.mountain_id = mountains.id
left join latest_rejected_points on latest_rejected_points.mountain_id = mountains.id;

create or replace view public.operator_quality_summary as
with route_counts as (
  select
    count(*)::integer as total_mountains,
    count(*) filter (where route_state in ('recommended', 'reference'))::integer
      as covered_mountains
  from public.operator_route_quality_detail
),
upload_counts as (
  select
    count(*)::integer as total_sessions,
    count(*) filter (
      where status in ('accepted', 'uploaded', 'ingested', 'complete')
    )::integer as successful_sessions,
    count(*) filter (
      where status in ('queued', 'retry', 'local', 'pending')
    )::integer as queued_uploads
  from public.hiking_sessions
),
event_counts as (
  select
    count(*) filter (where event_name = 'snap_requested')::integer
      as snap_requests,
    count(*) filter (where event_name = 'trail_served')::integer
      as trail_served
  from public.mvp_events
)
select
  case
    when upload_counts.total_sessions = 0 then null
    else upload_counts.successful_sessions::double precision /
      upload_counts.total_sessions
  end as upload_success_rate,
  coalesce(upload_counts.queued_uploads, 0) as queued_uploads,
  case
    when route_counts.total_mountains = 0 then null
    else route_counts.covered_mountains::double precision /
      route_counts.total_mountains
  end as route_coverage,
  coalesce(event_counts.snap_requests, 0) as snap_requests,
  coalesce(event_counts.trail_served, 0) as trail_served
from route_counts, upload_counts, event_counts;
