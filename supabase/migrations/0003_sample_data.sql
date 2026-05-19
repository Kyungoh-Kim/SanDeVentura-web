-- =============================================================================
-- 0003_sample_data.sql
-- Dense process-aligned raw GPS demo seed.
--
-- The seed intentionally stops at upload-stage inputs:
--   - route/mountain catalog rows
--   - hiking_sessions in `ingested` state
--   - raw track_points at roughly 5m spatial spacing
--
-- Trail graph edges, candidate edges, canonical trails, session attributions,
-- segment metrics, and raw purge state must be produced by
-- match-and-aggregate-sessions from these raw points.
-- =============================================================================

truncate
  public.mvp_events,
  public.session_edge_metric_slices,
  public.session_edge_attributions,
  public.session_route_assignments,
  public.rejected_track_points,
  public.track_points,
  public.hiking_sessions,
  public.trail_edge_segment_metrics,
  public.trail_node_transitions,
  public.candidate_edges,
  public.trail_edges,
  public.trail_nodes,
  public.canonical_trails,
  public.routes,
  public.mountains
restart identity cascade;

create function pg_temp.seed_uuid(p_value text)
returns uuid
language sql
immutable
as $$
  select (
    substr(md5(p_value), 1, 8) || '-' ||
    substr(md5(p_value), 9, 4) || '-' ||
    substr(md5(p_value), 13, 4) || '-' ||
    substr(md5(p_value), 17, 4) || '-' ||
    substr(md5(p_value), 21, 12)
  )::uuid;
$$;

insert into public.mountains (id, display_name, source, bbox)
values
  ('sample-hallasan', 'Hallasan Dense Demo', 'dense-sample', '126.4450,33.2850,126.5650,33.3900'),
  ('sample-bukhansan', 'Bukhansan Dense Demo', 'dense-sample', '126.9400,37.6200,127.0300,37.7050'),
  ('sample-dobongsan', 'Dobongsan Dense Demo', 'dense-sample', '126.9850,37.6500,127.0500,37.7150'),
  ('sample-seoraksan', 'Seoraksan Dense Demo', 'dense-sample', '128.3900,38.0750,128.5050,38.1800');

insert into public.routes (id, mountain_id, display_name)
values
  ('sample-halla-yeongsil', 'sample-hallasan', 'Yeongsil Ridge'),
  ('sample-halla-eorimok', 'sample-hallasan', 'Eorimok Approach'),
  ('sample-halla-seongpanak', 'sample-hallasan', 'Seongpanak Summit Trail'),
  ('sample-halla-gwaneumsa', 'sample-hallasan', 'Gwaneumsa Summit Trail'),
  ('sample-halla-donnaeko', 'sample-hallasan', 'Donnaeko Valley Trail'),
  ('sample-bukhan-baegundae', 'sample-bukhansan', 'Baegundae Main'),
  ('sample-bukhan-ui-valley', 'sample-bukhansan', 'Ui Valley Trail'),
  ('sample-bukhan-bibong', 'sample-bukhansan', 'Bibong Ridge'),
  ('sample-bukhan-daedongmun', 'sample-bukhansan', 'Daedongmun Ridge'),
  ('sample-bukhan-doseonsa', 'sample-bukhansan', 'Doseonsa Spur'),
  ('sample-dobong-main', 'sample-dobongsan', 'Dobong Main Ridge'),
  ('sample-dobong-west', 'sample-dobongsan', 'Dobong West Approach'),
  ('sample-dobong-obong', 'sample-dobongsan', 'Obong Traverse'),
  ('sample-dobong-sapae', 'sample-dobongsan', 'Sapaesan Connector'),
  ('sample-seorak-biseondae', 'sample-seoraksan', 'Biseondae Valley'),
  ('sample-seorak-daecheong', 'sample-seoraksan', 'Daecheongbong Main'),
  ('sample-seorak-gongnyong', 'sample-seoraksan', 'Gongnyong Ridge'),
  ('sample-seorak-ulsanbawi', 'sample-seoraksan', 'Ulsanbawi Trail');

create temporary table sample_session_groups (
  group_key text primary key,
  mountain_id text not null,
  route_id text,
  session_count integer not null,
  base_started_at timestamptz not null,
  speed_mps double precision not null default 1.05,
  noise_m double precision not null default 3.0,
  altitude_start_m double precision not null,
  altitude_end_m double precision not null,
  line_wkt text not null
) on commit drop;

insert into sample_session_groups (
  group_key,
  mountain_id,
  route_id,
  session_count,
  base_started_at,
  speed_mps,
  noise_m,
  altitude_start_m,
  altitude_end_m,
  line_wkt
) values
  -- Hallasan: five catalog routes plus unknown branch/merge/connector cases.
  ('halla-yeongsil-reference', 'sample-hallasan', 'sample-halla-yeongsil', 5, '2026-04-01T22:00:00Z', 0.95, 2.8, 1280, 1660,
    'LINESTRING(126.4800 33.3400,126.4842 33.3426,126.4885 33.3456,126.4920 33.3490,126.4962 33.3532,126.5000 33.3564,126.5040 33.3600)'),
  ('halla-eorimok-reference', 'sample-hallasan', 'sample-halla-eorimok', 4, '2026-04-02T22:00:00Z', 0.98, 3.0, 970, 1510,
    'LINESTRING(126.4630 33.3800,126.4700 33.3760,126.4770 33.3720,126.4845 33.3680,126.4920 33.3652,126.4998 33.3635,126.5078 33.3625,126.5158 33.3620,126.5228 33.3620)'),
  ('halla-seongpanak-reference', 'sample-hallasan', 'sample-halla-seongpanak', 5, '2026-04-03T22:00:00Z', 0.92, 3.2, 750, 1860,
    'LINESTRING(126.5550 33.3850,126.5485 33.3792,126.5415 33.3736,126.5340 33.3680,126.5260 33.3636,126.5175 33.3606,126.5090 33.3584,126.5010 33.3564,126.4965 33.3545)'),
  ('halla-gwaneumsa-reference', 'sample-hallasan', 'sample-halla-gwaneumsa', 4, '2026-04-04T22:00:00Z', 0.90, 3.4, 620, 1850,
    'LINESTRING(126.5350 33.3300,126.5302 33.3360,126.5245 33.3420,126.5184 33.3482,126.5112 33.3533,126.5040 33.3564,126.4965 33.3545)'),
  ('halla-donnaeko-reference', 'sample-hallasan', 'sample-halla-donnaeko', 3, '2026-04-05T22:00:00Z', 1.02, 3.4, 530, 1320,
    'LINESTRING(126.5200 33.3000,126.5150 33.3060,126.5100 33.3125,126.5040 33.3195,126.4995 33.3270,126.4960 33.3350,126.4920 33.3430)'),
  ('halla-yeongsil-witse-branch', 'sample-hallasan', 'sample-halla-yeongsil', 4, '2026-04-06T22:00:00Z', 0.92, 3.0, 1285, 1570,
    'LINESTRING(126.4801 33.3400,126.4842 33.3428,126.4885 33.3457,126.4920 33.3490,126.4960 33.3500,126.5000 33.3510,126.5040 33.3520,126.5080 33.3526)'),
  ('halla-west-merge-in', 'sample-hallasan', null, 3, '2026-04-07T22:00:00Z', 0.98, 3.2, 1180, 1560,
    'LINESTRING(126.4680 33.3520,126.4740 33.3512,126.4820 33.3508,126.4880 33.3500,126.4920 33.3490,126.4962 33.3532,126.5000 33.3564)'),
  ('halla-cross-connector', 'sample-hallasan', null, 3, '2026-04-08T22:00:00Z', 1.00, 3.1, 1460, 1530,
    'LINESTRING(126.4920 33.3490,126.4968 33.3530,126.5018 33.3572,126.5078 33.3625)'),

  -- Bukhansan: dense known network plus branch out/in examples.
  ('bukhan-baegundae-reference', 'sample-bukhansan', 'sample-bukhan-baegundae', 5, '2026-04-09T22:00:00Z', 0.98, 3.0, 235, 820,
    'LINESTRING(126.9780 37.6530,126.9820 37.6560,126.9860 37.6590,126.9900 37.6620,126.9940 37.6650,126.9980 37.6685)'),
  ('bukhan-ui-valley-reference', 'sample-bukhansan', 'sample-bukhan-ui-valley', 4, '2026-04-10T22:00:00Z', 1.04, 3.0, 180, 690,
    'LINESTRING(126.9820 37.6400,126.9840 37.6450,126.9860 37.6500,126.9875 37.6548,126.9900 37.6620,126.9940 37.6650)'),
  ('bukhan-bibong-reference', 'sample-bukhansan', 'sample-bukhan-bibong', 4, '2026-04-11T22:00:00Z', 0.96, 3.2, 210, 560,
    'LINESTRING(126.9560 37.6250,126.9615 37.6310,126.9665 37.6375,126.9715 37.6440,126.9760 37.6510,126.9820 37.6560)'),
  ('bukhan-daedongmun-reference', 'sample-bukhansan', 'sample-bukhan-daedongmun', 3, '2026-04-12T22:00:00Z', 0.94, 3.1, 260, 620,
    'LINESTRING(127.0080 37.6360,127.0045 37.6425,127.0015 37.6490,126.9982 37.6550,126.9940 37.6610,126.9900 37.6620)'),
  ('bukhan-doseonsa-reference', 'sample-bukhansan', 'sample-bukhan-doseonsa', 3, '2026-04-13T22:00:00Z', 1.00, 3.2, 210, 540,
    'LINESTRING(127.0120 37.6580,127.0060 37.6600,127.0000 37.6622,126.9940 37.6650)'),
  ('bukhan-south-branch-out', 'sample-bukhansan', 'sample-bukhan-baegundae', 3, '2026-04-14T22:00:00Z', 1.00, 3.0, 235, 705,
    'LINESTRING(126.9780 37.6530,126.9820 37.6560,126.9860 37.6590,126.9895 37.6605,126.9930 37.6620,126.9965 37.6635,127.0000 37.6648)'),
  ('bukhan-north-merge-in', 'sample-bukhansan', null, 3, '2026-04-15T22:00:00Z', 0.96, 3.0, 410, 815,
    'LINESTRING(126.9680 37.6700,126.9745 37.6688,126.9810 37.6670,126.9880 37.6660,126.9940 37.6650,126.9980 37.6685)'),

  -- Dobongsan and Seoraksan add larger mountain-like route variety.
  ('dobong-main-reference', 'sample-dobongsan', 'sample-dobong-main', 5, '2026-04-16T22:00:00Z', 0.95, 3.0, 120, 740,
    'LINESTRING(127.0170 37.6560,127.0178 37.6610,127.0183 37.6660,127.0189 37.6710,127.0194 37.6760,127.0197 37.6810,127.0199 37.6855,127.0201 37.6900,127.0200 37.6920)'),
  ('dobong-west-reference', 'sample-dobongsan', 'sample-dobong-west', 4, '2026-04-17T22:00:00Z', 0.98, 3.1, 270, 640,
    'LINESTRING(127.0020 37.6820,127.0050 37.6840,127.0082 37.6852,127.0110 37.6862,127.0140 37.6872,127.0160 37.6885,127.0178 37.6900,127.0200 37.6920)'),
  ('dobong-obong-reference', 'sample-dobongsan', 'sample-dobong-obong', 3, '2026-04-18T22:00:00Z', 0.92, 3.3, 180, 690,
    'LINESTRING(126.9940 37.6620,127.0000 37.6660,127.0065 37.6700,127.0120 37.6740,127.0165 37.6795,127.0194 37.6860)'),
  ('dobong-sapae-reference', 'sample-dobongsan', 'sample-dobong-sapae', 3, '2026-04-19T22:00:00Z', 1.00, 3.2, 150, 550,
    'LINESTRING(127.0260 37.7060,127.0240 37.7010,127.0225 37.6965,127.0200 37.6920,127.0178 37.6900)'),
  ('dobong-y-branch', 'sample-dobongsan', 'sample-dobong-main', 3, '2026-04-20T22:00:00Z', 0.95, 3.0, 120, 640,
    'LINESTRING(127.0170 37.6560,127.0178 37.6610,127.0183 37.6660,127.0170 37.6715,127.0150 37.6770,127.0130 37.6820,127.0110 37.6870)'),

  ('seorak-biseondae-reference', 'sample-seoraksan', 'sample-seorak-biseondae', 5, '2026-04-21T22:00:00Z', 1.05, 3.2, 180, 620,
    'LINESTRING(128.4650 38.1700,128.4590 38.1640,128.4530 38.1580,128.4470 38.1520,128.4410 38.1460,128.4360 38.1390)'),
  ('seorak-daecheong-reference', 'sample-seoraksan', 'sample-seorak-daecheong', 4, '2026-04-22T22:00:00Z', 0.88, 3.5, 650, 1700,
    'LINESTRING(128.4450 38.0970,128.4472 38.1035,128.4496 38.1100,128.4523 38.1160,128.4554 38.1210,128.4578 38.1270,128.4592 38.1335,128.4601 38.1395,128.4618 38.1490)'),
  ('seorak-gongnyong-reference', 'sample-seoraksan', 'sample-seorak-gongnyong', 3, '2026-04-23T22:00:00Z', 0.82, 3.6, 920, 1510,
    'LINESTRING(128.4260 38.1320,128.4310 38.1370,128.4360 38.1410,128.4420 38.1450,128.4490 38.1480,128.4560 38.1495,128.4618 38.1490)'),
  ('seorak-ulsanbawi-reference', 'sample-seoraksan', 'sample-seorak-ulsanbawi', 4, '2026-04-24T22:00:00Z', 0.96, 3.1, 220, 870,
    'LINESTRING(128.4860 38.1710,128.4810 38.1660,128.4760 38.1605,128.4710 38.1550,128.4660 38.1500,128.4610 38.1460)'),
  ('seorak-hidden-connector', 'sample-seoraksan', null, 3, '2026-04-25T22:00:00Z', 0.90, 3.3, 1060, 1450,
    'LINESTRING(128.4360 38.1390,128.4415 38.1408,128.4470 38.1430,128.4530 38.1460,128.4618 38.1490)');

create temporary table sample_sessions (
  session_id uuid primary key,
  user_id uuid not null,
  group_key text not null,
  mountain_id text not null,
  route_id text,
  session_no integer not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  speed_mps double precision not null,
  noise_m double precision not null,
  altitude_start_m double precision not null,
  altitude_end_m double precision not null,
  geom geometry(LineString,4326) not null,
  length_m double precision not null
) on commit drop;

insert into sample_sessions (
  session_id,
  user_id,
  group_key,
  mountain_id,
  route_id,
  session_no,
  started_at,
  ended_at,
  speed_mps,
  noise_m,
  altitude_start_m,
  altitude_end_m,
  geom,
  length_m
)
select
  pg_temp.seed_uuid(group_key || ':' || session_no),
  pg_temp.seed_uuid('user:' || group_key || ':' || ((session_no - 1) % 6)),
  group_key,
  mountain_id,
  route_id,
  session_no,
  base_started_at + make_interval(hours => (session_no - 1) * 3),
  base_started_at + make_interval(hours => (session_no - 1) * 3)
    + make_interval(secs => ceil(st_length(st_geogfromtext('SRID=4326;' || line_wkt)) / speed_mps)::integer),
  speed_mps * (0.94 + 0.02 * (session_no % 5)),
  noise_m,
  altitude_start_m + (session_no % 3) * 2,
  altitude_end_m + (session_no % 4) * 2,
  st_geomfromtext(line_wkt, 4326),
  st_length(st_geogfromtext('SRID=4326;' || line_wkt))
from sample_session_groups
cross join lateral generate_series(1, session_count) as series(session_no);

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
)
select
  session_id,
  user_id,
  mountain_id,
  route_id,
  'dense-seed-' || group_key || '-' || lpad(session_no::text, 2, '0'),
  started_at,
  ended_at,
  'ingested',
  'beta-route-upload-v1',
  0,
  0,
  ended_at + interval '90 days',
  ended_at + interval '5 minutes'
from sample_sessions;

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
  s.session_id,
  s.mountain_id,
  s.started_at + make_interval(secs => round((step_index * 5.0) / s.speed_mps)::integer),
  st_setsrid(st_makepoint(noisy_lon, noisy_lat), 4326)::geography,
  s.altitude_start_m
    + (s.altitude_end_m - s.altitude_start_m) * fraction
    + sin((step_index * 0.31) + (s.session_no * 1.7)) * 2.0,
  4.5 + abs(sin((step_index * 0.17) + s.session_no)) * 5.5,
  s.speed_mps + sin((step_index * 0.13) + s.session_no) * 0.14,
  0.90 + abs(cos((step_index * 0.07) + s.session_no)) * 0.08,
  step_index
from sample_sessions s
cross join lateral generate_series(0, greatest(2, ceil(s.length_m / 5.0)::integer)) as points(step_index)
cross join lateral (
  select least(1.0, (step_index * 5.0) / nullif(s.length_m, 0)) as fraction
) f
cross join lateral (
  select st_lineinterpolatepoint(s.geom, f.fraction) as base_point
) p
cross join lateral (
  select
    st_y(p.base_point)
      + (sin((step_index * 37.0) + (s.session_no * 101.0)) * s.noise_m) / 111000.0 as noisy_lat,
    st_x(p.base_point)
      + (cos((step_index * 41.0) + (s.session_no * 103.0)) * s.noise_m)
        / (111000.0 * greatest(0.2, cos(radians(st_y(p.base_point))))) as noisy_lon
) n;

insert into public.rejected_track_points (
  session_id,
  reason,
  recorded_at,
  lat,
  lon,
  altitude,
  accuracy,
  speed,
  point_sequence_index,
  debug_payload_sample,
  debug_payload_expires_at
)
select
  s.session_id,
  'gps_accuracy_too_low',
  s.started_at + interval '7 minutes',
  st_y(st_startpoint(s.geom)) + 0.0020,
  st_x(st_startpoint(s.geom)) + 0.0020,
  s.altitude_start_m + 20,
  90,
  0,
  -1,
  jsonb_build_object('seedReason', 'low accuracy outlier'),
  s.started_at + interval '1 day'
from sample_sessions s
where s.session_no = 1;

update public.hiking_sessions hs
set
  accepted_point_count = counts.accepted_count,
  rejected_point_count = counts.rejected_count
from (
  select
    s.session_id,
    count(distinct tp.id)::integer as accepted_count,
    count(distinct rp.id)::integer as rejected_count
  from sample_sessions s
  left join public.track_points tp on tp.session_id = s.session_id
  left join public.rejected_track_points rp on rp.session_id = s.session_id
  group by s.session_id
) counts
where hs.id = counts.session_id;

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
    'seedStage', 'dense-raw-gps-v1',
    'rawSpacingMeters', 5,
    'algorithmResampleMeters', 20
  ),
  hs.created_at
from public.hiking_sessions hs;
