-- =============================================================================
-- 0032_trajectory_route_inference.sql
-- Stores trajectory-derived route/candidate support without retaining per-session
-- raw or refined points. H3 cell tables remain for legacy diagnostics only.
-- =============================================================================

alter table public.canonical_trails
  add column if not exists algorithm_version text not null default 'h3-cell-v1',
  add column if not exists source_kind text not null default 'cell_aggregate';

alter table public.session_route_assignments
  add column if not exists matched_point_count integer,
  add column if not exists matched_length_m double precision,
  add column if not exists residual_length_m double precision;

alter table public.session_route_assignments
  drop constraint if exists session_route_assignments_match_method_check;

alter table public.session_route_assignments
  add constraint session_route_assignments_match_method_check
  check (match_method in ('exact_overlap', 'frechet_match', 'candidate_residual', 'trajectory_match'));

create table if not exists public.candidate_trajectories (
  id uuid primary key default gen_random_uuid(),
  mountain_id text not null references public.mountains(id) on delete cascade,
  geom geography(linestring, 4326) not null,
  point_count integer not null default 0,
  session_count integer not null default 0,
  contributing_sessions uuid[] not null default '{}',
  avg_accuracy double precision,
  avg_altitude double precision,
  length_m double precision,
  confidence double precision,
  latest_evidence_at timestamptz,
  algorithm_version text not null default 'trajectory-v1',
  status text not null default 'candidate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists candidate_trajectories_mountain_idx
  on public.candidate_trajectories (mountain_id);

create index if not exists candidate_trajectories_geom_idx
  on public.candidate_trajectories using gist (geom);

alter table public.candidate_trajectories enable row level security;

drop view if exists public.unprocessed_ingested_sessions;

create view public.unprocessed_ingested_sessions as
select
  s.id,
  s.mountain_id,
  s.route_id,
  s.started_at,
  s.accepted_point_count
from public.hiking_sessions s
left join public.session_route_assignments a on a.session_id = s.id
where s.status = 'ingested'
  and s.accepted_point_count > 0
  and a.session_id is null
order by s.started_at;

create table if not exists public.session_trajectory_attributions (
  session_id uuid not null references public.hiking_sessions(id) on delete cascade,
  mountain_id text not null references public.mountains(id) on delete cascade,
  target_kind public.session_attribution_target_kind not null,
  route_id text references public.routes(id) on delete cascade,
  candidate_trajectory_id uuid references public.candidate_trajectories(id) on delete cascade,
  point_count integer not null,
  avg_accuracy double precision,
  avg_altitude double precision,
  matched_length_m double precision,
  residual_length_m double precision,
  frechet_distance double precision,
  overlap_ratio double precision,
  algorithm_version text not null default 'trajectory-v1',
  matched_at timestamptz not null default now(),
  constraint session_trajectory_attributions_target_check check (
    (target_kind = 'route' and route_id is not null and candidate_trajectory_id is null)
    or
    (target_kind = 'candidate' and route_id is null and candidate_trajectory_id is not null)
  )
);

create unique index if not exists session_trajectory_attributions_route_key
  on public.session_trajectory_attributions (session_id, route_id)
  where target_kind = 'route';

create unique index if not exists session_trajectory_attributions_candidate_key
  on public.session_trajectory_attributions (session_id, candidate_trajectory_id)
  where target_kind = 'candidate';

create index if not exists session_trajectory_attributions_session_idx
  on public.session_trajectory_attributions (session_id);

create index if not exists session_trajectory_attributions_mountain_idx
  on public.session_trajectory_attributions (mountain_id);

alter table public.session_trajectory_attributions enable row level security;

create or replace function public.replace_session_trajectory_attributions(
  p_session_id uuid,
  p_rows jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.session_trajectory_attributions
   where session_id = p_session_id;

  insert into public.session_trajectory_attributions (
    session_id,
    mountain_id,
    target_kind,
    route_id,
    candidate_trajectory_id,
    point_count,
    avg_accuracy,
    avg_altitude,
    matched_length_m,
    residual_length_m,
    frechet_distance,
    overlap_ratio,
    algorithm_version,
    matched_at
  )
  select
    p_session_id,
    row->>'mountainId',
    (row->>'targetKind')::public.session_attribution_target_kind,
    nullif(row->>'routeId', ''),
    nullif(row->>'candidateTrajectoryId', '')::uuid,
    (row->>'pointCount')::integer,
    (row->>'avgAccuracy')::double precision,
    (row->>'avgAltitude')::double precision,
    (row->>'matchedLengthMeters')::double precision,
    (row->>'residualLengthMeters')::double precision,
    (row->>'frechetDistance')::double precision,
    (row->>'overlapRatio')::double precision,
    coalesce(row->>'algorithmVersion', 'trajectory-v1'),
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  where row->>'mountainId' is not null
    and row->>'targetKind' in ('route', 'candidate')
    and row->>'pointCount' is not null;
end;
$$;

revoke execute on function public.replace_session_trajectory_attributions(uuid, jsonb) from public;
grant execute on function public.replace_session_trajectory_attributions(uuid, jsonb) to service_role;

create or replace view public.operator_candidate_trajectory_clusters as
select
  mountain_id,
  count(*)::integer as trajectory_count,
  coalesce(sum(point_count), 0)::integer as total_point_count,
  coalesce(sum(session_count), 0)::integer as total_session_contributions,
  max(latest_evidence_at) as latest_evidence_at
from public.candidate_trajectories
where status = 'candidate'
group by mountain_id
having count(*) > 0;

create or replace function public.candidate_trajectories_for_mountain(p_mountain_id text)
returns table (
  id uuid,
  mountain_id text,
  trail_geojson jsonb,
  point_count integer,
  session_count integer,
  contributing_sessions uuid[],
  avg_accuracy double precision,
  avg_altitude double precision,
  length_m double precision,
  confidence double precision,
  latest_evidence_at timestamptz,
  algorithm_version text
)
language sql
security definer
set search_path = public
as $$
  select
    ct.id,
    ct.mountain_id,
    st_asgeojson(ct.geom::geometry)::jsonb as trail_geojson,
    ct.point_count,
    ct.session_count,
    ct.contributing_sessions,
    ct.avg_accuracy,
    ct.avg_altitude,
    ct.length_m,
    ct.confidence,
    ct.latest_evidence_at,
    ct.algorithm_version
  from public.candidate_trajectories ct
  where ct.mountain_id = p_mountain_id
    and ct.status = 'candidate'
  order by ct.latest_evidence_at desc nulls last, ct.updated_at desc
$$;

revoke execute on function public.candidate_trajectories_for_mountain(text) from public;
grant execute on function public.candidate_trajectories_for_mountain(text) to anon, authenticated, service_role;

create or replace function public.route_trajectories_for_mountain(p_mountain_id text)
returns table (
  route_id text,
  route_display_name text,
  trail_geojson jsonb,
  version integer,
  session_count integer,
  confidence double precision,
  confidence_level text,
  algorithm_version text
)
language sql
security definer
set search_path = public
as $$
  with latest as (
    select distinct on (ct.route_id)
      ct.route_id,
      ct.geom,
      ct.version,
      ct.session_count,
      ct.confidence,
      ct.confidence_level,
      ct.algorithm_version
    from public.canonical_trails ct
    join public.routes r on r.id = ct.route_id
    where r.mountain_id = p_mountain_id
      and ct.geom is not null
    order by ct.route_id, ct.version desc
  )
  select
    r.id as route_id,
    r.display_name as route_display_name,
    case when latest.geom is null then null else st_asgeojson(latest.geom::geometry)::jsonb end,
    latest.version,
    coalesce(latest.session_count, 0),
    latest.confidence,
    latest.confidence_level,
    coalesce(latest.algorithm_version, 'unknown')
  from public.routes r
  left join latest on latest.route_id = r.id
  where r.mountain_id = p_mountain_id
  order by r.id
$$;

revoke execute on function public.route_trajectories_for_mountain(text) from public;
grant execute on function public.route_trajectories_for_mountain(text) to anon, authenticated, service_role;

create or replace view public.operator_session_ingestion as
with trajectory_by_session as (
  select
    session_id,
    count(distinct route_id) filter (where target_kind = 'route')::integer as matched_route_count,
    coalesce(sum(point_count) filter (where target_kind = 'route'), 0)::integer as matched_route_point_count,
    coalesce(sum(point_count) filter (where target_kind = 'candidate'), 0)::integer as candidate_point_count,
    count(*) filter (where target_kind = 'route')::integer as matched_route_segment_count,
    count(*) filter (where target_kind = 'candidate')::integer as candidate_segment_count,
    count(*)::integer as exact_trajectory_count
  from public.session_trajectory_attributions
  group by session_id
),
exact_by_session as (
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
    when coalesce(trajectory_by_session.exact_trajectory_count, 0) > 0
      then coalesce(trajectory_by_session.matched_route_count, 0)
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_count, 0)
    else coalesce(approx_route_by_session.matched_route_count, 0)
  end as matched_route_count,
  case
    when coalesce(trajectory_by_session.exact_trajectory_count, 0) > 0
      then coalesce(trajectory_by_session.matched_route_segment_count, 0)
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_cell_count, 0)
    else coalesce(approx_route_by_session.matched_route_cell_count, 0)
  end as matched_route_cell_count,
  case
    when coalesce(trajectory_by_session.exact_trajectory_count, 0) > 0
      then coalesce(trajectory_by_session.matched_route_point_count, 0)
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.matched_route_point_count, 0)
    else null::integer
  end as matched_route_point_count,
  case
    when coalesce(trajectory_by_session.exact_trajectory_count, 0) > 0
      then coalesce(trajectory_by_session.candidate_segment_count, 0)
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.candidate_cell_count, 0)
    else coalesce(approx_candidate_by_session.candidate_cell_count, 0)
  end as candidate_cell_count,
  case
    when coalesce(trajectory_by_session.exact_trajectory_count, 0) > 0
      then coalesce(trajectory_by_session.candidate_point_count, 0)
    when coalesce(exact_by_session.exact_cell_count, 0) > 0
      then coalesce(exact_by_session.candidate_point_count, 0)
    else null::integer
  end as candidate_point_count,
  case
    when coalesce(trajectory_by_session.exact_trajectory_count, 0) > 0 then 'exact'
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
left join trajectory_by_session on trajectory_by_session.session_id = hs.id
left join exact_by_session on exact_by_session.session_id = hs.id
left join approx_route_by_session on approx_route_by_session.session_id = hs.id
left join approx_candidate_by_session on approx_candidate_by_session.session_id = hs.id;

create or replace view public.operator_session_trajectory_attribution as
select
  sta.session_id,
  sta.target_kind::text as target_kind,
  sta.route_id,
  r.display_name as route_display_name,
  sta.candidate_trajectory_id,
  sta.point_count,
  sta.avg_accuracy,
  sta.avg_altitude,
  sta.matched_length_m,
  sta.residual_length_m,
  sta.frechet_distance,
  sta.overlap_ratio,
  sta.algorithm_version,
  sta.matched_at
from public.session_trajectory_attributions sta
left join public.routes r on r.id = sta.route_id;

create or replace view public.operator_session_route_attribution as
select
  sta.session_id,
  sta.route_id,
  r.display_name as route_display_name,
  coalesce(sta.matched_length_m, 0)::integer as cell_count,
  sta.point_count,
  0::integer as transition_count,
  'trajectory_match'::text as match_method,
  sta.frechet_distance,
  sta.overlap_ratio,
  null::double precision as score_margin,
  'exact'::text as attribution_precision
from public.session_trajectory_attributions sta
join public.routes r on r.id = sta.route_id
where sta.target_kind = 'route'
union all
select
  sca.session_id,
  sca.route_id,
  r.display_name as route_display_name,
  count(*)::integer as cell_count,
  coalesce(sum(sca.point_count), 0)::integer as point_count,
  coalesce(max(sra.contributed_transition_count), 0)::integer as transition_count,
  coalesce(max(sra.match_method), 'exact_overlap') as match_method,
  max(sra.frechet_distance) as frechet_distance,
  max(sra.overlap_ratio) as overlap_ratio,
  max(sra.score_margin) as score_margin,
  'exact'::text as attribution_precision
from public.session_cell_attributions sca
join public.routes r on r.id = sca.route_id
left join public.session_route_assignments sra
  on sra.session_id = sca.session_id
 and sra.route_id = sca.route_id
where sca.target_kind = 'route'
  and not exists (
    select 1
    from public.session_trajectory_attributions sta
    where sta.session_id = sca.session_id
      and sta.target_kind = 'route'
  )
group by sca.session_id, sca.route_id, r.display_name
union all
select
  sra.session_id,
  sra.route_id,
  r.display_name as route_display_name,
  sra.contributed_cell_count as cell_count,
  null::integer as point_count,
  sra.contributed_transition_count as transition_count,
  sra.match_method,
  sra.frechet_distance,
  sra.overlap_ratio,
  sra.score_margin,
  'approximate'::text as attribution_precision
from public.session_route_assignments sra
join public.routes r on r.id = sra.route_id
where not exists (
  select 1
  from public.session_trajectory_attributions sta
  where sta.session_id = sra.session_id
    and sta.target_kind = 'route'
) and not exists (
  select 1
  from public.session_cell_attributions sca
  where sca.session_id = sra.session_id
    and sca.target_kind = 'route'
    and sca.route_id = sra.route_id
);

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
    select sta.matched_at as evidence_at
    from public.session_trajectory_attributions sta
    where sta.route_id = p_route_id
      and sta.target_kind = 'route'
    union all
    select sca.last_seen_at
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
