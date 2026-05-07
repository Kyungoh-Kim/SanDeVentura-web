begin;

select plan(16);

select has_table('public', 'trail_cells', 'trail_cells table exists');
select has_table('public', 'trail_cell_transitions', 'trail_cell_transitions table exists');
select has_table('public', 'canonical_trails', 'canonical_trails table exists');
select has_function('public', 'latest_canonical_trail', array['text'], 'latest trail RPC exists');
select has_function('public', 'snap_position_to_trail', array['text', 'double precision', 'double precision'], 'snap RPC exists');
select has_function('public', 'accepted_route_points', array['text'], 'accepted route points RPC exists');
select has_view('public', 'operator_route_coverage', 'operator route coverage view exists');

select policies_are(
  'public',
  'trail_cells',
  array['Block direct trail cell reads'],
  'trail_cells raw reads are blocked'
);

select policies_are(
  'public',
  'trail_cell_transitions',
  array['Block direct trail transition reads'],
  'trail transitions raw reads are blocked'
);

select policies_are(
  'public',
  'canonical_trails',
  array['Users can read canonical trail summaries'],
  'canonical trail summaries are readable'
);

select policies_are(
  'public',
  'mountains',
  array['Users can read mountain catalog'],
  'mountain catalog is readable'
);

insert into public.canonical_trails (
  mountain_id,
  version,
  geom,
  confidence,
  confidence_level,
  session_count,
  branch_ambiguity_score,
  gps_quality_score
) values (
  'beta-mountain',
  100,
  'LINESTRING(127.0000 37.5000,127.0010 37.5010)'::geography,
  0.81,
  'recommended',
  3,
  0.0,
  0.9
);

select results_eq(
  $$ select route_state, version from public.latest_canonical_trail('beta-mountain') $$,
  $$ values ('recommended'::text, 100) $$,
  'latest trail RPC returns newest route state'
);

select is(
  (
    select route_state
    from public.operator_route_coverage
    where mountain_id = 'beta-mountain'
  ),
  'recommended',
  'operator route coverage exposes recommended state'
);

select isnt(
  (
    select trail_geojson
    from public.latest_canonical_trail('beta-mountain')
    limit 1
  ),
  null,
  'latest trail RPC exposes GeoJSON'
);

select ok(
  (
    select distance_meters <= 25
    from public.snap_position_to_trail('beta-mountain', 37.50001, 127.00001)
    limit 1
  ),
  'snap RPC computes an on-route distance'
);

select is_empty(
  $$ select success from public.snap_position_to_trail('missing-mountain', 37.5, 127.0) $$,
  'missing trail returns no snap rows'
);

select * from finish();

rollback;
