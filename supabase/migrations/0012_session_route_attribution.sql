-- =============================================================================
-- 0012_session_route_attribution.sql
-- Adds session-to-route attribution tables, views, and accumulation helpers
-- for the match-and-aggregate-sessions edge function.
-- =============================================================================

-- ── session_route_assignments ─────────────────────────────────────────────────
-- Records which sessions contributed to which routes (many-to-many).
-- Primary key (session_id, route_id) guarantees idempotent processing.

create table public.session_route_assignments (
  session_id                uuid    not null references public.hiking_sessions(id) on delete cascade,
  route_id                  text    not null references public.routes(id) on delete cascade,
  contributed_cell_count    integer not null default 0,
  contributed_transition_count integer not null default 0,
  matched_at                timestamptz not null default now(),
  primary key (session_id, route_id)
);

create index session_route_assignments_route_idx
  on public.session_route_assignments (route_id);

-- ── candidate_cells ───────────────────────────────────────────────────────────
-- GPS cells that could not be matched to any existing route.
-- Accumulate here until enough evidence to propose a new route.

create table public.candidate_cells (
  id                    uuid        primary key default gen_random_uuid(),
  mountain_id           text        not null references public.mountains(id) on delete cascade,
  cell_key              text        not null,
  geom                  geography(point, 4326) not null,
  point_count           integer     not null default 0,
  session_count         integer     not null default 0,
  contributing_sessions uuid[]      not null default '{}',
  avg_accuracy          double precision,
  avg_altitude          double precision,
  last_seen_at          timestamptz,
  unique (mountain_id, cell_key)
);

create index candidate_cells_geom_idx    on public.candidate_cells using gist (geom);
create index candidate_cells_mountain_idx on public.candidate_cells (mountain_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────

alter table public.session_route_assignments enable row level security;
alter table public.candidate_cells enable row level security;

-- ── unprocessed_ingested_sessions ─────────────────────────────────────────────
-- Sessions that have been ingested but not yet attributed to any route.
-- A session exits this view once it has at least one session_route_assignments row
-- OR its status has been changed to 'complete' (fully-orphaned case).

create or replace view public.unprocessed_ingested_sessions as
select
  s.id,
  s.mountain_id,
  s.started_at,
  s.accepted_point_count
from public.hiking_sessions s
left join public.session_route_assignments a on a.session_id = s.id
where s.status = 'ingested'
  and s.accepted_point_count > 0
  and a.session_id is null
order by s.started_at;

-- ── candidate_cell_clusters ───────────────────────────────────────────────────
-- Summarises candidate cells per mountain for the operator dashboard.
-- Only surfaces mountains with at least 5 candidate cells.

create or replace view public.candidate_cell_clusters as
select
  mountain_id,
  count(*)::integer            as cell_count,
  sum(session_count)::integer  as total_session_count,
  max(last_seen_at)            as latest_evidence_at
from public.candidate_cells
group by mountain_id
having count(*) >= 5;

-- ── Query helpers ─────────────────────────────────────────────────────────────

create function public.session_track_points(p_session_id uuid)
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
  where tp.session_id = p_session_id
  order by tp.sequence_index
$$;

create function public.mountain_route_cells(p_mountain_id text)
returns table (
  route_id  text,
  cell_key  text,
  lat       double precision,
  lon       double precision
)
language sql
security definer
set search_path = public
as $$
  select
    tc.route_id,
    tc.cell_key,
    st_y(tc.geom::geometry) as lat,
    st_x(tc.geom::geometry) as lon
  from public.trail_cells tc
  join public.routes r on r.id = tc.route_id
  where r.mountain_id = p_mountain_id
$$;

create function public.route_accumulated_cells(p_route_id text)
returns table (
  cell_key      text,
  lat           double precision,
  lon           double precision,
  point_count   integer,
  session_count integer,
  avg_accuracy  double precision,
  avg_altitude  double precision,
  last_seen_at  timestamptz,
  quality_score double precision
)
language sql
security definer
set search_path = public
as $$
  select
    cell_key,
    st_y(geom::geometry) as lat,
    st_x(geom::geometry) as lon,
    point_count,
    session_count,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    quality_score
  from public.trail_cells
  where route_id = p_route_id
$$;

-- ── Accumulation functions ────────────────────────────────────────────────────
-- Each function accepts a JSONB array of cells/transitions and performs a
-- weighted-average UPSERT, avoiding the need for a per-row read-modify-write
-- cycle in the TypeScript layer.

create function public.accumulate_trail_cells(
  p_route_id text,
  p_cells    jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c jsonb;
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
      point_count, session_count,
      avg_accuracy, avg_altitude, last_seen_at, quality_score
    )
    values (
      p_route_id,
      c->>'cellKey',
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
      p_count,
      1,
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
      point_count   = trail_cells.point_count + p_count,
      session_count = trail_cells.session_count + 1,
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

create function public.accumulate_trail_transitions(
  p_route_id    text,
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
      transition_count, session_count, edge_cost
    )
    values (
      p_route_id,
      t->>'fromCellKey',
      t->>'toCellKey',
      p_count,
      1,
      1.0 / greatest(1, p_count)
    )
    on conflict (route_id, from_cell_key, to_cell_key) do update set
      transition_count = trail_cell_transitions.transition_count + p_count,
      session_count    = trail_cell_transitions.session_count + 1,
      edge_cost        = 1.0 / greatest(1, trail_cell_transitions.transition_count + p_count);
  end loop;
end;
$$;

create function public.accumulate_candidate_cells(
  p_mountain_id text,
  p_session_id  uuid,
  p_cells       jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c       jsonb;
  p_count integer;
  p_lon   double precision;
  p_lat   double precision;
  added   integer := 0;
begin
  for c in select * from jsonb_array_elements(p_cells)
  loop
    p_count := (c->>'pointCount')::integer;
    p_lon   := (c->>'lon')::double precision;
    p_lat   := (c->>'lat')::double precision;

    insert into public.candidate_cells (
      mountain_id, cell_key, geom,
      point_count, session_count, contributing_sessions,
      avg_accuracy, avg_altitude, last_seen_at
    )
    values (
      p_mountain_id,
      c->>'cellKey',
      st_setsrid(st_makepoint(p_lon, p_lat), 4326)::geography,
      p_count,
      1,
      array[p_session_id],
      (c->>'avgAccuracy')::double precision,
      (c->>'avgAltitude')::double precision,
      (c->>'lastSeenAt')::timestamptz
    )
    on conflict (mountain_id, cell_key) do update set
      point_count   = candidate_cells.point_count + p_count,
      session_count = candidate_cells.session_count +
        case when p_session_id = any(candidate_cells.contributing_sessions) then 0 else 1 end,
      contributing_sessions = case
        when p_session_id = any(candidate_cells.contributing_sessions)
          then candidate_cells.contributing_sessions
        else array_append(candidate_cells.contributing_sessions, p_session_id)
      end,
      avg_accuracy  = case
        when candidate_cells.avg_accuracy is null then (c->>'avgAccuracy')::double precision
        when (c->>'avgAccuracy') is null           then candidate_cells.avg_accuracy
        else (candidate_cells.avg_accuracy * candidate_cells.point_count +
              (c->>'avgAccuracy')::double precision * p_count) /
             (candidate_cells.point_count + p_count)
      end,
      avg_altitude  = case
        when candidate_cells.avg_altitude is null then (c->>'avgAltitude')::double precision
        when (c->>'avgAltitude') is null           then candidate_cells.avg_altitude
        else (candidate_cells.avg_altitude * candidate_cells.point_count +
              (c->>'avgAltitude')::double precision * p_count) /
             (candidate_cells.point_count + p_count)
      end,
      last_seen_at  = greatest(candidate_cells.last_seen_at, (c->>'lastSeenAt')::timestamptz);
    added := added + 1;
  end loop;
  return added;
end;
$$;
