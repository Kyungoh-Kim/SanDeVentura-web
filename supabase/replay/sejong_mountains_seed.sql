begin;

-- =============================================================================
-- Sample mountains — Sejong City (세종특별자치시), Korea
-- =============================================================================
-- Mountain          Name      Elev   Route ID              RouteState   Sessions
-- wonsusan          원수산    228m   wonsusan-main         recommended  6
-- jeonwolsan        전월산    260m   jeonwolsan-main       recommended  5
-- bihaksan          비학산    202m   bihaksan-main         reference    3
-- janggunsan        장군산    248m   janggunsan-main       none         2
-- guksabong-sejong  국사봉    186m   guksabong-sejong-main none         1
-- =============================================================================

-- ── Cleanup (idempotent) ──────────────────────────────────────────────────────

delete from public.mvp_events
where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong');

delete from public.trail_cell_transitions
where route_id in (
  select id from public.routes
  where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong')
);

delete from public.trail_cells
where route_id in (
  select id from public.routes
  where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong')
);

delete from public.canonical_trails
where route_id in (
  select id from public.routes
  where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong')
);

delete from public.rejected_track_points
where session_id in (
  select id from public.hiking_sessions
  where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong')
    and client_session_key like 'demo-%'
);

delete from public.track_points
where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong')
  and session_id in (
    select id from public.hiking_sessions
    where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong')
      and client_session_key like 'demo-%'
  );

delete from public.hiking_sessions
where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong')
  and client_session_key like 'demo-%';

delete from public.routes
where mountain_id in ('wonsusan','jeonwolsan','bihaksan','janggunsan','guksabong-sejong');

-- ── Mountains ─────────────────────────────────────────────────────────────────

insert into public.mountains (id, display_name, source)
values
  ('wonsusan',          '원수산',  'demo'),
  ('jeonwolsan',        '전월산',  'demo'),
  ('bihaksan',          '비학산',  'demo'),
  ('janggunsan',        '장군산',  'demo'),
  ('guksabong-sejong',  '국사봉',  'demo')
on conflict (id) do update
  set display_name = excluded.display_name,
      source       = excluded.source;

-- ── Routes ────────────────────────────────────────────────────────────────────

insert into public.routes (id, mountain_id, display_name)
values
  ('wonsusan-main',          'wonsusan',         'Main Trail'),
  ('jeonwolsan-main',        'jeonwolsan',        'Main Trail'),
  ('bihaksan-main',          'bihaksan',          'Main Trail'),
  ('janggunsan-main',        'janggunsan',        'Main Trail'),
  ('guksabong-sejong-main',  'guksabong-sejong',  'Main Trail')
on conflict (id) do update
  set display_name = excluded.display_name;


-- =============================================================================
-- 원수산 (wonsusan) 228m — RECOMMENDED — 6 sessions
-- Route: SW trailhead (연기면) → NE summit ridge, 9 waypoints
-- Trailhead: 36.4640, 127.2785  Summit: 36.4700, 127.2860
-- =============================================================================
with route_points(sequence_index, lat, lon, altitude) as (
  values
    (0, 36.4640, 127.2785, 110.0),
    (1, 36.4649, 127.2799, 133.0),
    (2, 36.4657, 127.2812, 153.0),
    (3, 36.4664, 127.2823, 170.0),
    (4, 36.4671, 127.2833, 185.0),
    (5, 36.4678, 127.2841, 198.0),
    (6, 36.4685, 127.2849, 210.0),
    (7, 36.4693, 127.2854, 220.0),
    (8, 36.4700, 127.2860, 228.0)
),
demo_sessions as (
  insert into public.hiking_sessions (
    id, user_id, mountain_id, route_id, client_session_key,
    started_at, ended_at, status, upload_consent_version,
    accepted_point_count, rejected_point_count, retention_review_at
  )
  values
    ('91100000-0000-4000-8000-000000000001','11100000-0000-4000-8000-000000000001',
     'wonsusan','wonsusan-main','demo-wonsusan-route-1',
     '2026-03-22T07:00:00Z','2026-03-22T07:54:00Z','ingested','beta-upload-consent-v1',
     9,0,'2026-06-22T00:00:00Z'),
    ('91100000-0000-4000-8000-000000000002','11100000-0000-4000-8000-000000000002',
     'wonsusan','wonsusan-main','demo-wonsusan-route-2',
     '2026-03-29T08:00:00Z','2026-03-29T08:54:00Z','ingested','beta-upload-consent-v1',
     9,0,'2026-06-29T00:00:00Z'),
    ('91100000-0000-4000-8000-000000000003','11100000-0000-4000-8000-000000000003',
     'wonsusan','wonsusan-main','demo-wonsusan-route-3',
     '2026-04-05T06:30:00Z','2026-04-05T07:24:00Z','ingested','beta-upload-consent-v1',
     9,0,'2026-07-05T00:00:00Z'),
    ('91100000-0000-4000-8000-000000000004','11100000-0000-4000-8000-000000000004',
     'wonsusan','wonsusan-main','demo-wonsusan-route-4',
     '2026-04-12T07:30:00Z','2026-04-12T08:24:00Z','ingested','beta-upload-consent-v1',
     9,1,'2026-07-12T00:00:00Z'),
    ('91100000-0000-4000-8000-000000000005','11100000-0000-4000-8000-000000000005',
     'wonsusan','wonsusan-main','demo-wonsusan-route-5',
     '2026-04-26T08:00:00Z','2026-04-26T08:54:00Z','ingested','beta-upload-consent-v1',
     9,0,'2026-07-26T00:00:00Z'),
    ('91100000-0000-4000-8000-000000000006','11100000-0000-4000-8000-000000000006',
     'wonsusan','wonsusan-main','demo-wonsusan-route-6',
     '2026-05-03T07:00:00Z','2026-05-03T07:54:00Z','ingested','beta-upload-consent-v1',
     9,0,'2026-08-03T00:00:00Z')
  on conflict (id) do update
    set status               = excluded.status,
        route_id             = excluded.route_id,
        accepted_point_count = excluded.accepted_point_count,
        rejected_point_count = excluded.rejected_point_count
  returning id, client_session_key, started_at
),
track_seed as (
  insert into public.track_points (
    session_id, mountain_id, recorded_at, geom,
    altitude, accuracy, speed, quality_score, sequence_index
  )
  select
    demo_sessions.id, 'wonsusan',
    demo_sessions.started_at + make_interval(mins => route_points.sequence_index * 6),
    st_setsrid(
      st_makepoint(
        route_points.lon + case demo_sessions.client_session_key
          when 'demo-wonsusan-route-2' then  0.00002
          when 'demo-wonsusan-route-3' then -0.00003
          when 'demo-wonsusan-route-4' then  0.00001
          when 'demo-wonsusan-route-5' then -0.00001
          when 'demo-wonsusan-route-6' then  0.00003
          else 0 end,
        route_points.lat + case demo_sessions.client_session_key
          when 'demo-wonsusan-route-2' then -0.00001
          when 'demo-wonsusan-route-3' then  0.00002
          when 'demo-wonsusan-route-4' then  0.00001
          when 'demo-wonsusan-route-5' then -0.00002
          when 'demo-wonsusan-route-6' then -0.00002
          else 0 end
      ), 4326
    )::geography,
    route_points.altitude,
    case demo_sessions.client_session_key when 'demo-wonsusan-route-4' then 11.5 else 8.5 end,
    1.2,
    case demo_sessions.client_session_key when 'demo-wonsusan-route-4' then 0.88 else 0.92 end,
    route_points.sequence_index
  from demo_sessions cross join route_points
  returning id
),
rejected_seed as (
  insert into public.rejected_track_points (
    session_id, reason, recorded_at, lat, lon, altitude,
    accuracy, speed, point_sequence_index,
    debug_payload_sample, debug_payload_expires_at
  )
  values (
    '91100000-0000-4000-8000-000000000004', 'low_accuracy',
    '2026-04-12T07:54:00Z', 36.4672, 127.2834, 185.0, 91.0, 1.1, 42,
    '{"demo":true,"reason":"low_accuracy"}'::jsonb, '2026-04-19T00:00:00Z'
  )
  returning id
),
canonical_seed as (
  insert into public.canonical_trails (
    route_id, version, geom, confidence, confidence_level,
    session_count, branch_ambiguity_score, gps_quality_score, updated_at
  )
  values (
    'wonsusan-main', 2,
    'LINESTRING(127.2785 36.4640,127.2799 36.4649,127.2812 36.4657,127.2823 36.4664,127.2833 36.4671,127.2841 36.4678,127.2849 36.4685,127.2854 36.4693,127.2860 36.4700)'::geography,
    0.87, 'recommended', 6, 0.09, 0.91, '2026-05-04T00:00:00Z'
  )
  returning id
),
cell_values(cell_key, lat, lon, point_count, session_count, avg_altitude, last_seen_at, quality_score) as (
  values
    ('ws-00', 36.4640, 127.2785, 6, 6, 110.0, '2026-05-03T07:00:00Z'::timestamptz, 0.92),
    ('ws-01', 36.4649, 127.2799, 6, 6, 133.0, '2026-05-03T07:06:00Z'::timestamptz, 0.92),
    ('ws-02', 36.4657, 127.2812, 6, 6, 153.0, '2026-05-03T07:12:00Z'::timestamptz, 0.92),
    ('ws-03', 36.4664, 127.2823, 6, 6, 170.0, '2026-05-03T07:18:00Z'::timestamptz, 0.91),
    ('ws-04', 36.4671, 127.2833, 6, 6, 185.0, '2026-05-03T07:24:00Z'::timestamptz, 0.91),
    ('ws-05', 36.4678, 127.2841, 6, 6, 198.0, '2026-05-03T07:30:00Z'::timestamptz, 0.91),
    ('ws-06', 36.4685, 127.2849, 6, 6, 210.0, '2026-05-03T07:36:00Z'::timestamptz, 0.92),
    ('ws-07', 36.4693, 127.2854, 6, 6, 220.0, '2026-05-03T07:42:00Z'::timestamptz, 0.92),
    ('ws-08', 36.4700, 127.2860, 6, 6, 228.0, '2026-05-03T07:48:00Z'::timestamptz, 0.92)
),
cell_seed as (
  insert into public.trail_cells (
    route_id, cell_key, geom, point_count, session_count,
    avg_accuracy, avg_altitude, last_seen_at, quality_score
  )
  select 'wonsusan-main', cell_key,
    st_setsrid(st_makepoint(lon, lat), 4326)::geography,
    point_count, session_count, 8.73, avg_altitude, last_seen_at, quality_score
  from cell_values
  returning cell_key
),
transition_values(from_cell_key, to_cell_key, transition_count, session_count, edge_cost) as (
  values
    ('ws-00','ws-01', 6,6,0.22),('ws-01','ws-02', 6,6,0.22),
    ('ws-02','ws-03', 6,6,0.22),('ws-03','ws-04', 6,6,0.23),
    ('ws-04','ws-05', 6,6,0.23),('ws-05','ws-06', 6,6,0.22),
    ('ws-06','ws-07', 6,6,0.22),('ws-07','ws-08', 6,6,0.21)
),
transition_seed as (
  insert into public.trail_cell_transitions (
    route_id, from_cell_key, to_cell_key, transition_count, session_count, edge_cost
  )
  select 'wonsusan-main', from_cell_key, to_cell_key, transition_count, session_count, edge_cost
  from transition_values
  returning id
)
select 'wonsusan' as mountain_id, 'wonsusan-main' as route_id,
  (select count(*) from track_seed) as accepted_track_points,
  (select count(*) from rejected_seed) as rejected_track_points,
  (select count(*) from canonical_seed) as canonical_routes,
  (select count(*) from cell_seed) as trail_cells,
  (select count(*) from transition_seed) as trail_transitions;


-- =============================================================================
-- 전월산 (jeonwolsan) 260m — RECOMMENDED — 5 sessions
-- Route: E trailhead (금남면) → summit plateau, 8 waypoints
-- Trailhead: 36.4985, 127.2420  Summit: 36.5030, 127.2510
-- =============================================================================
with route_points(sequence_index, lat, lon, altitude) as (
  values
    (0, 36.4985, 127.2420, 100.0),
    (1, 36.4993, 127.2438, 127.0),
    (2, 36.5003, 127.2454, 155.0),
    (3, 36.5010, 127.2468, 178.0),
    (4, 36.5015, 127.2480, 199.0),
    (5, 36.5020, 127.2491, 216.0),
    (6, 36.5026, 127.2500, 237.0),
    (7, 36.5030, 127.2510, 260.0)
),
demo_sessions as (
  insert into public.hiking_sessions (
    id, user_id, mountain_id, route_id, client_session_key,
    started_at, ended_at, status, upload_consent_version,
    accepted_point_count, rejected_point_count, retention_review_at
  )
  values
    ('91200000-0000-4000-8000-000000000001','11200000-0000-4000-8000-000000000001',
     'jeonwolsan','jeonwolsan-main','demo-jeonwolsan-route-1',
     '2026-04-05T08:30:00Z','2026-04-05T09:18:00Z','ingested','beta-upload-consent-v1',
     8,0,'2026-07-05T00:00:00Z'),
    ('91200000-0000-4000-8000-000000000002','11200000-0000-4000-8000-000000000002',
     'jeonwolsan','jeonwolsan-main','demo-jeonwolsan-route-2',
     '2026-04-12T09:00:00Z','2026-04-12T09:48:00Z','ingested','beta-upload-consent-v1',
     8,0,'2026-07-12T00:00:00Z'),
    ('91200000-0000-4000-8000-000000000003','11200000-0000-4000-8000-000000000003',
     'jeonwolsan','jeonwolsan-main','demo-jeonwolsan-route-3',
     '2026-04-19T07:30:00Z','2026-04-19T08:18:00Z','ingested','beta-upload-consent-v1',
     8,1,'2026-07-19T00:00:00Z'),
    ('91200000-0000-4000-8000-000000000004','11200000-0000-4000-8000-000000000004',
     'jeonwolsan','jeonwolsan-main','demo-jeonwolsan-route-4',
     '2026-04-26T08:00:00Z','2026-04-26T08:48:00Z','ingested','beta-upload-consent-v1',
     8,0,'2026-07-26T00:00:00Z'),
    ('91200000-0000-4000-8000-000000000005','11200000-0000-4000-8000-000000000005',
     'jeonwolsan','jeonwolsan-main','demo-jeonwolsan-route-5',
     '2026-05-05T07:00:00Z','2026-05-05T07:48:00Z','ingested','beta-upload-consent-v1',
     8,0,'2026-08-05T00:00:00Z')
  on conflict (id) do update
    set status               = excluded.status,
        route_id             = excluded.route_id,
        accepted_point_count = excluded.accepted_point_count,
        rejected_point_count = excluded.rejected_point_count
  returning id, client_session_key, started_at
),
track_seed as (
  insert into public.track_points (
    session_id, mountain_id, recorded_at, geom,
    altitude, accuracy, speed, quality_score, sequence_index
  )
  select
    demo_sessions.id, 'jeonwolsan',
    demo_sessions.started_at + make_interval(mins => route_points.sequence_index * 6),
    st_setsrid(
      st_makepoint(
        route_points.lon + case demo_sessions.client_session_key
          when 'demo-jeonwolsan-route-2' then  0.00003
          when 'demo-jeonwolsan-route-3' then -0.00002
          when 'demo-jeonwolsan-route-4' then  0.00001
          when 'demo-jeonwolsan-route-5' then -0.00002
          else 0 end,
        route_points.lat + case demo_sessions.client_session_key
          when 'demo-jeonwolsan-route-2' then -0.00001
          when 'demo-jeonwolsan-route-3' then  0.00003
          when 'demo-jeonwolsan-route-4' then  0.00002
          when 'demo-jeonwolsan-route-5' then -0.00001
          else 0 end
      ), 4326
    )::geography,
    route_points.altitude,
    case demo_sessions.client_session_key when 'demo-jeonwolsan-route-3' then 12.0 else 9.2 end,
    1.3,
    case demo_sessions.client_session_key when 'demo-jeonwolsan-route-3' then 0.87 else 0.90 end,
    route_points.sequence_index
  from demo_sessions cross join route_points
  returning id
),
rejected_seed as (
  insert into public.rejected_track_points (
    session_id, reason, recorded_at, lat, lon, altitude,
    accuracy, speed, point_sequence_index,
    debug_payload_sample, debug_payload_expires_at
  )
  values (
    '91200000-0000-4000-8000-000000000003', 'low_accuracy',
    '2026-04-19T07:48:00Z', 36.5011, 127.2470, 178.0, 79.0, 1.4, 35,
    '{"demo":true,"reason":"low_accuracy"}'::jsonb, '2026-04-26T00:00:00Z'
  )
  returning id
),
canonical_seed as (
  insert into public.canonical_trails (
    route_id, version, geom, confidence, confidence_level,
    session_count, branch_ambiguity_score, gps_quality_score, updated_at
  )
  values (
    'jeonwolsan-main', 1,
    'LINESTRING(127.2420 36.4985,127.2438 36.4993,127.2454 36.5003,127.2468 36.5010,127.2480 36.5015,127.2491 36.5020,127.2500 36.5026,127.2510 36.5030)'::geography,
    0.82, 'recommended', 5, 0.13, 0.88, '2026-05-06T00:00:00Z'
  )
  returning id
),
cell_values(cell_key, lat, lon, point_count, session_count, avg_altitude, last_seen_at, quality_score) as (
  values
    ('jwl-00',36.4985,127.2420,5,5,100.0,'2026-05-05T07:00:00Z'::timestamptz,0.90),
    ('jwl-01',36.4993,127.2438,5,5,127.0,'2026-05-05T07:06:00Z'::timestamptz,0.90),
    ('jwl-02',36.5003,127.2454,5,5,155.0,'2026-05-05T07:12:00Z'::timestamptz,0.90),
    ('jwl-03',36.5010,127.2468,5,5,178.0,'2026-05-05T07:18:00Z'::timestamptz,0.89),
    ('jwl-04',36.5015,127.2480,5,5,199.0,'2026-05-05T07:24:00Z'::timestamptz,0.89),
    ('jwl-05',36.5020,127.2491,5,5,216.0,'2026-05-05T07:30:00Z'::timestamptz,0.90),
    ('jwl-06',36.5026,127.2500,5,5,237.0,'2026-05-05T07:36:00Z'::timestamptz,0.90),
    ('jwl-07',36.5030,127.2510,5,5,260.0,'2026-05-05T07:42:00Z'::timestamptz,0.91)
),
cell_seed as (
  insert into public.trail_cells (
    route_id, cell_key, geom, point_count, session_count,
    avg_accuracy, avg_altitude, last_seen_at, quality_score
  )
  select 'jeonwolsan-main', cell_key,
    st_setsrid(st_makepoint(lon, lat), 4326)::geography,
    point_count, session_count, 9.44, avg_altitude, last_seen_at, quality_score
  from cell_values
  returning cell_key
),
transition_values(from_cell_key, to_cell_key, transition_count, session_count, edge_cost) as (
  values
    ('jwl-00','jwl-01',5,5,0.24),('jwl-01','jwl-02',5,5,0.24),
    ('jwl-02','jwl-03',5,5,0.24),('jwl-03','jwl-04',5,5,0.25),
    ('jwl-04','jwl-05',5,5,0.25),('jwl-05','jwl-06',5,5,0.24),
    ('jwl-06','jwl-07',5,5,0.23)
),
transition_seed as (
  insert into public.trail_cell_transitions (
    route_id, from_cell_key, to_cell_key, transition_count, session_count, edge_cost
  )
  select 'jeonwolsan-main', from_cell_key, to_cell_key, transition_count, session_count, edge_cost
  from transition_values
  returning id
)
select 'jeonwolsan' as mountain_id, 'jeonwolsan-main' as route_id,
  (select count(*) from track_seed) as accepted_track_points,
  (select count(*) from rejected_seed) as rejected_track_points,
  (select count(*) from canonical_seed) as canonical_routes,
  (select count(*) from cell_seed) as trail_cells,
  (select count(*) from transition_seed) as trail_transitions;


-- =============================================================================
-- 비학산 (bihaksan) 202m — REFERENCE — 3 sessions
-- Route: W trailhead (연동면) → summit, 7 waypoints
-- Trailhead: 36.4543, 127.3008  Summit: 36.4608, 127.3085
-- =============================================================================
with route_points(sequence_index, lat, lon, altitude) as (
  values
    (0, 36.4543, 127.3008,  90.0),
    (1, 36.4557, 127.3023, 114.0),
    (2, 36.4567, 127.3039, 138.0),
    (3, 36.4576, 127.3052, 157.0),
    (4, 36.4588, 127.3063, 174.0),
    (5, 36.4598, 127.3074, 188.0),
    (6, 36.4608, 127.3085, 202.0)
),
demo_sessions as (
  insert into public.hiking_sessions (
    id, user_id, mountain_id, route_id, client_session_key,
    started_at, ended_at, status, upload_consent_version,
    accepted_point_count, rejected_point_count, retention_review_at
  )
  values
    ('91300000-0000-4000-8000-000000000001','11300000-0000-4000-8000-000000000001',
     'bihaksan','bihaksan-main','demo-bihaksan-route-1',
     '2026-04-20T08:00:00Z','2026-04-20T08:42:00Z','ingested','beta-upload-consent-v1',
     7,0,'2026-07-20T00:00:00Z'),
    ('91300000-0000-4000-8000-000000000002','11300000-0000-4000-8000-000000000002',
     'bihaksan','bihaksan-main','demo-bihaksan-route-2',
     '2026-04-26T07:30:00Z','2026-04-26T08:12:00Z','ingested','beta-upload-consent-v1',
     7,0,'2026-07-26T00:00:00Z'),
    ('91300000-0000-4000-8000-000000000003','11300000-0000-4000-8000-000000000003',
     'bihaksan','bihaksan-main','demo-bihaksan-route-3',
     '2026-05-04T09:00:00Z','2026-05-04T09:42:00Z','ingested','beta-upload-consent-v1',
     7,1,'2026-08-04T00:00:00Z')
  on conflict (id) do update
    set status               = excluded.status,
        route_id             = excluded.route_id,
        accepted_point_count = excluded.accepted_point_count,
        rejected_point_count = excluded.rejected_point_count
  returning id, client_session_key, started_at
),
track_seed as (
  insert into public.track_points (
    session_id, mountain_id, recorded_at, geom,
    altitude, accuracy, speed, quality_score, sequence_index
  )
  select
    demo_sessions.id, 'bihaksan',
    demo_sessions.started_at + make_interval(mins => route_points.sequence_index * 6),
    st_setsrid(
      st_makepoint(
        route_points.lon + case demo_sessions.client_session_key
          when 'demo-bihaksan-route-2' then  0.00002
          when 'demo-bihaksan-route-3' then -0.00004
          else 0 end,
        route_points.lat + case demo_sessions.client_session_key
          when 'demo-bihaksan-route-2' then  0.00001
          when 'demo-bihaksan-route-3' then -0.00003
          else 0 end
      ), 4326
    )::geography,
    route_points.altitude, 10.8, 1.0, 0.85,
    route_points.sequence_index
  from demo_sessions cross join route_points
  returning id
),
rejected_seed as (
  insert into public.rejected_track_points (
    session_id, reason, recorded_at, lat, lon, altitude,
    accuracy, speed, point_sequence_index,
    debug_payload_sample, debug_payload_expires_at
  )
  values (
    '91300000-0000-4000-8000-000000000003', 'speed_outlier',
    '2026-05-04T09:30:00Z', 36.4598, 127.3075, 188.0, 12.0, 7.8, 55,
    '{"demo":true,"reason":"speed_outlier"}'::jsonb, '2026-05-11T00:00:00Z'
  )
  returning id
),
canonical_seed as (
  insert into public.canonical_trails (
    route_id, version, geom, confidence, confidence_level,
    session_count, branch_ambiguity_score, gps_quality_score, updated_at
  )
  values (
    'bihaksan-main', 1,
    'LINESTRING(127.3008 36.4543,127.3023 36.4557,127.3039 36.4567,127.3052 36.4576,127.3063 36.4588,127.3074 36.4598,127.3085 36.4608)'::geography,
    0.64, 'reference', 3, 0.27, 0.84, '2026-05-05T00:00:00Z'
  )
  returning id
),
cell_values(cell_key, lat, lon, point_count, session_count, avg_altitude, last_seen_at, quality_score) as (
  values
    ('bhs-00',36.4543,127.3008,3,3, 90.0,'2026-05-04T09:00:00Z'::timestamptz,0.85),
    ('bhs-01',36.4557,127.3023,3,3,114.0,'2026-05-04T09:06:00Z'::timestamptz,0.85),
    ('bhs-02',36.4567,127.3039,3,3,138.0,'2026-05-04T09:12:00Z'::timestamptz,0.84),
    ('bhs-03',36.4576,127.3052,3,3,157.0,'2026-05-04T09:18:00Z'::timestamptz,0.84),
    ('bhs-04',36.4588,127.3063,3,3,174.0,'2026-05-04T09:24:00Z'::timestamptz,0.84),
    ('bhs-05',36.4598,127.3074,3,3,188.0,'2026-05-04T09:30:00Z'::timestamptz,0.84),
    ('bhs-06',36.4608,127.3085,3,3,202.0,'2026-05-04T09:36:00Z'::timestamptz,0.85)
),
cell_seed as (
  insert into public.trail_cells (
    route_id, cell_key, geom, point_count, session_count,
    avg_accuracy, avg_altitude, last_seen_at, quality_score
  )
  select 'bihaksan-main', cell_key,
    st_setsrid(st_makepoint(lon, lat), 4326)::geography,
    point_count, session_count, 10.80, avg_altitude, last_seen_at, quality_score
  from cell_values
  returning cell_key
),
transition_values(from_cell_key, to_cell_key, transition_count, session_count, edge_cost) as (
  values
    ('bhs-00','bhs-01',3,3,0.31),('bhs-01','bhs-02',3,3,0.30),
    ('bhs-02','bhs-03',3,3,0.31),('bhs-03','bhs-04',3,3,0.30),
    ('bhs-04','bhs-05',3,3,0.31),('bhs-05','bhs-06',3,3,0.30)
),
transition_seed as (
  insert into public.trail_cell_transitions (
    route_id, from_cell_key, to_cell_key, transition_count, session_count, edge_cost
  )
  select 'bihaksan-main', from_cell_key, to_cell_key, transition_count, session_count, edge_cost
  from transition_values
  returning id
)
select 'bihaksan' as mountain_id, 'bihaksan-main' as route_id,
  (select count(*) from track_seed) as accepted_track_points,
  (select count(*) from rejected_seed) as rejected_track_points,
  (select count(*) from canonical_seed) as canonical_routes,
  (select count(*) from cell_seed) as trail_cells,
  (select count(*) from transition_seed) as trail_transitions;


-- =============================================================================
-- 장군산 (janggunsan) 248m — NONE — 2 sessions (route defined, no canonical trail)
-- Route: S trailhead → summit, 6 waypoints
-- Trailhead: 36.5148, 127.2643  Summit: 36.5185, 127.2696
-- =============================================================================
with route_points(sequence_index, lat, lon, altitude) as (
  values
    (0, 36.5148, 127.2643, 130.0),
    (1, 36.5157, 127.2654, 155.0),
    (2, 36.5163, 127.2664, 178.0),
    (3, 36.5170, 127.2674, 200.0),
    (4, 36.5178, 127.2684, 222.0),
    (5, 36.5185, 127.2696, 248.0)
),
demo_sessions as (
  insert into public.hiking_sessions (
    id, user_id, mountain_id, route_id, client_session_key,
    started_at, ended_at, status, upload_consent_version,
    accepted_point_count, rejected_point_count, retention_review_at
  )
  values
    ('91400000-0000-4000-8000-000000000001','11400000-0000-4000-8000-000000000001',
     'janggunsan','janggunsan-main','demo-janggunsan-route-1',
     '2026-05-03T08:00:00Z','2026-05-03T08:36:00Z','ingested','beta-upload-consent-v1',
     6,0,'2026-08-03T00:00:00Z'),
    ('91400000-0000-4000-8000-000000000002','11400000-0000-4000-8000-000000000002',
     'janggunsan','janggunsan-main','demo-janggunsan-route-2',
     '2026-05-07T07:30:00Z','2026-05-07T08:06:00Z','ingested','beta-upload-consent-v1',
     6,1,'2026-08-07T00:00:00Z')
  on conflict (id) do update
    set status               = excluded.status,
        route_id             = excluded.route_id,
        accepted_point_count = excluded.accepted_point_count,
        rejected_point_count = excluded.rejected_point_count
  returning id, client_session_key, started_at
),
track_seed as (
  insert into public.track_points (
    session_id, mountain_id, recorded_at, geom,
    altitude, accuracy, speed, quality_score, sequence_index
  )
  select
    demo_sessions.id, 'janggunsan',
    demo_sessions.started_at + make_interval(mins => route_points.sequence_index * 6),
    st_setsrid(
      st_makepoint(
        route_points.lon + case demo_sessions.client_session_key
          when 'demo-janggunsan-route-2' then 0.00004 else 0 end,
        route_points.lat + case demo_sessions.client_session_key
          when 'demo-janggunsan-route-2' then -0.00003 else 0 end
      ), 4326
    )::geography,
    route_points.altitude, 13.5, 0.9, 0.81,
    route_points.sequence_index
  from demo_sessions cross join route_points
  returning id
),
rejected_seed as (
  insert into public.rejected_track_points (
    session_id, reason, recorded_at, lat, lon, altitude,
    accuracy, speed, point_sequence_index,
    debug_payload_sample, debug_payload_expires_at
  )
  values (
    '91400000-0000-4000-8000-000000000002', 'low_accuracy',
    '2026-05-07T07:48:00Z', 36.5171, 127.2676, 200.0, 97.0, 0.8, 28,
    '{"demo":true,"reason":"low_accuracy"}'::jsonb, '2026-05-14T00:00:00Z'
  )
  returning id
)
select 'janggunsan' as mountain_id, 'janggunsan-main' as route_id,
  (select count(*) from track_seed) as accepted_track_points,
  (select count(*) from rejected_seed) as rejected_track_points,
  0 as canonical_routes, 0 as trail_cells, 0 as trail_transitions;


-- =============================================================================
-- 국사봉 (guksabong-sejong) 186m — NONE — 1 session (route defined, no canonical trail)
-- Route: W trailhead (연기면 외곽) → summit, 5 waypoints
-- Trailhead: 36.4798, 127.3230  Summit: 36.4843, 127.3282
-- =============================================================================
with route_points(sequence_index, lat, lon, altitude) as (
  values
    (0, 36.4798, 127.3230,  95.0),
    (1, 36.4812, 127.3244, 119.0),
    (2, 36.4823, 127.3257, 143.0),
    (3, 36.4834, 127.3269, 164.0),
    (4, 36.4843, 127.3282, 186.0)
),
demo_sessions as (
  insert into public.hiking_sessions (
    id, user_id, mountain_id, route_id, client_session_key,
    started_at, ended_at, status, upload_consent_version,
    accepted_point_count, rejected_point_count, retention_review_at
  )
  values
    ('91500000-0000-4000-8000-000000000001','11500000-0000-4000-8000-000000000001',
     'guksabong-sejong','guksabong-sejong-main','demo-guksabong-route-1',
     '2026-05-07T09:30:00Z','2026-05-07T10:00:00Z','ingested','beta-upload-consent-v1',
     5,0,'2026-08-07T00:00:00Z')
  on conflict (id) do update
    set status               = excluded.status,
        route_id             = excluded.route_id,
        accepted_point_count = excluded.accepted_point_count,
        rejected_point_count = excluded.rejected_point_count
  returning id, client_session_key, started_at
),
track_seed as (
  insert into public.track_points (
    session_id, mountain_id, recorded_at, geom,
    altitude, accuracy, speed, quality_score, sequence_index
  )
  select
    demo_sessions.id, 'guksabong-sejong',
    demo_sessions.started_at + make_interval(mins => route_points.sequence_index * 6),
    st_setsrid(st_makepoint(route_points.lon, route_points.lat), 4326)::geography,
    route_points.altitude, 14.2, 0.8, 0.79,
    route_points.sequence_index
  from demo_sessions cross join route_points
  returning id
)
select 'guksabong-sejong' as mountain_id, 'guksabong-sejong-main' as route_id,
  (select count(*) from track_seed) as accepted_track_points,
  0 as rejected_track_points, 0 as canonical_routes,
  0 as trail_cells, 0 as trail_transitions;


-- ── MVP events ────────────────────────────────────────────────────────────────

insert into public.mvp_events (user_id, mountain_id, session_id, event_name, event_payload, created_at)
values
  (null,'wonsusan',null,'trail_served',   '{"routeState":"recommended","routeId":"wonsusan-main","version":2}'::jsonb,           '2026-05-04T08:10:00Z'),
  (null,'wonsusan',null,'trail_served',   '{"routeState":"recommended","routeId":"wonsusan-main","version":2}'::jsonb,           '2026-05-04T08:11:00Z'),
  (null,'wonsusan',null,'trail_served',   '{"routeState":"recommended","routeId":"wonsusan-main","version":2}'::jsonb,           '2026-05-04T09:05:00Z'),
  (null,'wonsusan',null,'trail_served',   '{"routeState":"recommended","routeId":"wonsusan-main","version":2}'::jsonb,           '2026-05-05T07:32:00Z'),
  (null,'wonsusan',null,'snap_requested', '{"routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":2}'::jsonb,       '2026-05-04T08:15:00Z'),
  (null,'wonsusan',null,'snap_requested', '{"routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":2}'::jsonb,       '2026-05-04T09:10:00Z'),
  (null,'wonsusan',null,'snap_requested', '{"routeJudgment":"caution","distanceBucket":"26-50m","trailVersion":2}'::jsonb,       '2026-05-05T07:40:00Z'),
  (null,'jeonwolsan',null,'trail_served', '{"routeState":"recommended","routeId":"jeonwolsan-main","version":1}'::jsonb,         '2026-05-06T08:20:00Z'),
  (null,'jeonwolsan',null,'trail_served', '{"routeState":"recommended","routeId":"jeonwolsan-main","version":1}'::jsonb,         '2026-05-06T09:15:00Z'),
  (null,'jeonwolsan',null,'trail_served', '{"routeState":"recommended","routeId":"jeonwolsan-main","version":1}'::jsonb,         '2026-05-07T07:55:00Z'),
  (null,'jeonwolsan',null,'snap_requested','{"routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'::jsonb,      '2026-05-06T08:25:00Z'),
  (null,'jeonwolsan',null,'snap_requested','{"routeJudgment":"caution","distanceBucket":"26-50m","trailVersion":1}'::jsonb,      '2026-05-07T08:05:00Z'),
  (null,'bihaksan',null,'trail_served',   '{"routeState":"reference","routeId":"bihaksan-main","version":1}'::jsonb,             '2026-05-05T08:30:00Z'),
  (null,'bihaksan',null,'snap_requested', '{"routeJudgment":"caution","distanceBucket":"26-50m","trailVersion":1}'::jsonb,       '2026-05-05T08:35:00Z');

commit;
