-- =============================================================================
-- 0015_h3_cell_reset.sql
-- Clears all accumulated cell data computed with the old rectangular grid
-- (cell_key format: "lat_idx:lon_idx") and resets session processing state
-- so that match-and-aggregate-sessions rebuilds everything using H3 cell keys
-- (cell_key format: H3 index string, resolution 11, ~25m edge).
--
-- Safe to run against an empty database — all deletes are no-ops if tables
-- are already empty.
-- =============================================================================

-- trail_cell_transitions references trail_cells, so clear it first.
delete from public.trail_cell_transitions;

-- Clear trail_cells and orphan candidate_cells.
delete from public.trail_cells;
delete from public.candidate_cells;

-- canonical_trails were derived from the now-deleted cells.
delete from public.canonical_trails;

-- Remove session-route assignments so all previously-ingested sessions
-- re-enter the unprocessed_ingested_sessions view and are reprocessed.
delete from public.session_route_assignments;

-- Orphaned sessions (fully unmatched) were marked 'complete' to exit the
-- processing queue. Reset them to 'ingested' so they are reprocessed.
update public.hiking_sessions
set status = 'ingested'
where status = 'complete';
