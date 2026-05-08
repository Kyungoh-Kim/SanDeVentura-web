-- =============================================================================
-- 0014_sample_data.sql
-- Development / QA sample data.  DO NOT apply to production.
--
-- Scenario matrix:
--   sorak   — 2 routes: recommended (5 sessions) + reference (2 sessions)
--   halla   — 1 route : reference (1 session)
--   dobong  — 1 route : recommended (4 sessions)
--   jiri    — 2 routes: both 'none', north route has 3 UNPROCESSED ingested sessions
--   bukhan  — 0 routes (mountain with no routes defined)
-- =============================================================================

-- ── Mountains ─────────────────────────────────────────────────────────────────

insert into public.mountains (id, display_name, bbox) values
  ('sorak',  '설악산 (Seorak)',  '128.40,38.08,128.55,38.20'),
  ('halla',  '한라산 (Halla)',   '126.45,33.30,126.65,33.45'),
  ('dobong', '도봉산 (Dobong)',  '127.00,37.65,127.08,37.73'),
  ('jiri',   '지리산 (Jiri)',    '127.60,35.25,127.85,35.50'),
  ('bukhan', '북한산 (Bukhan)',  '126.96,37.63,127.03,37.72')
on conflict (id) do update set
  display_name = excluded.display_name,
  bbox         = excluded.bbox;

-- ── Routes ────────────────────────────────────────────────────────────────────

insert into public.routes (id, mountain_id, display_name) values
  ('sorak-main',      'sorak',  '주능선 코스'),
  ('sorak-alternate', 'sorak',  '울산바위 우회'),
  ('halla-main',      'halla',  '성판악 코스'),
  ('dobong-main',     'dobong', '도봉산 주등산로'),
  ('jiri-north',      'jiri',   '노고단 북쪽'),
  ('jiri-south',      'jiri',   '천왕봉 남쪽')
on conflict (id) do nothing;

-- ── Canonical trails ──────────────────────────────────────────────────────────
-- Route states:
--   sorak-main  : recommended (confidence 0.82, 5 sessions)
--   sorak-alt   : reference   (confidence 0.54, 2 sessions)
--   halla-main  : reference   (confidence 0.42, 1 session)
--   dobong-main : recommended (confidence 0.76, 4 sessions)
--   jiri-north  : none — no row inserted
--   jiri-south  : none — no row inserted

insert into public.canonical_trails
  (route_id, version, geom, confidence, confidence_level, session_count, branch_ambiguity_score, gps_quality_score)
values
  (
    'sorak-main', 1,
    st_geogfromtext(
      'LINESTRING(128.47000 38.12000,128.47025 38.12025,128.47050 38.12050,'
      ||           '128.47075 38.12075,128.47100 38.12100,128.47125 38.12125)'
    ),
    0.82, 'recommended', 5, 0.04, 0.88
  ),
  (
    'sorak-alternate', 1,
    st_geogfromtext(
      'LINESTRING(128.47000 38.12000,128.46975 38.11975,128.46950 38.11950,128.46925 38.11925)'
    ),
    0.54, 'reference', 2, 0.18, 0.75
  ),
  (
    'halla-main', 1,
    st_geogfromtext(
      'LINESTRING(126.53000 33.36000,126.53025 33.36025,126.53050 33.36050,'
      ||           '126.53075 33.36075,126.53100 33.36100)'
    ),
    0.42, 'reference', 1, 0.22, 0.70
  ),
  (
    'dobong-main', 1,
    st_geogfromtext(
      'LINESTRING(127.01000 37.68000,127.01025 37.68025,127.01050 37.68050,'
      ||           '127.01075 37.68075,127.01100 37.68100,127.01125 37.68125)'
    ),
    0.76, 'recommended', 4, 0.06, 0.85
  )
on conflict (route_id, version) do nothing;

-- ── Trail cells ───────────────────────────────────────────────────────────────
-- Cell keys are H3 hexagonal cell IDs at resolution 11 (edge ~24 m).

-- sorak-main  (6 cells, NE direction from 38.12°N 128.47°E)
insert into public.trail_cells
  (route_id, cell_key, geom, point_count, session_count, avg_accuracy, avg_altitude, last_seen_at, quality_score)
values
  ('sorak-main','8b30ec15db9bfff',st_geogfromtext('POINT(128.47000 38.12000)'),15,5, 8.2, 820,'2026-04-10T09:00:00Z',0.92),
  ('sorak-main','8b30ec15db99fff',st_geogfromtext('POINT(128.47025 38.12025)'),14,5, 7.8, 835,'2026-04-10T09:05:00Z',0.92),
  ('sorak-main','8b30ec15daa4fff',st_geogfromtext('POINT(128.47050 38.12050)'),16,5, 9.1, 850,'2026-04-10T09:10:00Z',0.91),
  ('sorak-main','8b30ec15db8bfff',st_geogfromtext('POINT(128.47075 38.12075)'),13,5, 8.5, 865,'2026-04-10T09:15:00Z',0.92),
  ('sorak-main','8b30ec15da16fff',st_geogfromtext('POINT(128.47100 38.12100)'),15,5, 7.2, 880,'2026-04-10T09:20:00Z',0.93),
  ('sorak-main','8b30ec15da10fff',st_geogfromtext('POINT(128.47125 38.12125)'),14,5, 8.9, 895,'2026-04-10T09:25:00Z',0.91)
on conflict (route_id, cell_key) do nothing;

-- sorak-alternate  (4 cells, SW from the shared start)
insert into public.trail_cells
  (route_id, cell_key, geom, point_count, session_count, avg_accuracy, avg_altitude, last_seen_at, quality_score)
values
  ('sorak-alternate','8b30ec15db9bfff',st_geogfromtext('POINT(128.47000 38.12000)'), 6,2,12.0,820,'2026-03-15T10:00:00Z',0.88),
  ('sorak-alternate','8b30ec15db9afff',st_geogfromtext('POINT(128.46975 38.11975)'), 5,2,13.5,808,'2026-03-15T10:05:00Z',0.87),
  ('sorak-alternate','8b30ec15d169fff',st_geogfromtext('POINT(128.46950 38.11950)'), 6,2,11.8,796,'2026-03-15T10:10:00Z',0.88),
  ('sorak-alternate','8b30ec15d168fff',st_geogfromtext('POINT(128.46925 38.11925)'), 5,2,14.2,784,'2026-03-15T10:15:00Z',0.86)
on conflict (route_id, cell_key) do nothing;

-- halla-main  (5 cells, 33.36°N 126.53°E)
insert into public.trail_cells
  (route_id, cell_key, geom, point_count, session_count, avg_accuracy, avg_altitude, last_seen_at, quality_score)
values
  ('halla-main','8b30d15084acfff',st_geogfromtext('POINT(126.53000 33.36000)'),4,1,15.0, 950,'2026-02-20T08:00:00Z',0.85),
  ('halla-main','8b30d1508413fff',st_geogfromtext('POINT(126.53025 33.36025)'),4,1,16.2, 975,'2026-02-20T08:10:00Z',0.84),
  ('halla-main','8b30d1508411fff',st_geogfromtext('POINT(126.53050 33.36050)'),3,1,14.8,1000,'2026-02-20T08:20:00Z',0.85),
  ('halla-main','8b30d150841cfff',st_geogfromtext('POINT(126.53075 33.36075)'),4,1,15.5,1025,'2026-02-20T08:30:00Z',0.85),
  ('halla-main','8b30d1508403fff',st_geogfromtext('POINT(126.53100 33.36100)'),3,1,17.0,1050,'2026-02-20T08:40:00Z',0.83)
on conflict (route_id, cell_key) do nothing;

-- dobong-main  (6 cells, 37.68°N 127.01°E)
insert into public.trail_cells
  (route_id, cell_key, geom, point_count, session_count, avg_accuracy, avg_altitude, last_seen_at, quality_score)
values
  ('dobong-main','8b30e1d0aa8cfff',st_geogfromtext('POINT(127.01000 37.68000)'),12,4, 7.5,280,'2026-04-05T07:00:00Z',0.93),
  ('dobong-main','8b30e1d0aaabfff',st_geogfromtext('POINT(127.01025 37.68025)'),11,4, 8.0,305,'2026-04-05T07:10:00Z',0.92),
  ('dobong-main','8b30e1d0aaf6fff',st_geogfromtext('POINT(127.01050 37.68050)'),12,4, 7.2,330,'2026-04-05T07:20:00Z',0.93),
  ('dobong-main','8b30e1d0aaf0fff',st_geogfromtext('POINT(127.01075 37.68075)'),11,4, 8.8,355,'2026-04-05T07:30:00Z',0.91),
  ('dobong-main','8b30e1d0aaf5fff',st_geogfromtext('POINT(127.01100 37.68100)'),12,4, 7.0,380,'2026-04-05T07:40:00Z',0.93),
  ('dobong-main','8b30e1d0aae2fff',st_geogfromtext('POINT(127.01125 37.68125)'),10,4, 9.5,405,'2026-04-05T07:50:00Z',0.91)
on conflict (route_id, cell_key) do nothing;

-- ── Trail cell transitions ────────────────────────────────────────────────────

insert into public.trail_cell_transitions
  (route_id, from_cell_key, to_cell_key, transition_count, session_count, edge_cost)
values
  -- sorak-main
  ('sorak-main','8b30ec15db9bfff','8b30ec15db99fff',13,5,0.08),
  ('sorak-main','8b30ec15db99fff','8b30ec15daa4fff',14,5,0.07),
  ('sorak-main','8b30ec15daa4fff','8b30ec15db8bfff',13,5,0.08),
  ('sorak-main','8b30ec15db8bfff','8b30ec15da16fff',12,5,0.08),
  ('sorak-main','8b30ec15da16fff','8b30ec15da10fff',13,5,0.08),
  -- sorak-alternate
  ('sorak-alternate','8b30ec15db9bfff','8b30ec15db9afff',5,2,0.20),
  ('sorak-alternate','8b30ec15db9afff','8b30ec15d169fff',4,2,0.25),
  ('sorak-alternate','8b30ec15d169fff','8b30ec15d168fff',5,2,0.20),
  -- halla-main
  ('halla-main','8b30d15084acfff','8b30d1508413fff',3,1,0.33),
  ('halla-main','8b30d1508413fff','8b30d1508411fff',3,1,0.33),
  ('halla-main','8b30d1508411fff','8b30d150841cfff',2,1,0.50),
  ('halla-main','8b30d150841cfff','8b30d1508403fff',3,1,0.33),
  -- dobong-main
  ('dobong-main','8b30e1d0aa8cfff','8b30e1d0aaabfff',10,4,0.10),
  ('dobong-main','8b30e1d0aaabfff','8b30e1d0aaf6fff',11,4,0.09),
  ('dobong-main','8b30e1d0aaf6fff','8b30e1d0aaf0fff',10,4,0.10),
  ('dobong-main','8b30e1d0aaf0fff','8b30e1d0aaf5fff', 9,4,0.11),
  ('dobong-main','8b30e1d0aaf5fff','8b30e1d0aae2fff',10,4,0.10)
on conflict (route_id, from_cell_key, to_cell_key) do nothing;

-- ── Hiking sessions ───────────────────────────────────────────────────────────
-- Shared fake user (no FK to auth.users in this schema)
-- sorak-main    : 5 sessions, ingested → will have session_route_assignments
-- sorak-alt     : 2 sessions, ingested → will have session_route_assignments
-- halla-main    : 1 session,  ingested → will have session_route_assignments
-- dobong-main   : 4 sessions, ingested → will have session_route_assignments
-- jiri-north    : 3 sessions, ingested → NO session_route_assignments (UNPROCESSED)
-- sorak queued  : 1 session,  uploaded → not yet ingested (queued in pipeline)
-- jiri accepted : 1 session,  accepted → not yet ingested

insert into public.hiking_sessions
  (id, user_id, mountain_id, client_session_key, started_at, ended_at, status,
   upload_consent_version, accepted_point_count, rejected_point_count)
values
  -- sorak-main sessions (processed)
  ('00000000-0000-0000-0001-000000000001','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s1','2026-04-01T09:00:00Z','2026-04-01T11:30:00Z','ingested','v1.0',18,2),
  ('00000000-0000-0000-0001-000000000002','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s2','2026-04-03T08:30:00Z','2026-04-03T11:00:00Z','ingested','v1.0',16,1),
  ('00000000-0000-0000-0001-000000000003','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s3','2026-04-05T09:15:00Z','2026-04-05T11:45:00Z','ingested','v1.0',19,3),
  ('00000000-0000-0000-0001-000000000004','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s4','2026-04-07T09:00:00Z','2026-04-07T11:20:00Z','ingested','v1.0',17,1),
  ('00000000-0000-0000-0001-000000000005','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s5','2026-04-10T08:45:00Z','2026-04-10T11:15:00Z','ingested','v1.0',18,2),
  -- sorak-alternate sessions (processed)
  ('00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','sorak','sorak-a-s1','2026-03-10T10:00:00Z','2026-03-10T12:00:00Z','ingested','v1.0', 8,3),
  ('00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','sorak','sorak-a-s2','2026-03-15T10:00:00Z','2026-03-15T12:30:00Z','ingested','v1.0', 7,2),
  -- halla-main session (processed)
  ('00000000-0000-0000-0003-000000000001','00000000-0000-0000-0000-000000000001','halla','halla-m-s1','2026-02-20T07:30:00Z','2026-02-20T10:00:00Z','ingested','v1.0',12,4),
  -- dobong-main sessions (processed)
  ('00000000-0000-0000-0004-000000000001','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s1','2026-03-25T07:00:00Z','2026-03-25T09:00:00Z','ingested','v1.0',14,1),
  ('00000000-0000-0000-0004-000000000002','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s2','2026-03-28T07:30:00Z','2026-03-28T09:30:00Z','ingested','v1.0',13,2),
  ('00000000-0000-0000-0004-000000000003','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s3','2026-04-01T07:00:00Z','2026-04-01T09:00:00Z','ingested','v1.0',14,1),
  ('00000000-0000-0000-0004-000000000004','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s4','2026-04-05T07:00:00Z','2026-04-05T09:15:00Z','ingested','v1.0',12,2),
  -- jiri-north sessions (UNPROCESSED — no session_route_assignments)
  ('00000000-0000-0000-0005-000000000001','00000000-0000-0000-0000-000000000001','jiri','jiri-n-s1','2026-04-12T08:00:00Z','2026-04-12T11:00:00Z','ingested','v1.0', 6,0),
  ('00000000-0000-0000-0005-000000000002','00000000-0000-0000-0000-000000000001','jiri','jiri-n-s2','2026-04-14T08:30:00Z','2026-04-14T11:30:00Z','ingested','v1.0', 6,1),
  ('00000000-0000-0000-0005-000000000003','00000000-0000-0000-0000-000000000001','jiri','jiri-n-s3','2026-04-16T09:00:00Z','2026-04-16T12:00:00Z','ingested','v1.0', 6,0),
  -- pipeline backlog (not yet ingested)
  ('00000000-0000-0000-0006-000000000001','00000000-0000-0000-0000-000000000001','sorak','sorak-q-s1','2026-04-18T09:00:00Z', null,                  'uploaded','v1.0', 0,0),
  ('00000000-0000-0000-0006-000000000002','00000000-0000-0000-0000-000000000001','jiri', 'jiri-q-s1', '2026-04-18T10:00:00Z', null,                  'accepted','v1.0', 0,0)
on conflict (user_id, client_session_key) do nothing;

-- ── session_route_assignments (processed sessions) ────────────────────────────

insert into public.session_route_assignments
  (session_id, route_id, contributed_cell_count, contributed_transition_count)
values
  -- sorak-main
  ('00000000-0000-0000-0001-000000000001','sorak-main',6,5),
  ('00000000-0000-0000-0001-000000000002','sorak-main',6,5),
  ('00000000-0000-0000-0001-000000000003','sorak-main',6,5),
  ('00000000-0000-0000-0001-000000000004','sorak-main',6,5),
  ('00000000-0000-0000-0001-000000000005','sorak-main',6,5),
  -- sorak-alternate
  ('00000000-0000-0000-0002-000000000001','sorak-alternate',4,3),
  ('00000000-0000-0000-0002-000000000002','sorak-alternate',4,3),
  -- halla-main
  ('00000000-0000-0000-0003-000000000001','halla-main',5,4),
  -- dobong-main
  ('00000000-0000-0000-0004-000000000001','dobong-main',6,5),
  ('00000000-0000-0000-0004-000000000002','dobong-main',6,5),
  ('00000000-0000-0000-0004-000000000003','dobong-main',6,5),
  ('00000000-0000-0000-0004-000000000004','dobong-main',6,5)
on conflict (session_id, route_id) do nothing;

-- ── Track points for jiri-north unprocessed sessions ──────────────────────────
-- 6 points per session along the jiri-north path (35.34°N, 127.73°E → NE).
-- H3 cells (res 11) will map to: 8b30c015e58afff → 8b30c015e435fff
-- All points are inside jiri's bbox (127.60,35.25,127.85,35.50).
-- Session 2 and 3 use a 0.000008° jitter (< 1 m) so they land in the same cells.

insert into public.track_points
  (session_id, mountain_id, recorded_at, geom, accuracy, altitude, sequence_index)
values
  -- jiri-north session 1
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:05:00Z',st_geogfromtext('POINT(127.73000 35.34000)'),10.5,480,0),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:12:00Z',st_geogfromtext('POINT(127.73025 35.34025)'),11.0,495,1),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:19:00Z',st_geogfromtext('POINT(127.73050 35.34050)'), 9.8,510,2),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:26:00Z',st_geogfromtext('POINT(127.73075 35.34075)'),10.2,525,3),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:33:00Z',st_geogfromtext('POINT(127.73100 35.34100)'),10.8,540,4),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:40:00Z',st_geogfromtext('POINT(127.73125 35.34125)'),11.5,555,5),
  -- jiri-north session 2 (slight jitter)
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:35:00Z',st_geogfromtext('POINT(127.730008 35.340008)'),12.0,481,0),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:42:00Z',st_geogfromtext('POINT(127.730258 35.340258)'),11.5,496,1),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:49:00Z',st_geogfromtext('POINT(127.730508 35.340508)'),12.2,511,2),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:56:00Z',st_geogfromtext('POINT(127.730758 35.340758)'),11.8,526,3),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T09:03:00Z',st_geogfromtext('POINT(127.731008 35.341008)'),12.5,541,4),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T09:10:00Z',st_geogfromtext('POINT(127.731258 35.341258)'),10.9,556,5),
  -- jiri-north session 3 (opposite jitter direction)
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:05:00Z',st_geogfromtext('POINT(127.729992 35.339992)'), 9.5,479,0),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:12:00Z',st_geogfromtext('POINT(127.730242 35.340242)'),10.0,494,1),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:19:00Z',st_geogfromtext('POINT(127.730492 35.340492)'), 9.2,509,2),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:26:00Z',st_geogfromtext('POINT(127.730742 35.340742)'),10.5,524,3),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:33:00Z',st_geogfromtext('POINT(127.730992 35.340992)'), 9.8,539,4),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:40:00Z',st_geogfromtext('POINT(127.731242 35.341242)'),10.2,554,5);

-- ── MVP events ────────────────────────────────────────────────────────────────
-- Simulate some snap_requested and trail_served activity.

insert into public.mvp_events (mountain_id, event_name, event_payload) values
  ('sorak',  'trail_served',    '{"routeId":"sorak-main","routeState":"recommended","version":1,"confidence":0.82}'),
  ('sorak',  'trail_served',    '{"routeId":"sorak-main","routeState":"recommended","version":1,"confidence":0.82}'),
  ('sorak',  'trail_served',    '{"routeId":"sorak-alternate","routeState":"reference","version":1,"confidence":0.54}'),
  ('halla',  'trail_served',    '{"routeId":"halla-main","routeState":"reference","version":1,"confidence":0.42}'),
  ('dobong', 'trail_served',    '{"routeId":"dobong-main","routeState":"recommended","version":1,"confidence":0.76}'),
  ('dobong', 'trail_served',    '{"routeId":"dobong-main","routeState":"recommended","version":1,"confidence":0.76}'),
  ('sorak',  'snap_requested',  '{"routeId":"sorak-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('sorak',  'snap_requested',  '{"routeId":"sorak-main","routeJudgment":"caution","distanceBucket":"26-50m","trailVersion":1}'),
  ('sorak',  'snap_requested',  '{"routeId":"sorak-alternate","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('halla',  'snap_requested',  '{"routeId":"halla-main","routeJudgment":"away_from_route","distanceBucket":">50m","trailVersion":1}'),
  ('dobong', 'snap_requested',  '{"routeId":"dobong-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('dobong', 'snap_requested',  '{"routeId":"dobong-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}');
