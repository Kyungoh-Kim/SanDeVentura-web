-- =============================================================================
-- 0018_trail_cells_for_mountain.sql
-- Adds RPC to fetch trail cells for a mountain for operator map display.
-- =============================================================================

create or replace function public.trail_cells_for_mountain(p_mountain_id text)
returns table (
  route_id      text,
  cell_key      text,
  lat           double precision,
  lon           double precision,
  point_count   integer,
  session_count integer
)
language sql security definer as $$
  select
    tc.route_id,
    tc.cell_key,
    st_y(tc.geom::geometry) as lat,
    st_x(tc.geom::geometry) as lon,
    tc.point_count,
    tc.session_count
  from public.trail_cells tc
  join public.routes r on r.id = tc.route_id
  where r.mountain_id = p_mountain_id
  order by tc.route_id, tc.session_count desc;
$$;

grant execute on function public.trail_cells_for_mountain(text) to authenticated, anon;
