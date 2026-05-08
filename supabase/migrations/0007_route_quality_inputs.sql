create or replace function public.route_quality_inputs(p_mountain_id text)
returns table (
  accepted_point_count integer,
  rejected_point_count integer,
  latest_evidence_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with session_counts as (
    select
      coalesce(sum(hiking_sessions.accepted_point_count), 0)::integer
        as accepted_point_count,
      coalesce(sum(hiking_sessions.rejected_point_count), 0)::integer
        as rejected_point_count
    from public.hiking_sessions
    where hiking_sessions.mountain_id = p_mountain_id
  ),
  latest_points as (
    select max(track_points.recorded_at) as latest_evidence_at
    from public.track_points
    where track_points.mountain_id = p_mountain_id
  ),
  latest_rejected_points as (
    select max(rejected_track_points.recorded_at) as latest_rejected_evidence_at
    from public.rejected_track_points
    join public.hiking_sessions
      on hiking_sessions.id = rejected_track_points.session_id
    where hiking_sessions.mountain_id = p_mountain_id
  )
  select
    session_counts.accepted_point_count,
    session_counts.rejected_point_count,
    greatest(
      latest_points.latest_evidence_at,
      latest_rejected_points.latest_rejected_evidence_at
    ) as latest_evidence_at
  from session_counts, latest_points, latest_rejected_points
$$;
