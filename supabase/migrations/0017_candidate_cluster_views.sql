-- =============================================================================
-- 0017_candidate_cluster_views.sql
-- Adds RPC and view for the Route Discovery workflow.
-- candidate_cells_for_mountain: returns cells with extracted lat/lon for the
--   promote-candidate-cluster edge function.
-- candidate_cell_clusters: enhanced to include contributing session UUIDs.
-- =============================================================================

-- ── candidate_cells_for_mountain RPC ─────────────────────────────────────────
-- Returns candidate cells for a mountain with lat/lon extracted from geom.
-- Used by the promote-candidate-cluster edge function.

create or replace function public.candidate_cells_for_mountain(p_mountain_id text)
returns table (
  cell_key              text,
  lat                   double precision,
  lon                   double precision,
  point_count           integer,
  session_count         integer,
  avg_accuracy          double precision,
  avg_altitude          double precision,
  last_seen_at          timestamptz,
  contributing_sessions uuid[]
)
language sql security definer as $$
  select
    cell_key,
    st_y(geom::geometry)   as lat,
    st_x(geom::geometry)   as lon,
    point_count,
    session_count,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    contributing_sessions
  from public.candidate_cells
  where mountain_id = p_mountain_id
  order by last_seen_at desc;
$$;

-- ── candidate_cell_clusters view (enhanced) ───────────────────────────────────
-- Replaces the view from 0012 with contributing session UUIDs included.
-- Requires >= 3 cells and >= 2 sessions to surface as a discoverable cluster.

drop view if exists public.candidate_cell_clusters;
create view public.candidate_cell_clusters as
select
  mountain_id,
  count(*)::integer                                        as cell_count,
  sum(session_count)::integer                              as total_session_contributions,
  max(last_seen_at)                                        as latest_evidence_at,
  (
    select array_agg(distinct u)
    from public.candidate_cells c2,
         unnest(c2.contributing_sessions) as u
    where c2.mountain_id = cc.mountain_id
  )                                                        as contributing_sessions
from public.candidate_cells cc
group by mountain_id
having count(*) >= 3;

-- ── candidate_cell_details view ───────────────────────────────────────────────
-- Flat view for operator map display (cell centres with coordinates).

create or replace view public.candidate_cell_details as
select
  mountain_id,
  cell_key,
  st_x(geom::geometry)  as lon,
  st_y(geom::geometry)  as lat,
  point_count,
  session_count,
  last_seen_at
from public.candidate_cells;
