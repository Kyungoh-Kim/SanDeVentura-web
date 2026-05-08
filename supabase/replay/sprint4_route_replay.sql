with mountain_seed as (
  insert into public.mountains (id, display_name, source)
  values
    ('beta-mountain', 'Beta Mountain', 'internal'),
    ('branch-test-mountain', 'Branch Test Mountain', 'internal')
  on conflict (id) do nothing
  returning id
),
clean_sessions as (
  insert into public.hiking_sessions (
    user_id,
    mountain_id,
    client_session_key,
    started_at,
    ended_at,
    status,
    upload_consent_version,
    accepted_point_count,
    rejected_point_count,
    retention_review_at
  )
  select
    '00000000-0000-4000-8000-000000000001'::uuid,
    'beta-mountain',
    'replay-beta-session-' || session_index,
    '2026-05-08T01:00:00Z'::timestamptz + make_interval(hours => session_index),
    '2026-05-08T02:00:00Z'::timestamptz + make_interval(hours => session_index),
    'ingested',
    'beta-upload-consent-v1',
    5,
    0,
    '2026-08-08T00:00:00Z'
  from generate_series(1, 3) as session_index
  on conflict (user_id, client_session_key) do update
    set status = excluded.status
  returning id, client_session_key
),
clean_points as (
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
    clean_sessions.id,
    'beta-mountain',
    '2026-05-08T01:00:00Z'::timestamptz + make_interval(mins => point_index),
    st_setsrid(
      st_makepoint(
        127.0000 + point_index * 0.0003,
        37.5000 + point_index * 0.0003
      ),
      4326
    )::geography,
    300 + point_index,
    10,
    1.2,
    0.9,
    point_index
  from clean_sessions
  cross join generate_series(0, 4) as point_index
  returning id
),
branch_sessions as (
  insert into public.hiking_sessions (
    user_id,
    mountain_id,
    client_session_key,
    started_at,
    ended_at,
    status,
    upload_consent_version,
    accepted_point_count,
    rejected_point_count,
    retention_review_at
  )
  select
    '00000000-0000-4000-8000-000000000001'::uuid,
    'branch-test-mountain',
    'replay-branch-session-' || session_index,
    '2026-05-09T01:00:00Z'::timestamptz + make_interval(hours => session_index),
    '2026-05-09T02:00:00Z'::timestamptz + make_interval(hours => session_index),
    'ingested',
    'beta-upload-consent-v1',
    5,
    0,
    '2026-08-09T00:00:00Z'
  from generate_series(1, 2) as session_index
  on conflict (user_id, client_session_key) do update
    set status = excluded.status
  returning id, client_session_key
),
branch_point_values (client_session_key, sequence_index, lon, lat) as (
  values
    ('replay-branch-session-1', 0, 127.0100, 37.5100),
    ('replay-branch-session-1', 1, 127.0103, 37.5103),
    ('replay-branch-session-1', 2, 127.0106, 37.5106),
    ('replay-branch-session-1', 3, 127.0109, 37.5109),
    ('replay-branch-session-1', 4, 127.0112, 37.5112),
    ('replay-branch-session-2', 0, 127.0100, 37.5100),
    ('replay-branch-session-2', 1, 127.0103, 37.5103),
    ('replay-branch-session-2', 2, 127.0106, 37.5106),
    ('replay-branch-session-2', 3, 127.0109, 37.5102),
    ('replay-branch-session-2', 4, 127.0112, 37.5098)
),
branch_points as (
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
    branch_sessions.id,
    'branch-test-mountain',
    '2026-05-09T01:00:00Z'::timestamptz +
      make_interval(mins => branch_point_values.sequence_index),
    st_setsrid(
      st_makepoint(branch_point_values.lon, branch_point_values.lat),
      4326
    )::geography,
    420 + branch_point_values.sequence_index,
    18,
    1.0,
    0.82,
    branch_point_values.sequence_index
  from branch_sessions
  join branch_point_values
    on branch_point_values.client_session_key = branch_sessions.client_session_key
  returning id
)
select
  (select count(*) from clean_points) as clean_point_count,
  (select count(*) from branch_points) as branch_point_count;
