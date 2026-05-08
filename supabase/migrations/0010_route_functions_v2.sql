-- =============================================================================
-- 0010_route_functions_v2.sql
-- Replaces all route-related functions (0005, 0007) to work with route_id
-- instead of mountain_id.  operator_route_coverage view is also recreated here.
-- =============================================================================

-- Drop old functions first (return-type changes require drop + create)
drop function if exists public.latest_canonical_trail(text);
drop function if exists public.accepted_route_points(text);
drop function if exists public.snap_position_to_trail(text, double precision, double precision);
drop function if exists public.route_quality_inputs(text);

-- ── latest_canonical_trail ────────────────────────────────────────────────────

create function public.latest_canonical_trail(p_route_id text)
returns table (
  route_id               text,
  mountain_id            text,
  mountain_name          text,
  route_name             text,
  route_state            text,
  version                integer,
  confidence             double precision,
  updated_at             timestamptz,
  trail_geojson          jsonb,
  session_count          integer,
  branch_ambiguity_score double precision,
  gps_quality_score      double precision
)
language sql
security definer
set search_path = public
as $$
  select
    ct.route_id,
    r.mountain_id,
    m.display_name                                  as mountain_name,
    r.display_name                                  as route_name,
    ct.confidence_level                             as route_state,
    ct.version,
    ct.confidence,
    ct.updated_at,
    case
      when ct.geom is null then null
      else st_asgeojson(ct.geom::geometry)::jsonb
    end                                             as trail_geojson,
    ct.session_count,
    ct.branch_ambiguity_score,
    ct.gps_quality_score
  from public.canonical_trails ct
  join public.routes  r on r.id  = ct.route_id
  join public.mountains m on m.id = r.mountain_id
  where ct.route_id = p_route_id
  order by ct.version desc
  limit 1
$$;

-- ── accepted_route_points ─────────────────────────────────────────────────────

create function public.accepted_route_points(p_route_id text)
returns table (
  session_id     uuid,
  recorded_at    timestamptz,
  lat            double precision,
  lon            double precision,
  accuracy       double precision,
  altitude       double precision,
  sequence_index integer
)
language sql
security definer
set search_path = public
as $$
  select
    tp.session_id,
    tp.recorded_at,
    st_y(tp.geom::geometry) as lat,
    st_x(tp.geom::geometry) as lon,
    tp.accuracy,
    tp.altitude,
    tp.sequence_index
  from public.track_points tp
  join public.hiking_sessions hs on hs.id = tp.session_id
  where hs.route_id = p_route_id
  order by tp.session_id, tp.sequence_index
$$;

-- ── snap_position_to_trail ────────────────────────────────────────────────────

create function public.snap_position_to_trail(
  p_route_id text,
  p_lat      double precision,
  p_lon      double precision
)
returns table (
  success         boolean,
  distance_meters double precision,
  snapped_lat     double precision,
  snapped_lon     double precision,
  trail_version   integer,
  route_state     text
)
language sql
security definer
set search_path = public
as $$
  with latest as (
    select *
    from public.canonical_trails
    where route_id = p_route_id
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
      )                                                      as geom,
      st_distance(latest.geom, input.geom::geography)        as distance_meters
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

-- ── route_quality_inputs ──────────────────────────────────────────────────────

create function public.route_quality_inputs(p_route_id text)
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
    select id, accepted_point_count, rejected_point_count
    from public.hiking_sessions
    where route_id = p_route_id
  ),
  session_counts as (
    select
      coalesce(sum(accepted_point_count), 0)::integer as accepted_point_count,
      coalesce(sum(rejected_point_count), 0)::integer as rejected_point_count
    from route_sessions
  ),
  latest_points as (
    select max(tp.recorded_at) as latest_evidence_at
    from public.track_points tp
    where tp.session_id in (select id from route_sessions)
  ),
  latest_rejected as (
    select max(rtp.recorded_at) as latest_rejected_evidence_at
    from public.rejected_track_points rtp
    where rtp.session_id in (select id from route_sessions)
  )
  select
    session_counts.accepted_point_count,
    session_counts.rejected_point_count,
    greatest(
      latest_points.latest_evidence_at,
      latest_rejected.latest_rejected_evidence_at
    ) as latest_evidence_at
  from session_counts, latest_points, latest_rejected
$$;

-- ── operator_route_coverage view ─────────────────────────────────────────────
-- One row per route (with canonical trail state).
-- Mountains that have no routes defined appear once with route_state = 'none'.

create or replace view public.operator_route_coverage as
with latest_trails as (
  select distinct on (route_id)
    route_id,
    confidence_level,
    confidence,
    version,
    session_count,
    branch_ambiguity_score,
    gps_quality_score,
    updated_at
  from public.canonical_trails
  order by route_id, version desc
)
select
  r.id                                          as route_id,
  r.mountain_id,
  m.display_name                                as mountain_display_name,
  r.display_name                                as route_display_name,
  coalesce(lt.confidence_level, 'none')         as route_state,
  lt.confidence,
  lt.version,
  coalesce(lt.session_count, 0)                 as session_count,
  lt.branch_ambiguity_score,
  lt.gps_quality_score,
  lt.updated_at
from public.routes r
join public.mountains m on m.id = r.mountain_id
left join latest_trails lt on lt.route_id = r.id
union all
-- Mountains that have no routes yet
select
  null::text              as route_id,
  m.id                    as mountain_id,
  m.display_name          as mountain_display_name,
  null::text              as route_display_name,
  'none'::text            as route_state,
  null::double precision  as confidence,
  null::integer           as version,
  0                       as session_count,
  null::double precision  as branch_ambiguity_score,
  null::double precision  as gps_quality_score,
  null::timestamptz       as updated_at
from public.mountains m
where not exists (
  select 1 from public.routes r2 where r2.mountain_id = m.id
)
order by mountain_id, route_id nulls last;
