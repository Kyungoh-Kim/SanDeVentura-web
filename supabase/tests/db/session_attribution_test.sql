begin;

select plan(11);

select has_table('public', 'session_cell_attributions', 'session cell attribution table exists');
select has_function(
  'public',
  'replace_session_cell_attributions',
  array['uuid', 'jsonb'],
  'replace session cell attribution RPC exists'
);
select has_view('public', 'operator_session_ingestion', 'operator session ingestion view exists');
select has_view('public', 'operator_session_route_attribution', 'operator route attribution view exists');
select has_view('public', 'operator_session_cell_attribution', 'operator cell attribution view exists');

insert into public.mountains (id, display_name, source)
values ('attribution-test-mountain', 'Attribution Test Mountain', 'test');

insert into public.routes (id, mountain_id, display_name)
values
  ('attribution-main', 'attribution-test-mountain', 'Main'),
  ('attribution-alt', 'attribution-test-mountain', 'Alt');

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
    '33333333-3333-3333-3333-333333333333',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'attribution-test-mountain',
    'exact-attribution',
    '2026-05-08T01:00:00Z',
    '2026-05-08T02:00:00Z',
    'ingested',
    'v1.0',
    10,
    1
  ),
  (
    '44444444-4444-4444-4444-444444444444',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'attribution-test-mountain',
    'historical-attribution',
    '2026-05-08T03:00:00Z',
    '2026-05-08T04:00:00Z',
    'complete',
    'v1.0',
    9,
    0
  );

select public.replace_session_cell_attributions(
  '33333333-3333-3333-3333-333333333333',
  $json$
  [
    {
      "mountainId": "attribution-test-mountain",
      "targetKind": "route",
      "routeId": "attribution-main",
      "cellKey": "cell-route-a",
      "pointCount": 3,
      "avgAccuracy": 7.5,
      "avgAltitude": 900,
      "lastSeenAt": "2026-05-08T01:10:00Z"
    },
    {
      "mountainId": "attribution-test-mountain",
      "targetKind": "route",
      "routeId": "attribution-main",
      "cellKey": "cell-route-b",
      "pointCount": 2,
      "avgAccuracy": 8.5,
      "avgAltitude": 910,
      "lastSeenAt": "2026-05-08T01:20:00Z"
    },
    {
      "mountainId": "attribution-test-mountain",
      "targetKind": "candidate",
      "routeId": null,
      "cellKey": "cell-candidate-a",
      "pointCount": 4,
      "avgAccuracy": 10.5,
      "avgAltitude": 930,
      "lastSeenAt": "2026-05-08T01:30:00Z"
    }
  ]
  $json$::jsonb
);

insert into public.session_route_assignments (
  session_id,
  route_id,
  contributed_cell_count,
  contributed_transition_count
) values (
  '44444444-4444-4444-4444-444444444444',
  'attribution-main',
  7,
  3
);

insert into public.candidate_cells (
  mountain_id,
  cell_key,
  geom,
  point_count,
  session_count,
  contributing_sessions,
  last_seen_at
) values
  (
    'attribution-test-mountain',
    'historical-candidate-a',
    'POINT(127.0000 37.5000)'::geography,
    100,
    1,
    array['44444444-4444-4444-4444-444444444444'::uuid],
    '2026-05-08T03:10:00Z'
  ),
  (
    'attribution-test-mountain',
    'historical-candidate-b',
    'POINT(127.0010 37.5010)'::geography,
    80,
    1,
    array['44444444-4444-4444-4444-444444444444'::uuid],
    '2026-05-08T03:20:00Z'
  );

select results_eq(
  $$
    select
      matched_route_count,
      matched_route_cell_count,
      matched_route_point_count,
      candidate_cell_count,
      candidate_point_count,
      attribution_precision
    from public.operator_session_ingestion
    where session_id = '33333333-3333-3333-3333-333333333333'
  $$,
  $$ values (1::integer, 2::integer, 5::integer, 1::integer, 4::integer, 'exact'::text) $$,
  'exact session ingestion aggregates route and candidate attribution'
);

select results_eq(
  $$
    select
      route_id,
      cell_count,
      point_count,
      transition_count,
      match_method,
      frechet_distance,
      overlap_ratio,
      score_margin,
      attribution_precision
    from public.operator_session_route_attribution
    where session_id = '33333333-3333-3333-3333-333333333333'
  $$,
  $$
    values (
      'attribution-main'::text,
      2::integer,
      5::integer,
      0::integer,
      'exact_overlap'::text,
      null::double precision,
      null::double precision,
      null::double precision,
      'exact'::text
    )
  $$,
  'exact route attribution exposes counts and match diagnostics'
);

select results_eq(
  $$
    select
      matched_route_count,
      matched_route_cell_count,
      matched_route_point_count,
      candidate_cell_count,
      candidate_point_count,
      attribution_precision
    from public.operator_session_ingestion
    where session_id = '44444444-4444-4444-4444-444444444444'
  $$,
  $$ values (1::integer, 7::integer, null::integer, 2::integer, null::integer, 'approximate'::text) $$,
  'historical session uses approximate attribution without point counts'
);

select results_eq(
  $$
    select target_kind, route_id, cell_key, point_count
    from public.operator_session_cell_attribution
    where session_id = '33333333-3333-3333-3333-333333333333'
    order by target_kind, cell_key
  $$,
  $$
    values
      ('candidate'::text, null::text, 'cell-candidate-a'::text, 4::integer),
      ('route'::text, 'attribution-main'::text, 'cell-route-a'::text, 3::integer),
      ('route'::text, 'attribution-main'::text, 'cell-route-b'::text, 2::integer)
  $$,
  'exact cell attribution exposes cell keys and counts'
);

select is_empty(
  $$
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'operator_session_ingestion',
        'operator_session_route_attribution',
        'operator_session_cell_attribution'
      )
      and column_name in ('lat', 'lon', 'geom', 'trail_geojson', 'debug_payload_sample')
  $$,
  'operator session attribution views do not expose coordinates or raw payloads'
);

select results_eq(
  $$
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'route_split_audit'
      and column_name in (
        'invalid_reason',
        'match_score',
        'frechet_distance',
        'cluster_weight',
        'auto_decision'
      )
  $$,
  $$ values (5::integer) $$,
  'route split audit exposes correction decision diagnostics'
);

select * from finish();

rollback;
