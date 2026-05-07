begin;

select plan(10);

select has_table('public', 'hiking_sessions', 'hiking_sessions table exists');
select has_table('public', 'track_points', 'track_points table exists');
select has_table('public', 'rejected_track_points', 'rejected_track_points table exists');

select col_is_pk('public', 'hiking_sessions', 'id', 'hiking_sessions has primary key');
select has_column('public', 'rejected_track_points', 'recorded_at', 'rejected points keep original timestamp');
select has_column('public', 'rejected_track_points', 'lat', 'rejected points keep original latitude');
select has_column('public', 'rejected_track_points', 'lon', 'rejected points keep original longitude');

select indexes_are(
  'public',
  'hiking_sessions',
  array['hiking_sessions_pkey', 'hiking_sessions_user_id_client_session_key_key', 'hiking_sessions_client_session_key_idx'],
  'hiking_sessions has idempotency indexes'
);

select policies_are(
  'public',
  'track_points',
  array['Block direct raw point reads'],
  'track_points raw reads are blocked'
);

select policies_are(
  'public',
  'rejected_track_points',
  array['Block direct rejected point reads'],
  'rejected_track_points raw reads are blocked'
);

select * from finish();

rollback;
