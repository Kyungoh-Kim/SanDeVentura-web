create table if not exists public.trail_cells (
  id uuid primary key default gen_random_uuid(),
  mountain_id text not null references public.mountains(id),
  cell_key text not null,
  geom geography(point, 4326) not null,
  point_count integer not null default 0,
  session_count integer not null default 0,
  avg_accuracy double precision,
  avg_altitude double precision,
  last_seen_at timestamptz,
  quality_score double precision,
  unique (mountain_id, cell_key)
);

create table if not exists public.trail_cell_transitions (
  id uuid primary key default gen_random_uuid(),
  mountain_id text not null references public.mountains(id),
  from_cell_key text not null,
  to_cell_key text not null,
  transition_count integer not null default 0,
  session_count integer not null default 0,
  edge_cost double precision,
  unique (mountain_id, from_cell_key, to_cell_key)
);

create table if not exists public.canonical_trails (
  id uuid primary key default gen_random_uuid(),
  mountain_id text not null references public.mountains(id),
  version integer not null,
  geom geography(linestring, 4326),
  confidence double precision,
  confidence_level text not null,
  session_count integer not null default 0,
  branch_ambiguity_score double precision,
  gps_quality_score double precision,
  updated_at timestamptz not null default now(),
  unique (mountain_id, version)
);

