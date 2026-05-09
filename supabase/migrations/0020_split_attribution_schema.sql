-- =============================================================================
-- 0020_split_attribution_schema.sql
-- Adds tracking structures for automatic route branch detection and splitting.
--
-- (1) contributing_sessions on trail_cells / trail_cell_transitions
--     so that after a split we know which sessions go to which new segment.
-- (2) candidate_cell_transitions — stores transitions between candidate cells
--     (e.g. F→G within a candidate cluster).
-- (3) route_to_candidate_transitions — stores cross-boundary transitions
--     (e.g. C→F) that signal a branch point on an existing route.
-- (4) route_split_audit — history of automatic split operations.
-- (5) Approximate backfill of contributing_sessions from session_route_assignments.
-- =============================================================================

-- ── 1. trail_cells.contributing_sessions ──────────────────────────────────────

alter table public.trail_cells
  add column contributing_sessions uuid[] not null default '{}';

create index trail_cells_contributing_sessions_gin
  on public.trail_cells using gin (contributing_sessions);

-- ── 2. trail_cell_transitions.contributing_sessions ───────────────────────────

alter table public.trail_cell_transitions
  add column contributing_sessions uuid[] not null default '{}';

create index trail_cell_transitions_contributing_sessions_gin
  on public.trail_cell_transitions using gin (contributing_sessions);

-- ── 3. candidate_cell_transitions ─────────────────────────────────────────────
-- Transitions between candidate cells (e.g. F→G within a cluster).
-- Scoped to mountain_id because candidate cells have no route yet.

create table public.candidate_cell_transitions (
  id                    uuid        primary key default gen_random_uuid(),
  mountain_id           text        not null references public.mountains(id) on delete cascade,
  from_cell_key         text        not null,
  to_cell_key           text        not null,
  transition_count      integer     not null default 0,
  session_count         integer     not null default 0,
  contributing_sessions uuid[]      not null default '{}',
  last_seen_at          timestamptz,
  unique (mountain_id, from_cell_key, to_cell_key)
);

create index candidate_cell_transitions_mountain_idx
  on public.candidate_cell_transitions (mountain_id);

alter table public.candidate_cell_transitions enable row level security;

-- ── 4. route_to_candidate_transitions ─────────────────────────────────────────
-- Cross-boundary transitions between a trail cell and a candidate cell.
-- 'route_to_candidate': trail → candidate (e.g. C→F, leaving known route).
-- 'candidate_to_route': candidate → trail (e.g. F→C, returning).
-- Primary signal for detecting branch points on existing routes.

create type public.cross_transition_direction as enum (
  'route_to_candidate',
  'candidate_to_route'
);

create table public.route_to_candidate_transitions (
  id                    uuid                              primary key default gen_random_uuid(),
  mountain_id           text                              not null references public.mountains(id) on delete cascade,
  route_id              text                              not null references public.routes(id) on delete cascade,
  from_cell_key         text                              not null,
  to_cell_key           text                              not null,
  direction             public.cross_transition_direction not null,
  transition_count      integer                           not null default 0,
  session_count         integer                           not null default 0,
  contributing_sessions uuid[]                            not null default '{}',
  last_seen_at          timestamptz,
  unique (route_id, from_cell_key, to_cell_key, direction)
);

create index route_to_candidate_transitions_mountain_idx
  on public.route_to_candidate_transitions (mountain_id);

create index route_to_candidate_transitions_route_idx
  on public.route_to_candidate_transitions (route_id);

alter table public.route_to_candidate_transitions enable row level security;

-- ── 5. route_split_audit ──────────────────────────────────────────────────────
-- History of route split operations — both dry-run previews and actual executions.
-- segment_a_route_id reuses the original_route_id (the "keep" segment).

create table public.route_split_audit (
  id                     uuid        primary key default gen_random_uuid(),
  mountain_id            text        not null references public.mountains(id) on delete cascade,
  original_route_id      text        not null,
  branch_point_cell_key  text        not null,
  segment_a_route_id     text,
  segment_b_route_id     text,
  branch_route_id        text,
  cfg_confidence         double precision,
  cross_branch_ratio     double precision,
  affected_session_count integer     not null default 0,
  dry_run                boolean     not null default true,
  decided_at             timestamptz not null default now()
);

create index route_split_audit_mountain_idx
  on public.route_split_audit (mountain_id);

create index route_split_audit_original_route_idx
  on public.route_split_audit (original_route_id);

alter table public.route_split_audit enable row level security;

-- ── 6. Backfill contributing_sessions on trail_cells ─────────────────────────
-- Approximate: each trail_cell inherits all session_ids assigned to its route.
-- This over-counts (not all sessions touched every cell) but is safe as a
-- historical bootstrap — precise tracking begins from Phase 2 onwards.

update public.trail_cells tc
set contributing_sessions = coalesce(sub.session_ids, '{}')
from (
  select
    route_id,
    array_agg(session_id) as session_ids
  from public.session_route_assignments
  group by route_id
) sub
where tc.route_id = sub.route_id
  and tc.contributing_sessions = '{}';
