create or replace function public.latest_canonical_trail(p_mountain_id text)
returns table (
  mountain_id text,
  route_state text,
  version integer,
  confidence double precision,
  updated_at timestamptz,
  trail_geojson jsonb,
  session_count integer,
  branch_ambiguity_score double precision,
  gps_quality_score double precision
)
language sql
security definer
set search_path = public
as $$
  select
    canonical_trails.mountain_id,
    canonical_trails.confidence_level as route_state,
    canonical_trails.version,
    canonical_trails.confidence,
    canonical_trails.updated_at,
    case
      when canonical_trails.geom is null then null
      else st_asgeojson(canonical_trails.geom::geometry)::jsonb
    end as trail_geojson,
    canonical_trails.session_count,
    canonical_trails.branch_ambiguity_score,
    canonical_trails.gps_quality_score
  from public.canonical_trails
  where canonical_trails.mountain_id = p_mountain_id
  order by canonical_trails.version desc
  limit 1
$$;

create or replace function public.accepted_route_points(p_mountain_id text)
returns table (
  session_id uuid,
  recorded_at timestamptz,
  lat double precision,
  lon double precision,
  accuracy double precision,
  altitude double precision,
  sequence_index integer
)
language sql
security definer
set search_path = public
as $$
  select
    track_points.session_id,
    track_points.recorded_at,
    st_y(track_points.geom::geometry) as lat,
    st_x(track_points.geom::geometry) as lon,
    track_points.accuracy,
    track_points.altitude,
    track_points.sequence_index
  from public.track_points
  where track_points.mountain_id = p_mountain_id
  order by track_points.session_id, track_points.sequence_index
$$;

create or replace function public.snap_position_to_trail(
  p_mountain_id text,
  p_lat double precision,
  p_lon double precision
)
returns table (
  success boolean,
  distance_meters double precision,
  snapped_lat double precision,
  snapped_lon double precision,
  trail_version integer,
  route_state text
)
language sql
security definer
set search_path = public
as $$
  with latest as (
    select *
    from public.canonical_trails
    where mountain_id = p_mountain_id
      and geom is not null
    order by version desc
    limit 1
  ),
  input as (
    select st_setsrid(st_makepoint(p_lon, p_lat), 4326) as geom
  ),
  snapped as (
    select
      latest.version,
      latest.confidence_level,
      st_lineinterpolatepoint(
        latest.geom::geometry,
        st_linelocatepoint(latest.geom::geometry, input.geom)
      ) as geom,
      st_distance(latest.geom, input.geom::geography) as distance_meters
    from latest, input
  )
  select
    true,
    snapped.distance_meters,
    st_y(snapped.geom),
    st_x(snapped.geom),
    snapped.version,
    snapped.confidence_level
  from snapped
$$;

create or replace view public.operator_route_coverage as
select distinct on (mountains.id)
  mountains.id as mountain_id,
  mountains.display_name,
  coalesce(canonical_trails.confidence_level, 'none') as route_state,
  canonical_trails.confidence,
  canonical_trails.version,
  coalesce(canonical_trails.session_count, 0) as session_count,
  canonical_trails.branch_ambiguity_score,
  canonical_trails.gps_quality_score,
  canonical_trails.updated_at
from public.mountains
left join public.canonical_trails
  on canonical_trails.mountain_id = mountains.id
order by mountains.id, canonical_trails.version desc nulls last;
