begin;

select plan(23);

select has_table('public', 'trail_cells', 'trail_cells table exists');
select has_table('public', 'trail_cell_transitions', 'trail_cell_transitions table exists');
select has_table('public', 'canonical_trails', 'canonical_trails table exists');
select has_function('public', 'latest_canonical_trail', array['text'], 'latest trail RPC exists');
select has_function('public', 'snap_position_to_trail', array['text', 'double precision', 'double precision'], 'snap RPC exists');
select has_function('public', 'accepted_route_points', array['text'], 'accepted route points RPC exists');
select has_function('public', 'route_quality_inputs', array['text'], 'route quality input RPC exists');
select has_view('public', 'operator_route_coverage', 'operator route coverage view exists');
select has_view('public', 'operator_route_quality_detail', 'operator route quality detail view exists');
select has_view('public', 'operator_quality_summary', 'operator quality summary view exists');

insert into public.mountains (id, display_name, source)
values ('quality-test-mountain', 'Quality Test Mountain', 'test');

insert into public.hiking_sessions (
  id,
  user_id,
  mountain_id,
  client_session_key,
  started_at,
  ended_at,
  status,
  upload_consent_version,
  accepted_point_count,
  rejected_point_count
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'quality-test-mountain',
    'route-quality-1',
    '2026-05-08T01:00:00Z',
    '2026-05-08T01:30:00Z',
    'accepted',
    'beta-route-upload-v1',
    3,
    1
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'quality-test-mountain',
    'route-quality-2',
    '2026-05-08T02:00:00Z',
    '2026-05-08T02:30:00Z',
    'accepted',
    'beta-route-upload-v1',
    2,
    4
  );

insert into public.track_points (
  session_id,
  mountain_id,
  recorded_at,
  geom,
  altitude,
  accuracy,
  quality_score,
  sequence_index
) values
  (
    '11111111-1111-1111-1111-111111111111',
    'quality-test-mountain',
    '2026-05-08T01:05:00Z',
    'POINT(127.0000 37.5000)'::geography,
    300,
    10,
    0.9,
    0
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'quality-test-mountain',
    '2026-05-08T02:00:00Z',
    'POINT(127.0010 37.5010)'::geography,
    302,
    12,
    0.88,
    0
  );

insert into public.rejected_track_points (
  session_id,
  reason,
  recorded_at,
  lat,
  lon,
  point_sequence_index
) values (
  '22222222-2222-2222-2222-222222222222',
  'low_quality',
  '2026-05-08T02:10:00Z',
  37.5011,
  127.0011,
  1
);

select results_eq(
  $$ select accepted_point_count, rejected_point_count, latest_evidence_at
     from public.route_quality_inputs('quality-test-mountain') $$,
  $$ values (5::integer, 5::integer, '2026-05-08T02:10:00Z'::timestamptz) $$,
  'route quality input RPC returns evidence counts and latest timestamp'
);

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

select results_eq(
  $$ select accepted_point_count, rejected_point_count, latest_evidence_at
     from public.operator_route_quality_detail
     where mountain_id = 'quality-test-mountain' $$,
  $$ values (5::integer, 5::integer, '2026-05-08T02:10:00Z'::timestamptz) $$,
  'operator route quality detail exposes evidence counts'
);

select is_empty(
  $$
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operator_route_quality_detail'
      and column_name in ('lat', 'lon', 'geom', 'trail_geojson')
  $$,
  'operator route quality detail does not expose raw coordinates'
);

select isnt(
  (
    select route_coverage
    from public.operator_quality_summary
    limit 1
  ),
  null,
  'operator quality summary exposes route coverage'
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
