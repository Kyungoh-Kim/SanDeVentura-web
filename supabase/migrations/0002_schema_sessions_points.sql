create table if not exists public.mountains (
  id text primary key,
  display_name text not null,
  source text not null default 'internal',
  created_at timestamptz not null default now()
);

create table if not exists public.hiking_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  mountain_id text not null references public.mountains(id),
  client_session_key text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  status text not null,
  upload_consent_version text not null,
  accepted_point_count integer not null default 0,
  rejected_point_count integer not null default 0,
  retention_review_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, client_session_key)
);

insert into public.mountains (id, display_name, source)
values ('beta-mountain', 'Beta Mountain', 'internal')
on conflict (id) do nothing;

create table if not exists public.track_points (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.hiking_sessions(id),
  mountain_id text not null references public.mountains(id),
  recorded_at timestamptz not null,
  geom geography(point, 4326) not null,
  altitude double precision,
  accuracy double precision,
  speed double precision,
  quality_score double precision,
  sequence_index integer not null
);

create index if not exists track_points_geom_idx on public.track_points using gist (geom);

create table if not exists public.rejected_track_points (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.hiking_sessions(id),
  reason text not null,
  recorded_at timestamptz,
  lat double precision,
  lon double precision,
  altitude double precision,
  accuracy double precision,
  speed double precision,
  point_sequence_index integer,
  debug_payload_sample jsonb,
  debug_payload_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists hiking_sessions_client_session_key_idx
  on public.hiking_sessions(user_id, client_session_key);

create index if not exists track_points_session_sequence_idx
  on public.track_points(session_id, sequence_index);

create index if not exists rejected_track_points_session_idx
  on public.rejected_track_points(session_id);

create table if not exists public.mvp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  mountain_id text,
  session_id uuid,
  event_name text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
