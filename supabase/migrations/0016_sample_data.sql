-- =============================================================================
-- 0016_sample_data.sql
-- Development / QA sample data.  DO NOT apply to production.
--
-- Scenario matrix:
--   sorak   — 4 routes: main=recommended (5s), alternate=reference (2s),
--             osaek=reference (2s), hangyeryeong=reference (1s)
--   halla   — 3 routes: main=reference (1s), eorimok=reference (2s),
--             yeongsil=reference (1s)
--   dobong  — 3 routes: main=recommended (4s), west=reference (2s),
--             obong=none (no canonical trail)
--   jiri    — 3 routes: north/south/ridge all none,
--             north has 3 UNPROCESSED ingested sessions
--   bukhan  — 0 routes, 3 UNPROCESSED sessions → candidate_cells
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
-- 13 routes total: 4 sorak · 3 halla · 3 dobong · 3 jiri · 0 bukhan

insert into public.routes (id, mountain_id, display_name) values
  ('sorak-main',         'sorak',  '주능선 코스'),
  ('sorak-alternate',    'sorak',  '울산바위 우회'),
  ('sorak-osaek',        'sorak',  '오색 코스'),
  ('sorak-hangyeryeong', 'sorak',  '한계령 코스'),
  ('halla-main',         'halla',  '성판악 코스'),
  ('halla-eorimok',      'halla',  '어리목 코스'),
  ('halla-yeongsil',     'halla',  '영실 코스'),
  ('dobong-main',        'dobong', '도봉산 주등산로'),
  ('dobong-west',        'dobong', '서쪽 능선 코스'),
  ('dobong-obong',       'dobong', '오봉 능선'),
  ('jiri-north',         'jiri',   '노고단 북쪽'),
  ('jiri-south',         'jiri',   '천왕봉 남쪽'),
  ('jiri-ridge',         'jiri',   '지리산 주능선')
on conflict (id) do nothing;

-- ── Canonical trails ──────────────────────────────────────────────────────────
-- Polylines fan out from each summit like a spider web.
-- Summit anchors: 설악산 ≈ 128.462,38.150  한라산 ≈ 126.529,33.362
--                 도봉산 ≈ 127.020,37.692
-- dobong-obong / jiri-north / jiri-south / jiri-ridge: no row (confidence = none)

insert into public.canonical_trails
  (route_id, version, geom,
   confidence, confidence_level, session_count,
   branch_ambiguity_score, gps_quality_score)
values

  -- ── 설악산 — 4 routes radiating from Daecheongbong ─────────────────────────

  -- south approach (11 pts)
  ('sorak-main', 1,
   st_geogfromtext('LINESTRING('
     '128.44500 38.09700,128.44720 38.10350,128.44960 38.11000,'
     '128.45230 38.11600,128.45540 38.12100,128.45780 38.12700,'
     '128.45920 38.13350,128.46010 38.13950,128.46100 38.14500,'
     '128.46180 38.14900,128.46220 38.15000)'),
   0.82,'recommended',5,0.04,0.88),

  -- west loop around Ulsanbawi, rejoins summit (15 pts)
  ('sorak-alternate', 1,
   st_geogfromtext('LINESTRING('
     '128.44500 38.09700,128.44200 38.10100,128.43780 38.10700,'
     '128.43380 38.11200,128.43020 38.11700,128.42770 38.12200,'
     '128.42620 38.12700,128.42600 38.13200,128.42740 38.13700,'
     '128.43100 38.14100,128.43620 38.14450,128.44200 38.14720,'
     '128.44900 38.14900,128.45600 38.14980,128.46220 38.15000)'),
   0.54,'reference',2,0.18,0.75),

  -- east approach from Osaek (11 pts)
  ('sorak-osaek', 1,
   st_geogfromtext('LINESTRING('
     '128.54000 38.10800,128.53100 38.11400,128.52200 38.12000,'
     '128.51300 38.12550,128.50350 38.13050,128.49500 38.13550,'
     '128.48700 38.14000,128.47920 38.14420,128.47200 38.14750,'
     '128.46600 38.14940,128.46220 38.15000)'),
   0.51,'reference',2,0.21,0.73),

  -- NW approach from Hangyeryeong pass (10 pts)
  ('sorak-hangyeryeong', 1,
   st_geogfromtext('LINESTRING('
     '128.40200 38.16800,128.40900 38.16500,128.41600 38.16200,'
     '128.42300 38.15900,128.43000 38.15700,128.43700 38.15500,'
     '128.44300 38.15300,128.44900 38.15150,128.45500 38.15050,'
     '128.46220 38.15000)'),
   0.46,'reference',1,0.24,0.71),

  -- ── 한라산 — 3 routes converging at Baengnokdam crater ─────────────────────

  -- Seongpanak east approach (12 pts)
  ('halla-main', 1,
   st_geogfromtext('LINESTRING('
     '126.60700 33.31600,126.59800 33.32100,126.58900 33.32600,'
     '126.58000 33.33100,126.57100 33.33580,126.56200 33.34020,'
     '126.55380 33.34430,126.54620 33.34820,126.53940 33.35180,'
     '126.53420 33.35560,126.53020 33.35900,126.52900 33.36200)'),
   0.42,'reference',1,0.22,0.70),

  -- Eorimok west approach (11 pts)
  ('halla-eorimok', 1,
   st_geogfromtext('LINESTRING('
     '126.46300 33.38000,126.47000 33.37600,126.47700 33.37200,'
     '126.48450 33.36800,126.49200 33.36520,126.49980 33.36350,'
     '126.50780 33.36250,126.51580 33.36200,126.52280 33.36200,'
     '126.52800 33.36200,126.52900 33.36200)'),
   0.48,'reference',2,0.20,0.72),

  -- Yeongsil SW approach (10 pts)
  ('halla-yeongsil', 1,
   st_geogfromtext('LINESTRING('
     '126.49200 33.33000,126.49800 33.33600,126.50450 33.34150,'
     '126.51020 33.34680,126.51560 33.35140,126.52000 33.35560,'
     '126.52350 33.35880,126.52580 33.36060,126.52760 33.36160,'
     '126.52900 33.36200)'),
   0.44,'reference',1,0.23,0.71),

  -- ── 도봉산 — 2 routes with trails; dobong-obong = none ──────────────────────

  -- south trailhead to Jaunbong summit (9 pts)
  ('dobong-main', 1,
   st_geogfromtext('LINESTRING('
     '127.01700 37.65600,127.01780 37.66100,127.01830 37.66600,'
     '127.01890 37.67100,127.01940 37.67600,127.01970 37.68100,'
     '127.01990 37.68550,127.02010 37.69000,127.02000 37.69200)'),
   0.76,'recommended',4,0.06,0.85),

  -- west ridge converging at summit (9 pts)
  ('dobong-west', 1,
   st_geogfromtext('LINESTRING('
     '127.00200 37.68200,127.00500 37.68400,127.00820 37.68520,'
     '127.01100 37.68620,127.01400 37.68720,127.01600 37.68850,'
     '127.01780 37.69000,127.01900 37.69120,127.02000 37.69200)'),
   0.52,'reference',2,0.16,0.78)

on conflict (route_id, version) do update set
  geom                   = excluded.geom,
  confidence             = excluded.confidence,
  confidence_level       = excluded.confidence_level,
  session_count          = excluded.session_count,
  branch_ambiguity_score = excluded.branch_ambiguity_score,
  gps_quality_score      = excluded.gps_quality_score;

-- ── Trail cells ───────────────────────────────────────────────────────────────
-- One cell per polyline waypoint; cell_key format: 15-char hex (H3 res-11 style).
-- Clear stale cells for routes whose polylines changed.

delete from public.trail_cell_transitions
  where route_id in ('sorak-main','sorak-alternate','halla-main','dobong-main');
delete from public.trail_cells
  where route_id in ('sorak-main','sorak-alternate','halla-main','dobong-main');

-- sorak-main (11 cells, south → summit, 650 → 1540 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('sorak-main','8b30ec1510a1fff',st_geogfromtext('POINT(128.44500 38.09700)'),15,5, 8.2, 650,'2026-04-10T09:00:00Z',0.92),
  ('sorak-main','8b30ec1510a2fff',st_geogfromtext('POINT(128.44720 38.10350)'),14,5, 7.8, 740,'2026-04-10T09:06:00Z',0.92),
  ('sorak-main','8b30ec1510a3fff',st_geogfromtext('POINT(128.44960 38.11000)'),16,5, 9.1, 830,'2026-04-10T09:12:00Z',0.91),
  ('sorak-main','8b30ec1510a4fff',st_geogfromtext('POINT(128.45230 38.11600)'),14,5, 8.5, 920,'2026-04-10T09:18:00Z',0.92),
  ('sorak-main','8b30ec1510a5fff',st_geogfromtext('POINT(128.45540 38.12100)'),15,5, 7.2,1010,'2026-04-10T09:24:00Z',0.93),
  ('sorak-main','8b30ec1510a6fff',st_geogfromtext('POINT(128.45780 38.12700)'),14,5, 8.0,1100,'2026-04-10T09:30:00Z',0.92),
  ('sorak-main','8b30ec1510a7fff',st_geogfromtext('POINT(128.45920 38.13350)'),15,5, 7.5,1190,'2026-04-10T09:36:00Z',0.93),
  ('sorak-main','8b30ec1510a8fff',st_geogfromtext('POINT(128.46010 38.13950)'),13,5, 8.9,1280,'2026-04-10T09:42:00Z',0.91),
  ('sorak-main','8b30ec1510a9fff',st_geogfromtext('POINT(128.46100 38.14500)'),14,5, 7.6,1370,'2026-04-10T09:48:00Z',0.92),
  ('sorak-main','8b30ec1510aafff',st_geogfromtext('POINT(128.46180 38.14900)'),15,5, 8.2,1460,'2026-04-10T09:54:00Z',0.93),
  ('sorak-main','8b30ec1510abfff',st_geogfromtext('POINT(128.46220 38.15000)'),14,5, 7.9,1540,'2026-04-10T10:00:00Z',0.91)
on conflict (route_id,cell_key) do nothing;

-- sorak-alternate (15 cells, west loop, 650 → 1550 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('sorak-alternate','8b30ec1511a1fff',st_geogfromtext('POINT(128.44500 38.09700)'), 6,2,12.0, 650,'2026-03-15T10:00:00Z',0.88),
  ('sorak-alternate','8b30ec1511a2fff',st_geogfromtext('POINT(128.44200 38.10100)'), 5,2,13.5, 720,'2026-03-15T10:06:00Z',0.87),
  ('sorak-alternate','8b30ec1511a3fff',st_geogfromtext('POINT(128.43780 38.10700)'), 6,2,11.8, 790,'2026-03-15T10:12:00Z',0.88),
  ('sorak-alternate','8b30ec1511a4fff',st_geogfromtext('POINT(128.43380 38.11200)'), 5,2,14.2, 860,'2026-03-15T10:18:00Z',0.86),
  ('sorak-alternate','8b30ec1511a5fff',st_geogfromtext('POINT(128.43020 38.11700)'), 6,2,12.5, 920,'2026-03-15T10:24:00Z',0.87),
  ('sorak-alternate','8b30ec1511a6fff',st_geogfromtext('POINT(128.42770 38.12200)'), 5,2,13.0, 970,'2026-03-15T10:30:00Z',0.86),
  ('sorak-alternate','8b30ec1511a7fff',st_geogfromtext('POINT(128.42620 38.12700)'), 6,2,12.2,1030,'2026-03-15T10:36:00Z',0.87),
  ('sorak-alternate','8b30ec1511a8fff',st_geogfromtext('POINT(128.42600 38.13200)'), 5,2,14.0,1090,'2026-03-15T10:42:00Z',0.86),
  ('sorak-alternate','8b30ec1511a9fff',st_geogfromtext('POINT(128.42740 38.13700)'), 5,2,13.8,1140,'2026-03-15T10:48:00Z',0.86),
  ('sorak-alternate','8b30ec1511aafff',st_geogfromtext('POINT(128.43100 38.14100)'), 6,2,12.6,1200,'2026-03-15T10:54:00Z',0.87),
  ('sorak-alternate','8b30ec1511abfff',st_geogfromtext('POINT(128.43620 38.14450)'), 5,2,13.4,1270,'2026-03-15T11:00:00Z',0.86),
  ('sorak-alternate','8b30ec1511acfff',st_geogfromtext('POINT(128.44200 38.14720)'), 6,2,12.0,1340,'2026-03-15T11:06:00Z',0.87),
  ('sorak-alternate','8b30ec1511adfff',st_geogfromtext('POINT(128.44900 38.14900)'), 5,2,13.2,1420,'2026-03-15T11:12:00Z',0.86),
  ('sorak-alternate','8b30ec1511aefff',st_geogfromtext('POINT(128.45600 38.14980)'), 5,2,13.6,1490,'2026-03-15T11:18:00Z',0.86),
  ('sorak-alternate','8b30ec1511affff',st_geogfromtext('POINT(128.46220 38.15000)'), 6,2,12.4,1550,'2026-03-15T11:24:00Z',0.87)
on conflict (route_id,cell_key) do nothing;

-- sorak-osaek (11 cells, east → summit, 720 → 1540 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('sorak-osaek','8b30ec1512a1fff',st_geogfromtext('POINT(128.54000 38.10800)'), 6,2,11.5, 720,'2026-03-20T08:00:00Z',0.87),
  ('sorak-osaek','8b30ec1512a2fff',st_geogfromtext('POINT(128.53100 38.11400)'), 6,2,12.0, 800,'2026-03-20T08:08:00Z',0.86),
  ('sorak-osaek','8b30ec1512a3fff',st_geogfromtext('POINT(128.52200 38.12000)'), 5,2,11.8, 880,'2026-03-20T08:16:00Z',0.87),
  ('sorak-osaek','8b30ec1512a4fff',st_geogfromtext('POINT(128.51300 38.12550)'), 6,2,12.5, 960,'2026-03-20T08:24:00Z',0.86),
  ('sorak-osaek','8b30ec1512a5fff',st_geogfromtext('POINT(128.50350 38.13050)'), 5,2,11.2,1040,'2026-03-20T08:32:00Z',0.87),
  ('sorak-osaek','8b30ec1512a6fff',st_geogfromtext('POINT(128.49500 38.13550)'), 6,2,13.0,1120,'2026-03-20T08:40:00Z',0.86),
  ('sorak-osaek','8b30ec1512a7fff',st_geogfromtext('POINT(128.48700 38.14000)'), 5,2,12.2,1200,'2026-03-20T08:48:00Z',0.86),
  ('sorak-osaek','8b30ec1512a8fff',st_geogfromtext('POINT(128.47920 38.14420)'), 6,2,11.0,1280,'2026-03-20T08:56:00Z',0.87),
  ('sorak-osaek','8b30ec1512a9fff',st_geogfromtext('POINT(128.47200 38.14750)'), 5,2,12.8,1360,'2026-03-20T09:04:00Z',0.86),
  ('sorak-osaek','8b30ec1512aafff',st_geogfromtext('POINT(128.46600 38.14940)'), 6,2,11.6,1450,'2026-03-20T09:12:00Z',0.87),
  ('sorak-osaek','8b30ec1512abfff',st_geogfromtext('POINT(128.46220 38.15000)'), 5,2,12.4,1540,'2026-03-20T09:20:00Z',0.86)
on conflict (route_id,cell_key) do nothing;

-- sorak-hangyeryeong (10 cells, NW pass → summit, 1020 → 1620 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('sorak-hangyeryeong','8b30ec1513a1fff',st_geogfromtext('POINT(128.40200 38.16800)'), 4,1,15.0,1020,'2026-03-01T09:00:00Z',0.85),
  ('sorak-hangyeryeong','8b30ec1513a2fff',st_geogfromtext('POINT(128.40900 38.16500)'), 4,1,14.5,1100,'2026-03-01T09:10:00Z',0.85),
  ('sorak-hangyeryeong','8b30ec1513a3fff',st_geogfromtext('POINT(128.41600 38.16200)'), 3,1,15.8,1180,'2026-03-01T09:20:00Z',0.84),
  ('sorak-hangyeryeong','8b30ec1513a4fff',st_geogfromtext('POINT(128.42300 38.15900)'), 4,1,14.2,1260,'2026-03-01T09:30:00Z',0.85),
  ('sorak-hangyeryeong','8b30ec1513a5fff',st_geogfromtext('POINT(128.43000 38.15700)'), 4,1,15.5,1330,'2026-03-01T09:40:00Z',0.84),
  ('sorak-hangyeryeong','8b30ec1513a6fff',st_geogfromtext('POINT(128.43700 38.15500)'), 3,1,16.0,1400,'2026-03-01T09:50:00Z',0.84),
  ('sorak-hangyeryeong','8b30ec1513a7fff',st_geogfromtext('POINT(128.44300 38.15300)'), 4,1,14.8,1460,'2026-03-01T10:00:00Z',0.85),
  ('sorak-hangyeryeong','8b30ec1513a8fff',st_geogfromtext('POINT(128.44900 38.15150)'), 3,1,15.2,1510,'2026-03-01T10:10:00Z',0.84),
  ('sorak-hangyeryeong','8b30ec1513a9fff',st_geogfromtext('POINT(128.45500 38.15050)'), 4,1,14.6,1560,'2026-03-01T10:20:00Z',0.85),
  ('sorak-hangyeryeong','8b30ec1513aafff',st_geogfromtext('POINT(128.46220 38.15000)'), 3,1,15.4,1620,'2026-03-01T10:30:00Z',0.84)
on conflict (route_id,cell_key) do nothing;

-- halla-main (12 cells, east → summit, 520 → 1850 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('halla-main','8b30d15010a1fff',st_geogfromtext('POINT(126.60700 33.31600)'), 4,1,15.0, 520,'2026-02-20T08:00:00Z',0.85),
  ('halla-main','8b30d15010a2fff',st_geogfromtext('POINT(126.59800 33.32100)'), 4,1,16.2, 640,'2026-02-20T08:10:00Z',0.84),
  ('halla-main','8b30d15010a3fff',st_geogfromtext('POINT(126.58900 33.32600)'), 3,1,14.8, 760,'2026-02-20T08:20:00Z',0.85),
  ('halla-main','8b30d15010a4fff',st_geogfromtext('POINT(126.58000 33.33100)'), 4,1,15.5, 880,'2026-02-20T08:30:00Z',0.85),
  ('halla-main','8b30d15010a5fff',st_geogfromtext('POINT(126.57100 33.33580)'), 3,1,17.0,1000,'2026-02-20T08:40:00Z',0.83),
  ('halla-main','8b30d15010a6fff',st_geogfromtext('POINT(126.56200 33.34020)'), 4,1,15.8,1120,'2026-02-20T08:50:00Z',0.84),
  ('halla-main','8b30d15010a7fff',st_geogfromtext('POINT(126.55380 33.34430)'), 3,1,16.5,1240,'2026-02-20T09:00:00Z',0.84),
  ('halla-main','8b30d15010a8fff',st_geogfromtext('POINT(126.54620 33.34820)'), 4,1,15.2,1360,'2026-02-20T09:10:00Z',0.85),
  ('halla-main','8b30d15010a9fff',st_geogfromtext('POINT(126.53940 33.35180)'), 3,1,17.2,1480,'2026-02-20T09:20:00Z',0.83),
  ('halla-main','8b30d15010aafff',st_geogfromtext('POINT(126.53420 33.35560)'), 4,1,15.6,1600,'2026-02-20T09:30:00Z',0.84),
  ('halla-main','8b30d15010abfff',st_geogfromtext('POINT(126.53020 33.35900)'), 3,1,16.8,1720,'2026-02-20T09:40:00Z',0.84),
  ('halla-main','8b30d15010acfff',st_geogfromtext('POINT(126.52900 33.36200)'), 3,1,17.0,1850,'2026-02-20T09:50:00Z',0.83)
on conflict (route_id,cell_key) do nothing;

-- halla-eorimok (11 cells, west → summit, 980 → 1850 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('halla-eorimok','8b30d15011a1fff',st_geogfromtext('POINT(126.46300 33.38000)'), 6,2,13.5, 980,'2026-03-05T08:00:00Z',0.87),
  ('halla-eorimok','8b30d15011a2fff',st_geogfromtext('POINT(126.47000 33.37600)'), 5,2,14.0,1060,'2026-03-05T08:10:00Z',0.86),
  ('halla-eorimok','8b30d15011a3fff',st_geogfromtext('POINT(126.47700 33.37200)'), 6,2,13.2,1140,'2026-03-05T08:20:00Z',0.87),
  ('halla-eorimok','8b30d15011a4fff',st_geogfromtext('POINT(126.48450 33.36800)'), 5,2,14.5,1220,'2026-03-05T08:30:00Z',0.86),
  ('halla-eorimok','8b30d15011a5fff',st_geogfromtext('POINT(126.49200 33.36520)'), 6,2,13.0,1300,'2026-03-05T08:40:00Z',0.87),
  ('halla-eorimok','8b30d15011a6fff',st_geogfromtext('POINT(126.49980 33.36350)'), 5,2,14.2,1370,'2026-03-05T08:50:00Z',0.86),
  ('halla-eorimok','8b30d15011a7fff',st_geogfromtext('POINT(126.50780 33.36250)'), 6,2,13.8,1440,'2026-03-05T09:00:00Z',0.87),
  ('halla-eorimok','8b30d15011a8fff',st_geogfromtext('POINT(126.51580 33.36200)'), 5,2,14.6,1510,'2026-03-05T09:10:00Z',0.86),
  ('halla-eorimok','8b30d15011a9fff',st_geogfromtext('POINT(126.52280 33.36200)'), 6,2,13.4,1580,'2026-03-05T09:20:00Z',0.87),
  ('halla-eorimok','8b30d15011aafff',st_geogfromtext('POINT(126.52800 33.36200)'), 5,2,14.8,1650,'2026-03-05T09:30:00Z',0.86),
  ('halla-eorimok','8b30d15011abfff',st_geogfromtext('POINT(126.52900 33.36200)'), 6,2,13.6,1850,'2026-03-05T09:40:00Z',0.87)
on conflict (route_id,cell_key) do nothing;

-- halla-yeongsil (10 cells, SW → summit, 1280 → 1890 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('halla-yeongsil','8b30d15012a1fff',st_geogfromtext('POINT(126.49200 33.33000)'), 4,1,14.5,1280,'2026-03-10T09:00:00Z',0.85),
  ('halla-yeongsil','8b30d15012a2fff',st_geogfromtext('POINT(126.49800 33.33600)'), 3,1,15.5,1360,'2026-03-10T09:10:00Z',0.84),
  ('halla-yeongsil','8b30d15012a3fff',st_geogfromtext('POINT(126.50450 33.34150)'), 4,1,14.0,1440,'2026-03-10T09:20:00Z',0.85),
  ('halla-yeongsil','8b30d15012a4fff',st_geogfromtext('POINT(126.51020 33.34680)'), 3,1,16.0,1520,'2026-03-10T09:30:00Z',0.84),
  ('halla-yeongsil','8b30d15012a5fff',st_geogfromtext('POINT(126.51560 33.35140)'), 4,1,14.8,1580,'2026-03-10T09:40:00Z',0.85),
  ('halla-yeongsil','8b30d15012a6fff',st_geogfromtext('POINT(126.52000 33.35560)'), 3,1,15.2,1640,'2026-03-10T09:50:00Z',0.84),
  ('halla-yeongsil','8b30d15012a7fff',st_geogfromtext('POINT(126.52350 33.35880)'), 4,1,14.5,1700,'2026-03-10T10:00:00Z',0.85),
  ('halla-yeongsil','8b30d15012a8fff',st_geogfromtext('POINT(126.52580 33.36060)'), 3,1,15.8,1760,'2026-03-10T10:10:00Z',0.84),
  ('halla-yeongsil','8b30d15012a9fff',st_geogfromtext('POINT(126.52760 33.36160)'), 4,1,14.2,1820,'2026-03-10T10:20:00Z',0.85),
  ('halla-yeongsil','8b30d15012aafff',st_geogfromtext('POINT(126.52900 33.36200)'), 3,1,15.5,1890,'2026-03-10T10:30:00Z',0.84)
on conflict (route_id,cell_key) do nothing;

-- dobong-main (9 cells, south → summit, 120 → 640 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('dobong-main','8b30e1d010a1fff',st_geogfromtext('POINT(127.01700 37.65600)'),12,4, 7.5,120,'2026-04-05T07:00:00Z',0.93),
  ('dobong-main','8b30e1d010a2fff',st_geogfromtext('POINT(127.01780 37.66100)'),11,4, 8.0,190,'2026-04-05T07:10:00Z',0.92),
  ('dobong-main','8b30e1d010a3fff',st_geogfromtext('POINT(127.01830 37.66600)'),12,4, 7.2,260,'2026-04-05T07:20:00Z',0.93),
  ('dobong-main','8b30e1d010a4fff',st_geogfromtext('POINT(127.01890 37.67100)'),11,4, 8.8,330,'2026-04-05T07:30:00Z',0.91),
  ('dobong-main','8b30e1d010a5fff',st_geogfromtext('POINT(127.01940 37.67600)'),12,4, 7.0,400,'2026-04-05T07:40:00Z',0.93),
  ('dobong-main','8b30e1d010a6fff',st_geogfromtext('POINT(127.01970 37.68100)'),11,4, 8.5,460,'2026-04-05T07:50:00Z',0.91),
  ('dobong-main','8b30e1d010a7fff',st_geogfromtext('POINT(127.01990 37.68550)'),12,4, 7.8,520,'2026-04-05T08:00:00Z',0.92),
  ('dobong-main','8b30e1d010a8fff',st_geogfromtext('POINT(127.02010 37.69000)'),10,4, 9.5,580,'2026-04-05T08:10:00Z',0.91),
  ('dobong-main','8b30e1d010a9fff',st_geogfromtext('POINT(127.02000 37.69200)'),11,4, 8.2,640,'2026-04-05T08:20:00Z',0.92)
on conflict (route_id,cell_key) do nothing;

-- dobong-west (9 cells, west ridge → summit, 270 → 640 m)
insert into public.trail_cells
  (route_id,cell_key,geom,point_count,session_count,avg_accuracy,avg_altitude,last_seen_at,quality_score)
values
  ('dobong-west','8b30e1d011a1fff',st_geogfromtext('POINT(127.00200 37.68200)'), 6,2, 9.5,270,'2026-04-08T07:00:00Z',0.90),
  ('dobong-west','8b30e1d011a2fff',st_geogfromtext('POINT(127.00500 37.68400)'), 5,2,10.0,330,'2026-04-08T07:10:00Z',0.89),
  ('dobong-west','8b30e1d011a3fff',st_geogfromtext('POINT(127.00820 37.68520)'), 6,2, 9.2,380,'2026-04-08T07:20:00Z',0.90),
  ('dobong-west','8b30e1d011a4fff',st_geogfromtext('POINT(127.01100 37.68620)'), 5,2,10.5,430,'2026-04-08T07:30:00Z',0.89),
  ('dobong-west','8b30e1d011a5fff',st_geogfromtext('POINT(127.01400 37.68720)'), 6,2, 9.8,470,'2026-04-08T07:40:00Z',0.90),
  ('dobong-west','8b30e1d011a6fff',st_geogfromtext('POINT(127.01600 37.68850)'), 5,2,10.2,510,'2026-04-08T07:50:00Z',0.89),
  ('dobong-west','8b30e1d011a7fff',st_geogfromtext('POINT(127.01780 37.69000)'), 6,2, 9.0,550,'2026-04-08T08:00:00Z',0.90),
  ('dobong-west','8b30e1d011a8fff',st_geogfromtext('POINT(127.01900 37.69120)'), 5,2,10.8,590,'2026-04-08T08:10:00Z',0.89),
  ('dobong-west','8b30e1d011a9fff',st_geogfromtext('POINT(127.02000 37.69200)'), 6,2, 9.5,640,'2026-04-08T08:20:00Z',0.90)
on conflict (route_id,cell_key) do nothing;

-- ── Trail cell transitions ────────────────────────────────────────────────────

insert into public.trail_cell_transitions
  (route_id,from_cell_key,to_cell_key,transition_count,session_count,edge_cost)
values
  -- sorak-main (10 transitions)
  ('sorak-main','8b30ec1510a1fff','8b30ec1510a2fff',13,5,0.08),
  ('sorak-main','8b30ec1510a2fff','8b30ec1510a3fff',14,5,0.07),
  ('sorak-main','8b30ec1510a3fff','8b30ec1510a4fff',13,5,0.08),
  ('sorak-main','8b30ec1510a4fff','8b30ec1510a5fff',12,5,0.08),
  ('sorak-main','8b30ec1510a5fff','8b30ec1510a6fff',13,5,0.08),
  ('sorak-main','8b30ec1510a6fff','8b30ec1510a7fff',14,5,0.07),
  ('sorak-main','8b30ec1510a7fff','8b30ec1510a8fff',12,5,0.08),
  ('sorak-main','8b30ec1510a8fff','8b30ec1510a9fff',13,5,0.08),
  ('sorak-main','8b30ec1510a9fff','8b30ec1510aafff',14,5,0.07),
  ('sorak-main','8b30ec1510aafff','8b30ec1510abfff',13,5,0.08),
  -- sorak-alternate (14 transitions)
  ('sorak-alternate','8b30ec1511a1fff','8b30ec1511a2fff', 5,2,0.20),
  ('sorak-alternate','8b30ec1511a2fff','8b30ec1511a3fff', 4,2,0.25),
  ('sorak-alternate','8b30ec1511a3fff','8b30ec1511a4fff', 5,2,0.20),
  ('sorak-alternate','8b30ec1511a4fff','8b30ec1511a5fff', 4,2,0.25),
  ('sorak-alternate','8b30ec1511a5fff','8b30ec1511a6fff', 5,2,0.20),
  ('sorak-alternate','8b30ec1511a6fff','8b30ec1511a7fff', 4,2,0.25),
  ('sorak-alternate','8b30ec1511a7fff','8b30ec1511a8fff', 5,2,0.20),
  ('sorak-alternate','8b30ec1511a8fff','8b30ec1511a9fff', 4,2,0.25),
  ('sorak-alternate','8b30ec1511a9fff','8b30ec1511aafff', 5,2,0.20),
  ('sorak-alternate','8b30ec1511aafff','8b30ec1511abfff', 4,2,0.25),
  ('sorak-alternate','8b30ec1511abfff','8b30ec1511acfff', 5,2,0.20),
  ('sorak-alternate','8b30ec1511acfff','8b30ec1511adfff', 4,2,0.25),
  ('sorak-alternate','8b30ec1511adfff','8b30ec1511aefff', 5,2,0.20),
  ('sorak-alternate','8b30ec1511aefff','8b30ec1511affff', 4,2,0.25),
  -- sorak-osaek (10 transitions)
  ('sorak-osaek','8b30ec1512a1fff','8b30ec1512a2fff', 5,2,0.22),
  ('sorak-osaek','8b30ec1512a2fff','8b30ec1512a3fff', 4,2,0.25),
  ('sorak-osaek','8b30ec1512a3fff','8b30ec1512a4fff', 5,2,0.22),
  ('sorak-osaek','8b30ec1512a4fff','8b30ec1512a5fff', 4,2,0.25),
  ('sorak-osaek','8b30ec1512a5fff','8b30ec1512a6fff', 5,2,0.22),
  ('sorak-osaek','8b30ec1512a6fff','8b30ec1512a7fff', 4,2,0.25),
  ('sorak-osaek','8b30ec1512a7fff','8b30ec1512a8fff', 5,2,0.22),
  ('sorak-osaek','8b30ec1512a8fff','8b30ec1512a9fff', 4,2,0.25),
  ('sorak-osaek','8b30ec1512a9fff','8b30ec1512aafff', 5,2,0.22),
  ('sorak-osaek','8b30ec1512aafff','8b30ec1512abfff', 4,2,0.25),
  -- sorak-hangyeryeong (9 transitions)
  ('sorak-hangyeryeong','8b30ec1513a1fff','8b30ec1513a2fff', 3,1,0.33),
  ('sorak-hangyeryeong','8b30ec1513a2fff','8b30ec1513a3fff', 3,1,0.33),
  ('sorak-hangyeryeong','8b30ec1513a3fff','8b30ec1513a4fff', 2,1,0.50),
  ('sorak-hangyeryeong','8b30ec1513a4fff','8b30ec1513a5fff', 3,1,0.33),
  ('sorak-hangyeryeong','8b30ec1513a5fff','8b30ec1513a6fff', 3,1,0.33),
  ('sorak-hangyeryeong','8b30ec1513a6fff','8b30ec1513a7fff', 2,1,0.50),
  ('sorak-hangyeryeong','8b30ec1513a7fff','8b30ec1513a8fff', 3,1,0.33),
  ('sorak-hangyeryeong','8b30ec1513a8fff','8b30ec1513a9fff', 3,1,0.33),
  ('sorak-hangyeryeong','8b30ec1513a9fff','8b30ec1513aafff', 2,1,0.50),
  -- halla-main (11 transitions)
  ('halla-main','8b30d15010a1fff','8b30d15010a2fff', 3,1,0.33),
  ('halla-main','8b30d15010a2fff','8b30d15010a3fff', 3,1,0.33),
  ('halla-main','8b30d15010a3fff','8b30d15010a4fff', 2,1,0.50),
  ('halla-main','8b30d15010a4fff','8b30d15010a5fff', 3,1,0.33),
  ('halla-main','8b30d15010a5fff','8b30d15010a6fff', 3,1,0.33),
  ('halla-main','8b30d15010a6fff','8b30d15010a7fff', 2,1,0.50),
  ('halla-main','8b30d15010a7fff','8b30d15010a8fff', 3,1,0.33),
  ('halla-main','8b30d15010a8fff','8b30d15010a9fff', 2,1,0.50),
  ('halla-main','8b30d15010a9fff','8b30d15010aafff', 3,1,0.33),
  ('halla-main','8b30d15010aafff','8b30d15010abfff', 3,1,0.33),
  ('halla-main','8b30d15010abfff','8b30d15010acfff', 2,1,0.50),
  -- halla-eorimok (10 transitions)
  ('halla-eorimok','8b30d15011a1fff','8b30d15011a2fff', 5,2,0.22),
  ('halla-eorimok','8b30d15011a2fff','8b30d15011a3fff', 4,2,0.25),
  ('halla-eorimok','8b30d15011a3fff','8b30d15011a4fff', 5,2,0.22),
  ('halla-eorimok','8b30d15011a4fff','8b30d15011a5fff', 4,2,0.25),
  ('halla-eorimok','8b30d15011a5fff','8b30d15011a6fff', 5,2,0.22),
  ('halla-eorimok','8b30d15011a6fff','8b30d15011a7fff', 4,2,0.25),
  ('halla-eorimok','8b30d15011a7fff','8b30d15011a8fff', 5,2,0.22),
  ('halla-eorimok','8b30d15011a8fff','8b30d15011a9fff', 4,2,0.25),
  ('halla-eorimok','8b30d15011a9fff','8b30d15011aafff', 5,2,0.22),
  ('halla-eorimok','8b30d15011aafff','8b30d15011abfff', 4,2,0.25),
  -- halla-yeongsil (9 transitions)
  ('halla-yeongsil','8b30d15012a1fff','8b30d15012a2fff', 3,1,0.33),
  ('halla-yeongsil','8b30d15012a2fff','8b30d15012a3fff', 3,1,0.33),
  ('halla-yeongsil','8b30d15012a3fff','8b30d15012a4fff', 2,1,0.50),
  ('halla-yeongsil','8b30d15012a4fff','8b30d15012a5fff', 3,1,0.33),
  ('halla-yeongsil','8b30d15012a5fff','8b30d15012a6fff', 3,1,0.33),
  ('halla-yeongsil','8b30d15012a6fff','8b30d15012a7fff', 2,1,0.50),
  ('halla-yeongsil','8b30d15012a7fff','8b30d15012a8fff', 3,1,0.33),
  ('halla-yeongsil','8b30d15012a8fff','8b30d15012a9fff', 3,1,0.33),
  ('halla-yeongsil','8b30d15012a9fff','8b30d15012aafff', 2,1,0.50),
  -- dobong-main (8 transitions)
  ('dobong-main','8b30e1d010a1fff','8b30e1d010a2fff',10,4,0.10),
  ('dobong-main','8b30e1d010a2fff','8b30e1d010a3fff',11,4,0.09),
  ('dobong-main','8b30e1d010a3fff','8b30e1d010a4fff',10,4,0.10),
  ('dobong-main','8b30e1d010a4fff','8b30e1d010a5fff', 9,4,0.11),
  ('dobong-main','8b30e1d010a5fff','8b30e1d010a6fff',10,4,0.10),
  ('dobong-main','8b30e1d010a6fff','8b30e1d010a7fff',11,4,0.09),
  ('dobong-main','8b30e1d010a7fff','8b30e1d010a8fff', 9,4,0.11),
  ('dobong-main','8b30e1d010a8fff','8b30e1d010a9fff',10,4,0.10),
  -- dobong-west (8 transitions)
  ('dobong-west','8b30e1d011a1fff','8b30e1d011a2fff', 5,2,0.20),
  ('dobong-west','8b30e1d011a2fff','8b30e1d011a3fff', 4,2,0.25),
  ('dobong-west','8b30e1d011a3fff','8b30e1d011a4fff', 5,2,0.20),
  ('dobong-west','8b30e1d011a4fff','8b30e1d011a5fff', 4,2,0.25),
  ('dobong-west','8b30e1d011a5fff','8b30e1d011a6fff', 5,2,0.20),
  ('dobong-west','8b30e1d011a6fff','8b30e1d011a7fff', 4,2,0.25),
  ('dobong-west','8b30e1d011a7fff','8b30e1d011a8fff', 5,2,0.20),
  ('dobong-west','8b30e1d011a8fff','8b30e1d011a9fff', 4,2,0.25)
on conflict (route_id,from_cell_key,to_cell_key) do nothing;

-- ── Hiking sessions ───────────────────────────────────────────────────────────

insert into public.hiking_sessions
  (id,user_id,mountain_id,client_session_key,started_at,ended_at,status,
   upload_consent_version,accepted_point_count,rejected_point_count)
values
  -- sorak-main (5 sessions)
  ('00000000-0000-0000-0001-000000000001','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s1','2026-04-01T09:00:00Z','2026-04-01T11:30:00Z','ingested','v1.0',18,2),
  ('00000000-0000-0000-0001-000000000002','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s2','2026-04-03T08:30:00Z','2026-04-03T11:00:00Z','ingested','v1.0',16,1),
  ('00000000-0000-0000-0001-000000000003','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s3','2026-04-05T09:15:00Z','2026-04-05T11:45:00Z','ingested','v1.0',19,3),
  ('00000000-0000-0000-0001-000000000004','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s4','2026-04-07T09:00:00Z','2026-04-07T11:20:00Z','ingested','v1.0',17,1),
  ('00000000-0000-0000-0001-000000000005','00000000-0000-0000-0000-000000000001','sorak','sorak-m-s5','2026-04-10T08:45:00Z','2026-04-10T11:15:00Z','ingested','v1.0',18,2),
  -- sorak-alternate (2 sessions)
  ('00000000-0000-0000-0002-000000000001','00000000-0000-0000-0000-000000000001','sorak','sorak-a-s1','2026-03-10T10:00:00Z','2026-03-10T12:00:00Z','ingested','v1.0', 8,3),
  ('00000000-0000-0000-0002-000000000002','00000000-0000-0000-0000-000000000001','sorak','sorak-a-s2','2026-03-15T10:00:00Z','2026-03-15T12:30:00Z','ingested','v1.0', 7,2),
  -- halla-main (1 session)
  ('00000000-0000-0000-0003-000000000001','00000000-0000-0000-0000-000000000001','halla','halla-m-s1','2026-02-20T07:30:00Z','2026-02-20T10:00:00Z','ingested','v1.0',12,4),
  -- dobong-main (4 sessions)
  ('00000000-0000-0000-0004-000000000001','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s1','2026-03-25T07:00:00Z','2026-03-25T09:00:00Z','ingested','v1.0',14,1),
  ('00000000-0000-0000-0004-000000000002','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s2','2026-03-28T07:30:00Z','2026-03-28T09:30:00Z','ingested','v1.0',13,2),
  ('00000000-0000-0000-0004-000000000003','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s3','2026-04-01T07:00:00Z','2026-04-01T09:00:00Z','ingested','v1.0',14,1),
  ('00000000-0000-0000-0004-000000000004','00000000-0000-0000-0000-000000000001','dobong','dobong-m-s4','2026-04-05T07:00:00Z','2026-04-05T09:15:00Z','ingested','v1.0',12,2),
  -- jiri-north (3 UNPROCESSED sessions — no session_route_assignments)
  ('00000000-0000-0000-0005-000000000001','00000000-0000-0000-0000-000000000001','jiri','jiri-n-s1','2026-04-12T08:00:00Z','2026-04-12T11:00:00Z','ingested','v1.0', 6,0),
  ('00000000-0000-0000-0005-000000000002','00000000-0000-0000-0000-000000000001','jiri','jiri-n-s2','2026-04-14T08:30:00Z','2026-04-14T11:30:00Z','ingested','v1.0', 6,1),
  ('00000000-0000-0000-0005-000000000003','00000000-0000-0000-0000-000000000001','jiri','jiri-n-s3','2026-04-16T09:00:00Z','2026-04-16T12:00:00Z','ingested','v1.0', 6,0),
  -- bukhan (3 UNPROCESSED — no routes → candidate_cells)
  ('00000000-0000-0000-0007-000000000001','00000000-0000-0000-0000-000000000001','bukhan','bukhan-s1','2026-04-20T08:00:00Z','2026-04-20T10:30:00Z','ingested','v1.0', 6,0),
  ('00000000-0000-0000-0007-000000000002','00000000-0000-0000-0000-000000000001','bukhan','bukhan-s2','2026-04-22T08:30:00Z','2026-04-22T11:00:00Z','ingested','v1.0', 6,1),
  ('00000000-0000-0000-0007-000000000003','00000000-0000-0000-0000-000000000001','bukhan','bukhan-s3','2026-04-24T09:00:00Z','2026-04-24T11:30:00Z','ingested','v1.0', 6,0),
  -- pipeline backlog
  ('00000000-0000-0000-0006-000000000001','00000000-0000-0000-0000-000000000001','sorak','sorak-q-s1','2026-04-18T09:00:00Z',null,'uploaded','v1.0',0,0),
  ('00000000-0000-0000-0006-000000000002','00000000-0000-0000-0000-000000000001','jiri', 'jiri-q-s1', '2026-04-18T10:00:00Z',null,'accepted','v1.0',0,0)
on conflict (user_id,client_session_key) do nothing;

-- ── session_route_assignments ─────────────────────────────────────────────────

insert into public.session_route_assignments
  (session_id,route_id,contributed_cell_count,contributed_transition_count)
values
  ('00000000-0000-0000-0001-000000000001','sorak-main',11,10),
  ('00000000-0000-0000-0001-000000000002','sorak-main',11,10),
  ('00000000-0000-0000-0001-000000000003','sorak-main',11,10),
  ('00000000-0000-0000-0001-000000000004','sorak-main',11,10),
  ('00000000-0000-0000-0001-000000000005','sorak-main',11,10),
  ('00000000-0000-0000-0002-000000000001','sorak-alternate',15,14),
  ('00000000-0000-0000-0002-000000000002','sorak-alternate',15,14),
  ('00000000-0000-0000-0003-000000000001','halla-main',12,11),
  ('00000000-0000-0000-0004-000000000001','dobong-main',9,8),
  ('00000000-0000-0000-0004-000000000002','dobong-main',9,8),
  ('00000000-0000-0000-0004-000000000003','dobong-main',9,8),
  ('00000000-0000-0000-0004-000000000004','dobong-main',9,8)
on conflict (session_id,route_id) do nothing;

-- ── Track points for jiri-north unprocessed sessions ──────────────────────────
-- 6 pts/session along 35.34°N 127.73°E → NE (inside jiri bbox).
-- Session 2/3 use < 1 m jitter to land in the same H3 cells.

insert into public.track_points
  (session_id,mountain_id,recorded_at,geom,accuracy,altitude,sequence_index)
values
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:05:00Z',st_geogfromtext('POINT(127.73000 35.34000)'),10.5,480,0),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:12:00Z',st_geogfromtext('POINT(127.73025 35.34025)'),11.0,495,1),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:19:00Z',st_geogfromtext('POINT(127.73050 35.34050)'), 9.8,510,2),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:26:00Z',st_geogfromtext('POINT(127.73075 35.34075)'),10.2,525,3),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:33:00Z',st_geogfromtext('POINT(127.73100 35.34100)'),10.8,540,4),
  ('00000000-0000-0000-0005-000000000001','jiri','2026-04-12T08:40:00Z',st_geogfromtext('POINT(127.73125 35.34125)'),11.5,555,5),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:35:00Z',st_geogfromtext('POINT(127.730008 35.340008)'),12.0,481,0),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:42:00Z',st_geogfromtext('POINT(127.730258 35.340258)'),11.5,496,1),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:49:00Z',st_geogfromtext('POINT(127.730508 35.340508)'),12.2,511,2),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T08:56:00Z',st_geogfromtext('POINT(127.730758 35.340758)'),11.8,526,3),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T09:03:00Z',st_geogfromtext('POINT(127.731008 35.341008)'),12.5,541,4),
  ('00000000-0000-0000-0005-000000000002','jiri','2026-04-14T09:10:00Z',st_geogfromtext('POINT(127.731258 35.341258)'),10.9,556,5),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:05:00Z',st_geogfromtext('POINT(127.729992 35.339992)'), 9.5,479,0),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:12:00Z',st_geogfromtext('POINT(127.730242 35.340242)'),10.0,494,1),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:19:00Z',st_geogfromtext('POINT(127.730492 35.340492)'), 9.2,509,2),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:26:00Z',st_geogfromtext('POINT(127.730742 35.340742)'),10.5,524,3),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:33:00Z',st_geogfromtext('POINT(127.730992 35.340992)'), 9.8,539,4),
  ('00000000-0000-0000-0005-000000000003','jiri','2026-04-16T09:40:00Z',st_geogfromtext('POINT(127.731242 35.341242)'),10.2,554,5);

-- ── Track points for bukhan unprocessed sessions ──────────────────────────────
-- 6 pts/session along 37.68°N 127.00°E → NE (inside bukhan bbox).
-- No routes → cells become candidate_cells after match-and-aggregate.

insert into public.track_points
  (session_id,mountain_id,recorded_at,geom,accuracy,altitude,sequence_index)
values
  ('00000000-0000-0000-0007-000000000001','bukhan','2026-04-20T08:05:00Z',st_geogfromtext('POINT(127.0000 37.6800)'), 9.5,250,0),
  ('00000000-0000-0000-0007-000000000001','bukhan','2026-04-20T08:12:00Z',st_geogfromtext('POINT(127.0003 37.6803)'),10.0,265,1),
  ('00000000-0000-0000-0007-000000000001','bukhan','2026-04-20T08:19:00Z',st_geogfromtext('POINT(127.0006 37.6806)'),10.5,280,2),
  ('00000000-0000-0000-0007-000000000001','bukhan','2026-04-20T08:26:00Z',st_geogfromtext('POINT(127.0009 37.6809)'), 9.8,295,3),
  ('00000000-0000-0000-0007-000000000001','bukhan','2026-04-20T08:33:00Z',st_geogfromtext('POINT(127.0012 37.6812)'),10.2,310,4),
  ('00000000-0000-0000-0007-000000000001','bukhan','2026-04-20T08:40:00Z',st_geogfromtext('POINT(127.0015 37.6815)'),11.0,325,5),
  ('00000000-0000-0000-0007-000000000002','bukhan','2026-04-22T08:35:00Z',st_geogfromtext('POINT(127.000004 37.680004)'),11.5,251,0),
  ('00000000-0000-0000-0007-000000000002','bukhan','2026-04-22T08:42:00Z',st_geogfromtext('POINT(127.000304 37.680304)'),10.8,266,1),
  ('00000000-0000-0000-0007-000000000002','bukhan','2026-04-22T08:49:00Z',st_geogfromtext('POINT(127.000604 37.680604)'),11.2,281,2),
  ('00000000-0000-0000-0007-000000000002','bukhan','2026-04-22T08:56:00Z',st_geogfromtext('POINT(127.000904 37.680904)'),10.5,296,3),
  ('00000000-0000-0000-0007-000000000002','bukhan','2026-04-22T09:03:00Z',st_geogfromtext('POINT(127.001204 37.681204)'),11.8,311,4),
  ('00000000-0000-0000-0007-000000000002','bukhan','2026-04-22T09:10:00Z',st_geogfromtext('POINT(127.001504 37.681504)'),10.3,326,5),
  ('00000000-0000-0000-0007-000000000003','bukhan','2026-04-24T09:05:00Z',st_geogfromtext('POINT(126.999996 37.679996)'), 9.2,249,0),
  ('00000000-0000-0000-0007-000000000003','bukhan','2026-04-24T09:12:00Z',st_geogfromtext('POINT(127.000296 37.680296)'), 9.8,264,1),
  ('00000000-0000-0000-0007-000000000003','bukhan','2026-04-24T09:19:00Z',st_geogfromtext('POINT(127.000596 37.680596)'),10.1,279,2),
  ('00000000-0000-0000-0007-000000000003','bukhan','2026-04-24T09:26:00Z',st_geogfromtext('POINT(127.000896 37.680896)'), 9.5,294,3),
  ('00000000-0000-0000-0007-000000000003','bukhan','2026-04-24T09:33:00Z',st_geogfromtext('POINT(127.001196 37.681196)'),10.6,309,4),
  ('00000000-0000-0000-0007-000000000003','bukhan','2026-04-24T09:40:00Z',st_geogfromtext('POINT(127.001496 37.681496)'), 9.9,324,5);

-- ── MVP events ────────────────────────────────────────────────────────────────

insert into public.mvp_events (mountain_id,event_name,event_payload) values
  ('sorak', 'trail_served',   '{"routeId":"sorak-main","routeState":"recommended","version":1,"confidence":0.82}'),
  ('sorak', 'trail_served',   '{"routeId":"sorak-main","routeState":"recommended","version":1,"confidence":0.82}'),
  ('sorak', 'trail_served',   '{"routeId":"sorak-alternate","routeState":"reference","version":1,"confidence":0.54}'),
  ('sorak', 'trail_served',   '{"routeId":"sorak-osaek","routeState":"reference","version":1,"confidence":0.51}'),
  ('sorak', 'trail_served',   '{"routeId":"sorak-hangyeryeong","routeState":"reference","version":1,"confidence":0.46}'),
  ('halla', 'trail_served',   '{"routeId":"halla-main","routeState":"reference","version":1,"confidence":0.42}'),
  ('halla', 'trail_served',   '{"routeId":"halla-eorimok","routeState":"reference","version":1,"confidence":0.48}'),
  ('halla', 'trail_served',   '{"routeId":"halla-yeongsil","routeState":"reference","version":1,"confidence":0.44}'),
  ('dobong','trail_served',   '{"routeId":"dobong-main","routeState":"recommended","version":1,"confidence":0.76}'),
  ('dobong','trail_served',   '{"routeId":"dobong-main","routeState":"recommended","version":1,"confidence":0.76}'),
  ('dobong','trail_served',   '{"routeId":"dobong-west","routeState":"reference","version":1,"confidence":0.52}'),
  ('sorak', 'snap_requested', '{"routeId":"sorak-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('sorak', 'snap_requested', '{"routeId":"sorak-main","routeJudgment":"caution","distanceBucket":"26-50m","trailVersion":1}'),
  ('sorak', 'snap_requested', '{"routeId":"sorak-alternate","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('sorak', 'snap_requested', '{"routeId":"sorak-osaek","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('halla', 'snap_requested', '{"routeId":"halla-main","routeJudgment":"away_from_route","distanceBucket":">50m","trailVersion":1}'),
  ('halla', 'snap_requested', '{"routeId":"halla-eorimok","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('dobong','snap_requested', '{"routeId":"dobong-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('dobong','snap_requested', '{"routeId":"dobong-main","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}'),
  ('dobong','snap_requested', '{"routeId":"dobong-west","routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":1}');
