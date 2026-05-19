begin;

select plan(8);

select has_table('public', 'session_edge_metric_slices', 'session edge metric slice table exists');
select has_table('public', 'trail_edge_segment_metrics', 'trail edge segment metrics table exists');
select has_function('public', 'replace_session_edge_metric_slices', array['uuid', 'jsonb'], 'metric slice replace rpc exists');
select has_function('public', 'rebuild_trail_edge_segment_metrics', array[]::text[], 'metric rebuild rpc exists');
select has_view('public', 'operator_trail_edge_segment_metrics', 'operator trail edge segment metric view exists');

insert into public.mountains (id, display_name, source)
values ('graph-metric-mountain', 'Graph Metric Mountain', 'test');

insert into public.hiking_sessions (
  id,
  user_id,
  mountain_id,
  client_session_key,
  started_at,
  status,
  upload_consent_version,
  accepted_point_count,
  rejected_point_count
)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'graph-metric-mountain',
  'graph-metric-session',
  '2026-05-08T01:00:00Z',
  'complete',
  'beta-v1',
  5,
  0
);

insert into public.trail_nodes (id, mountain_id, kind, geom)
values
  ('00000000-0000-4000-8000-000000000201', 'graph-metric-mountain', 'endpoint', st_setsrid(st_makepoint(127.0, 37.0), 4326)::geography),
  ('00000000-0000-4000-8000-000000000202', 'graph-metric-mountain', 'endpoint', st_setsrid(st_makepoint(127.001, 37.0), 4326)::geography);

insert into public.trail_edges (id, mountain_id, from_node_id, to_node_id, geom, length_m)
values (
  '00000000-0000-4000-8000-000000000301',
  'graph-metric-mountain',
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202',
  st_setsrid(st_makeline(st_makepoint(127.0, 37.0), st_makepoint(127.001, 37.0)), 4326)::geography,
  100
);

select public.replace_session_edge_metric_slices(
  '00000000-0000-4000-8000-000000000101',
  $json$
  [
    {
      "mountainId": "graph-metric-mountain",
      "intervalIndex": 0,
      "targetKind": "edge",
      "edgeId": "00000000-0000-4000-8000-000000000301",
      "direction": "forward",
      "segmentIndex": 0,
      "startMeasureMeters": 0,
      "endMeasureMeters": 100,
      "sampleCount": 5,
      "durationSeconds": 120,
      "durationObservationCount": 1,
      "speedDistanceMeters": 100,
      "elevationGainMeters": 12,
      "elevationLossMeters": 0,
      "abruptAltitudeChangeCount": 1,
      "maxAbsAltitudeDeltaMeters": 45,
      "latestEvidenceAt": "2026-05-08T01:02:00Z",
      "algorithmVersion": "trail-graph-v1"
    }
  ]
  $json$::jsonb
);

select public.rebuild_trail_edge_segment_metrics();

select results_eq(
  $$
    select
      session_count,
      direction,
      sample_count,
      round(duration_seconds_avg::numeric, 1),
      abrupt_altitude_change_count,
      round(max_abs_altitude_delta_m::numeric, 1)
    from public.operator_trail_edge_segment_metrics
    where edge_id = '00000000-0000-4000-8000-000000000301'
      and segment_index = 0
  $$,
  $$ values (1, 'forward'::text, 5, 120.0::numeric, 1, 45.0::numeric) $$,
  'operator view exposes aggregated duration and altitude anomaly metrics'
);

select is_empty(
  $$
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'operator_trail_edge_segment_metrics'
      and column_name in ('lat', 'lon', 'geom', 'trail_geojson', 'payload')
  $$,
  'operator segment metric view does not expose coordinates or geometry'
);

select is_empty(
  $$
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'trail_edge_segment_metrics'
  $$,
  'direct segment metric table reads are blocked by RLS'
);

select * from finish();

rollback;
