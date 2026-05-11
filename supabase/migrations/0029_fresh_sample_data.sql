-- =============================================================================
-- 0029_fresh_sample_data.sql
-- Fresh process-aligned demo input seed.
--
-- This migration seeds only catalog rows and upload-stage session points. Route
-- matching, edge H3 expansion, candidate accumulation, attribution, canonical
-- trail generation, and raw point purge are produced by the application pipeline.
-- =============================================================================

truncate
  public.mvp_events,
  public.route_split_audit,
  public.route_to_candidate_transitions,
  public.candidate_cell_transitions,
  public.session_cell_attributions,
  public.session_route_assignments,
  public.rejected_track_points,
  public.track_points,
  public.hiking_sessions,
  public.candidate_cells,
  public.trail_cell_transitions,
  public.trail_cells,
  public.canonical_trails,
  public.routes,
  public.mountains
restart identity cascade;

insert into public.mountains (id, display_name, source, bbox)
values
  ('sample-hallasan', 'Hallasan Fresh Demo', 'fresh-sample', '126.4700,33.2900,126.5150,33.3650'),
  ('sample-bukhansan', 'Bukhansan Fresh Demo', 'fresh-sample', '126.9700,37.6480,127.0020,37.6700');

insert into public.routes (id, mountain_id, display_name)
values
  ('sample-halla-yeongsil', 'sample-hallasan', 'Yeongsil Ridge'),
  ('sample-bukhan-baegundae', 'sample-bukhansan', 'Baegundae Main');

insert into public.hiking_sessions (
  id,
  user_id,
  mountain_id,
  route_id,
  client_session_key,
  started_at,
  ended_at,
  status,
  upload_consent_version,
  accepted_point_count,
  rejected_point_count,
  retention_review_at,
  created_at
) values
  (
    '11111111-0000-0000-0000-000000000101',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'sample-hallasan',
    'sample-halla-yeongsil',
    'seed-halla-reference-1',
    '2026-05-08T00:20:00Z',
    '2026-05-08T02:10:00Z',
    'ingested',
    'beta-route-upload-v1',
    5,
    1,
    '2026-05-08T02:15:00Z',
    '2026-05-08T02:15:00Z'
  ),
  (
    '11111111-0000-0000-0000-000000000102',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'sample-hallasan',
    'sample-halla-yeongsil',
    'seed-halla-reference-2',
    '2026-05-08T03:00:00Z',
    '2026-05-08T04:50:00Z',
    'ingested',
    'beta-route-upload-v1',
    5,
    0,
    '2026-05-08T04:55:00Z',
    '2026-05-08T04:55:00Z'
  ),
  (
    '11111111-0000-0000-0000-000000000201',
    'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'sample-bukhansan',
    'sample-bukhan-baegundae',
    'seed-bukhan-reference-1',
    '2026-05-08T05:30:00Z',
    '2026-05-08T07:00:00Z',
    'ingested',
    'beta-route-upload-v1',
    5,
    0,
    '2026-05-08T07:05:00Z',
    '2026-05-08T07:05:00Z'
  ),
  (
    '11111111-0000-0000-0000-000000000103',
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'sample-hallasan',
    'sample-halla-yeongsil',
    'seed-halla-route-plus-candidate',
    '2026-05-09T01:10:00Z',
    '2026-05-09T03:00:00Z',
    'ingested',
    'beta-route-upload-v1',
    6,
    2,
    '2026-05-09T03:05:00Z',
    '2026-05-09T03:05:00Z'
  ),
  (
    '11111111-0000-0000-0000-000000000202',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'sample-bukhansan',
    'sample-bukhan-baegundae',
    'seed-bukhan-route-plus-candidate',
    '2026-05-09T04:00:00Z',
    '2026-05-09T05:30:00Z',
    'ingested',
    'beta-route-upload-v1',
    6,
    1,
    '2026-05-09T05:35:00Z',
    '2026-05-09T05:35:00Z'
  ),
  (
    '11111111-0000-0000-0000-000000000104',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'sample-hallasan',
    null,
    'seed-halla-candidate-only',
    '2026-05-10T01:00:00Z',
    '2026-05-10T01:50:00Z',
    'ingested',
    'beta-route-upload-v1',
    3,
    0,
    '2026-05-10T01:55:00Z',
    '2026-05-10T01:55:00Z'
  );

create temporary table sample_track_point_input (
  session_id uuid not null,
  mountain_id text not null,
  sequence_index integer not null,
  recorded_at timestamptz not null,
  lat double precision not null,
  lon double precision not null,
  altitude double precision,
  accuracy double precision,
  speed double precision,
  quality_score double precision
) on commit drop;

insert into sample_track_point_input (
  session_id,
  mountain_id,
  sequence_index,
  recorded_at,
  lat,
  lon,
  altitude,
  accuracy,
  speed,
  quality_score
) values
  ('11111111-0000-0000-0000-000000000101', 'sample-hallasan', 0, '2026-05-08T00:20:00Z', 33.3400, 126.4800, 1320, 7.0, 1.2, 0.98),
  ('11111111-0000-0000-0000-000000000101', 'sample-hallasan', 1, '2026-05-08T00:47:00Z', 33.3440, 126.4860, 1390, 6.5, 1.1, 0.97),
  ('11111111-0000-0000-0000-000000000101', 'sample-hallasan', 2, '2026-05-08T01:14:00Z', 33.3490, 126.4920, 1475, 6.8, 1.0, 0.98),
  ('11111111-0000-0000-0000-000000000101', 'sample-hallasan', 3, '2026-05-08T01:42:00Z', 33.3540, 126.4980, 1560, 7.1, 1.0, 0.97),
  ('11111111-0000-0000-0000-000000000101', 'sample-hallasan', 4, '2026-05-08T02:10:00Z', 33.3600, 126.5040, 1665, 7.4, 0.9, 0.96),

  ('11111111-0000-0000-0000-000000000102', 'sample-hallasan', 0, '2026-05-08T03:00:00Z', 33.3398, 126.4802, 1315, 8.1, 1.1, 0.96),
  ('11111111-0000-0000-0000-000000000102', 'sample-hallasan', 1, '2026-05-08T03:28:00Z', 33.3442, 126.4862, 1388, 7.8, 1.0, 0.96),
  ('11111111-0000-0000-0000-000000000102', 'sample-hallasan', 2, '2026-05-08T03:55:00Z', 33.3491, 126.4922, 1478, 7.6, 1.0, 0.97),
  ('11111111-0000-0000-0000-000000000102', 'sample-hallasan', 3, '2026-05-08T04:23:00Z', 33.3542, 126.4981, 1562, 7.9, 0.9, 0.96),
  ('11111111-0000-0000-0000-000000000102', 'sample-hallasan', 4, '2026-05-08T04:50:00Z', 33.3598, 126.5038, 1660, 8.0, 0.9, 0.95),

  ('11111111-0000-0000-0000-000000000201', 'sample-bukhansan', 0, '2026-05-08T05:30:00Z', 37.6530, 126.9780, 235, 6.4, 1.2, 0.97),
  ('11111111-0000-0000-0000-000000000201', 'sample-bukhansan', 1, '2026-05-08T05:52:00Z', 37.6560, 126.9820, 340, 6.2, 1.1, 0.97),
  ('11111111-0000-0000-0000-000000000201', 'sample-bukhansan', 2, '2026-05-08T06:15:00Z', 37.6590, 126.9860, 520, 6.5, 1.0, 0.98),
  ('11111111-0000-0000-0000-000000000201', 'sample-bukhansan', 3, '2026-05-08T06:37:00Z', 37.6620, 126.9900, 690, 6.8, 0.9, 0.96),
  ('11111111-0000-0000-0000-000000000201', 'sample-bukhansan', 4, '2026-05-08T07:00:00Z', 37.6650, 126.9940, 820, 7.0, 0.8, 0.95),

  ('11111111-0000-0000-0000-000000000103', 'sample-hallasan', 0, '2026-05-09T01:10:00Z', 33.3401, 126.4800, 1320, 7.2, 1.2, 0.97),
  ('11111111-0000-0000-0000-000000000103', 'sample-hallasan', 1, '2026-05-09T01:33:00Z', 33.3440, 126.4861, 1390, 7.0, 1.1, 0.96),
  ('11111111-0000-0000-0000-000000000103', 'sample-hallasan', 2, '2026-05-09T01:56:00Z', 33.3490, 126.4921, 1475, 7.3, 1.0, 0.97),
  ('11111111-0000-0000-0000-000000000103', 'sample-hallasan', 3, '2026-05-09T02:18:00Z', 33.3500, 126.4960, 1510, 7.6, 0.9, 0.95),
  ('11111111-0000-0000-0000-000000000103', 'sample-hallasan', 4, '2026-05-09T02:40:00Z', 33.3510, 126.5000, 1538, 7.9, 0.8, 0.94),
  ('11111111-0000-0000-0000-000000000103', 'sample-hallasan', 5, '2026-05-09T03:00:00Z', 33.3520, 126.5040, 1562, 8.1, 0.8, 0.93),

  ('11111111-0000-0000-0000-000000000202', 'sample-bukhansan', 0, '2026-05-09T04:00:00Z', 37.6530, 126.9781, 236, 6.7, 1.1, 0.97),
  ('11111111-0000-0000-0000-000000000202', 'sample-bukhansan', 1, '2026-05-09T04:18:00Z', 37.6560, 126.9821, 340, 6.8, 1.0, 0.97),
  ('11111111-0000-0000-0000-000000000202', 'sample-bukhansan', 2, '2026-05-09T04:36:00Z', 37.6590, 126.9861, 518, 6.6, 0.9, 0.96),
  ('11111111-0000-0000-0000-000000000202', 'sample-bukhansan', 3, '2026-05-09T04:54:00Z', 37.6605, 126.9895, 580, 6.9, 0.8, 0.95),
  ('11111111-0000-0000-0000-000000000202', 'sample-bukhansan', 4, '2026-05-09T05:12:00Z', 37.6620, 126.9930, 640, 7.3, 0.8, 0.94),
  ('11111111-0000-0000-0000-000000000202', 'sample-bukhansan', 5, '2026-05-09T05:30:00Z', 37.6635, 126.9965, 705, 7.8, 0.7, 0.93),

  ('11111111-0000-0000-0000-000000000104', 'sample-hallasan', 0, '2026-05-10T01:00:00Z', 33.3500, 126.4960, 1510, 8.0, 1.0, 0.95),
  ('11111111-0000-0000-0000-000000000104', 'sample-hallasan', 1, '2026-05-10T01:25:00Z', 33.3510, 126.5000, 1535, 8.3, 0.9, 0.94),
  ('11111111-0000-0000-0000-000000000104', 'sample-hallasan', 2, '2026-05-10T01:50:00Z', 33.3520, 126.5040, 1560, 8.4, 0.8, 0.93);

insert into public.track_points (
  session_id,
  mountain_id,
  recorded_at,
  geom,
  altitude,
  accuracy,
  speed,
  quality_score,
  sequence_index
)
select
  session_id,
  mountain_id,
  recorded_at,
  st_setsrid(st_makepoint(lon, lat), 4326)::geography,
  altitude,
  accuracy,
  speed,
  quality_score,
  sequence_index
from sample_track_point_input;

insert into public.mvp_events (
  user_id,
  mountain_id,
  session_id,
  event_name,
  event_payload,
  created_at
)
select
  hs.user_id,
  hs.mountain_id,
  hs.id,
  'session_uploaded',
  jsonb_build_object(
    'clientSessionKey', hs.client_session_key,
    'acceptedPointCount', hs.accepted_point_count,
    'rejectedPointCount', hs.rejected_point_count,
    'seedStage', 'upload-input-only'
  ),
  hs.created_at
from public.hiking_sessions hs;
