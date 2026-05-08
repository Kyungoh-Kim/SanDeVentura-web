begin;

-- Demo area:
-- NW-ish: 36.4942, 127.3079
-- SE-ish: 36.4864, 127.3192
-- The app default mountain id is beta-mountain, so this seed updates that
-- mountain with a realistic local route inside the requested bounds.

delete from public.mvp_events
where mountain_id = 'beta-mountain';

delete from public.trail_cell_transitions
where route_id in (
  select id from public.routes where mountain_id = 'beta-mountain'
);

delete from public.trail_cells
where route_id in (
  select id from public.routes where mountain_id = 'beta-mountain'
);

delete from public.canonical_trails
where route_id in (
  select id from public.routes where mountain_id = 'beta-mountain'
);

delete from public.rejected_track_points
where session_id in (
  select id
  from public.hiking_sessions
  where mountain_id = 'beta-mountain'
    and client_session_key like 'demo-sejong-route-%'
);

delete from public.track_points
where mountain_id = 'beta-mountain'
  and session_id in (
    select id
    from public.hiking_sessions
    where mountain_id = 'beta-mountain'
      and client_session_key like 'demo-sejong-route-%'
  );

delete from public.hiking_sessions
where mountain_id = 'beta-mountain'
  and client_session_key like 'demo-sejong-route-%';

delete from public.routes
where mountain_id = 'beta-mountain';

insert into public.mountains (id, display_name, source)
values ('beta-mountain', 'Sejong Demo Ridge', 'demo')
on conflict (id) do update
  set display_name = excluded.display_name,
      source = excluded.source;

insert into public.routes (id, mountain_id, display_name)
values ('beta-mountain-main', 'beta-mountain', 'Main Trail')
on conflict (id) do update
  set display_name = excluded.display_name;

with route_points(sequence_index, lat, lon, altitude) as (
  values
    (0, 36.4938, 127.3082, 146.0),
    (1, 36.4928, 127.3096, 154.0),
    (2, 36.4916, 127.3112, 162.0),
    (3, 36.4904, 127.3129, 168.0),
    (4, 36.4892, 127.3146, 173.0),
    (5, 36.4881, 127.3166, 179.0),
    (6, 36.4868, 127.3188, 183.0)
),
demo_sessions as (
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
    retention_review_at
  )
  values
    (
      '90000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001',
      'beta-mountain',
      'beta-mountain-main',
      'demo-sejong-route-1',
      '2026-05-08T00:00:00Z',
      '2026-05-08T00:42:00Z',
      'ingested',
      'beta-upload-consent-v1',
      7,
      0,
      '2026-08-08T00:00:00Z'
    ),
    (
      '90000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000002',
      'beta-mountain',
      'beta-mountain-main',
      'demo-sejong-route-2',
      '2026-05-08T01:00:00Z',
      '2026-05-08T01:44:00Z',
      'ingested',
      'beta-upload-consent-v1',
      7,
      1,
      '2026-08-08T00:00:00Z'
    ),
    (
      '90000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000003',
      'beta-mountain',
      'beta-mountain-main',
      'demo-sejong-route-3',
      '2026-05-08T02:00:00Z',
      '2026-05-08T02:41:00Z',
      'ingested',
      'beta-upload-consent-v1',
      7,
      0,
      '2026-08-08T00:00:00Z'
    ),
    (
      '90000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000004',
      'beta-mountain',
      'beta-mountain-main',
      'demo-sejong-route-4',
      '2026-05-08T03:00:00Z',
      '2026-05-08T03:46:00Z',
      'ingested',
      'beta-upload-consent-v1',
      7,
      2,
      '2026-08-08T00:00:00Z'
    )
  on conflict (id) do update
    set status               = excluded.status,
        route_id             = excluded.route_id,
        accepted_point_count = excluded.accepted_point_count,
        rejected_point_count = excluded.rejected_point_count
  returning id, client_session_key, started_at
),
track_seed as (
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
    demo_sessions.id,
    'beta-mountain',
    demo_sessions.started_at + make_interval(mins => route_points.sequence_index * 6),
    st_setsrid(
      st_makepoint(
        route_points.lon +
          case demo_sessions.client_session_key
            when 'demo-sejong-route-2' then 0.00003
            when 'demo-sejong-route-3' then -0.00002
            when 'demo-sejong-route-4' then 0.00001
            else 0
          end,
        route_points.lat +
          case demo_sessions.client_session_key
            when 'demo-sejong-route-2' then -0.00002
            when 'demo-sejong-route-3' then 0.00003
            when 'demo-sejong-route-4' then -0.00001
            else 0
          end
      ),
      4326
    )::geography,
    route_points.altitude,
    case demo_sessions.client_session_key
      when 'demo-sejong-route-4' then 14.0
      else 9.0
    end,
    1.15,
    case demo_sessions.client_session_key
      when 'demo-sejong-route-4' then 0.86
      else 0.91
    end,
    route_points.sequence_index
  from demo_sessions
  cross join route_points
  returning id
),
rejected_seed as (
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
  values
    (
      '90000000-0000-4000-8000-000000000002',
      'low_accuracy',
      '2026-05-08T01:21:00Z',
      36.4909,
      127.3134,
      169.0,
      82.0,
      1.0,
      30,
      '{"demo":true,"reason":"low_accuracy"}'::jsonb,
      '2026-05-15T00:00:00Z'
    ),
    (
      '90000000-0000-4000-8000-000000000004',
      'speed_outlier',
      '2026-05-08T03:18:00Z',
      36.4910,
      127.3138,
      171.0,
      18.0,
      8.4,
      31,
      '{"demo":true,"reason":"speed_outlier"}'::jsonb,
      '2026-05-15T00:00:00Z'
    ),
    (
      '90000000-0000-4000-8000-000000000004',
      'low_accuracy',
      '2026-05-08T03:40:00Z',
      36.4875,
      127.3184,
      183.0,
      95.0,
      1.1,
      32,
      '{"demo":true,"reason":"low_accuracy"}'::jsonb,
      '2026-05-15T00:00:00Z'
    )
  returning id
),
canonical_seed as (
  insert into public.canonical_trails (
    route_id,
    version,
    geom,
    confidence,
    confidence_level,
    session_count,
    branch_ambiguity_score,
    gps_quality_score,
    updated_at
  )
  values (
    'beta-mountain-main',
    100,
    'LINESTRING(127.3082 36.4938,127.3096 36.4928,127.3112 36.4916,127.3129 36.4904,127.3146 36.4892,127.3166 36.4881,127.3188 36.4868)'::geography,
    0.84,
    'recommended',
    4,
    0.12,
    0.90,
    '2026-05-08T04:00:00Z'
  )
  returning id
),
cell_values(cell_key, lat, lon, point_count, session_count, avg_altitude, last_seen_at, quality_score) as (
  values
    ('demo-sejong-00', 36.4938, 127.3082, 4, 4, 146.0, '2026-05-08T03:00:00Z'::timestamptz, 0.91),
    ('demo-sejong-01', 36.4928, 127.3096, 4, 4, 154.0, '2026-05-08T03:06:00Z'::timestamptz, 0.91),
    ('demo-sejong-02', 36.4916, 127.3112, 4, 4, 162.0, '2026-05-08T03:12:00Z'::timestamptz, 0.91),
    ('demo-sejong-03', 36.4904, 127.3129, 4, 4, 168.0, '2026-05-08T03:18:00Z'::timestamptz, 0.90),
    ('demo-sejong-04', 36.4892, 127.3146, 4, 4, 173.0, '2026-05-08T03:24:00Z'::timestamptz, 0.90),
    ('demo-sejong-05', 36.4881, 127.3166, 4, 4, 179.0, '2026-05-08T03:30:00Z'::timestamptz, 0.89),
    ('demo-sejong-06', 36.4868, 127.3188, 4, 4, 183.0, '2026-05-08T03:36:00Z'::timestamptz, 0.89)
),
cell_seed as (
  insert into public.trail_cells (
    route_id,
    cell_key,
    geom,
    point_count,
    session_count,
    avg_accuracy,
    avg_altitude,
    last_seen_at,
    quality_score
  )
  select
    'beta-mountain-main',
    cell_key,
    st_setsrid(st_makepoint(lon, lat), 4326)::geography,
    point_count,
    session_count,
    10.25,
    avg_altitude,
    last_seen_at,
    quality_score
  from cell_values
  returning cell_key
),
transition_values(from_cell_key, to_cell_key, transition_count, session_count, edge_cost) as (
  values
    ('demo-sejong-00', 'demo-sejong-01', 4, 4, 0.25),
    ('demo-sejong-01', 'demo-sejong-02', 4, 4, 0.25),
    ('demo-sejong-02', 'demo-sejong-03', 4, 4, 0.25),
    ('demo-sejong-03', 'demo-sejong-04', 4, 4, 0.25),
    ('demo-sejong-04', 'demo-sejong-05', 4, 4, 0.25),
    ('demo-sejong-05', 'demo-sejong-06', 4, 4, 0.25)
),
transition_seed as (
  insert into public.trail_cell_transitions (
    route_id,
    from_cell_key,
    to_cell_key,
    transition_count,
    session_count,
    edge_cost
  )
  select
    'beta-mountain-main',
    from_cell_key,
    to_cell_key,
    transition_count,
    session_count,
    edge_cost
  from transition_values
  returning id
),
event_seed as (
  insert into public.mvp_events (
    user_id,
    mountain_id,
    session_id,
    event_name,
    event_payload,
    created_at
  )
  values
    (null, 'beta-mountain', null, 'trail_served', '{"routeState":"recommended","version":100}'::jsonb, '2026-05-08T04:05:00Z'),
    (null, 'beta-mountain', null, 'trail_served', '{"routeState":"recommended","version":100}'::jsonb, '2026-05-08T04:06:00Z'),
    (null, 'beta-mountain', null, 'snap_requested', '{"routeJudgment":"on_route","distanceBucket":"0-25m","trailVersion":100}'::jsonb, '2026-05-08T04:10:00Z'),
    (null, 'beta-mountain', null, 'snap_requested', '{"routeJudgment":"caution","distanceBucket":"26-50m","trailVersion":100}'::jsonb, '2026-05-08T04:12:00Z')
  returning id
)
select
  'beta-mountain'                                as mountain_id,
  'beta-mountain-main'                           as route_id,
  (select count(*) from track_seed)             as accepted_track_points,
  (select count(*) from rejected_seed)           as rejected_track_points,
  (select count(*) from canonical_seed)          as canonical_routes,
  (select count(*) from cell_seed)               as trail_cells,
  (select count(*) from transition_seed)         as trail_transitions,
  (select count(*) from event_seed)              as operator_events;

commit;
