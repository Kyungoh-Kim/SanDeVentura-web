-- =============================================================================
-- 0027_lightweight_raw_retention.sql
-- Keep raw GPS only as transient match input. Operator and quality surfaces use
-- aggregate evidence so processed sessions can purge track_points safely.
-- =============================================================================

create or replace function public.purge_session_raw_points(p_session_id uuid)
returns table (
  deleted_track_point_count integer,
  deleted_rejected_point_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_track_points integer := 0;
  v_deleted_rejected_points integer := 0;
begin
  delete from public.rejected_track_points
   where session_id = p_session_id;
  get diagnostics v_deleted_rejected_points = row_count;

  delete from public.track_points
   where session_id = p_session_id;
  get diagnostics v_deleted_track_points = row_count;

  return query
  select v_deleted_track_points, v_deleted_rejected_points;
end;
$$;

revoke execute on function public.purge_session_raw_points(uuid) from public;
grant execute on function public.purge_session_raw_points(uuid) to service_role;

revoke execute on function public.accepted_route_points(text) from public;
grant execute on function public.accepted_route_points(text) to service_role;

create or replace function public.route_quality_inputs(p_route_id text)
returns table (
  accepted_point_count integer,
  rejected_point_count integer,
  latest_evidence_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  with route_sessions as (
    select session_id
    from public.session_route_assignments
    where route_id = p_route_id
    union
    select id as session_id
    from public.hiking_sessions
    where route_id = p_route_id
  ),
  session_counts as (
    select
      coalesce(sum(hs.accepted_point_count), 0)::integer as accepted_point_count,
      coalesce(sum(hs.rejected_point_count), 0)::integer as rejected_point_count
    from public.hiking_sessions hs
    join route_sessions rs on rs.session_id = hs.id
  ),
  evidence_times as (
    select sca.last_seen_at as evidence_at
    from public.session_cell_attributions sca
    where sca.route_id = p_route_id
      and sca.target_kind = 'route'
    union all
    select tc.last_seen_at
    from public.trail_cells tc
    where tc.route_id = p_route_id
    union all
    select coalesce(hs.ended_at, hs.started_at)
    from public.hiking_sessions hs
    join route_sessions rs on rs.session_id = hs.id
  )
  select
    session_counts.accepted_point_count,
    session_counts.rejected_point_count,
    (select max(evidence_at) from evidence_times where evidence_at is not null)
  from session_counts
$$;

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
route_sessions as (
  select route_id, session_id
  from public.session_route_assignments
  union
  select route_id, id as session_id
  from public.hiking_sessions
  where route_id is not null
),
route_session_counts as (
  select
    rs.route_id,
    coalesce(sum(hs.accepted_point_count), 0)::integer as accepted_point_count,
    coalesce(sum(hs.rejected_point_count), 0)::integer as rejected_point_count
  from route_sessions rs
  join public.hiking_sessions hs on hs.id = rs.session_id
  group by rs.route_id
),
route_latest_evidence as (
  select route_id, max(evidence_at) as latest_evidence_at
  from (
    select sca.route_id, sca.last_seen_at as evidence_at
    from public.session_cell_attributions sca
    where sca.target_kind = 'route'
    union all
    select tc.route_id, tc.last_seen_at
    from public.trail_cells tc
    union all
    select rs.route_id, coalesce(hs.ended_at, hs.started_at)
    from route_sessions rs
    join public.hiking_sessions hs on hs.id = rs.session_id
  ) evidence
  where evidence_at is not null
  group by route_id
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
  rle.latest_evidence_at,
  lt.updated_at
from public.routes r
join public.mountains m on m.id = r.mountain_id
left join latest_trails lt on lt.route_id = r.id
left join route_session_counts rsc on rsc.route_id = r.id
left join route_latest_evidence rle on rle.route_id = r.id
union all
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
