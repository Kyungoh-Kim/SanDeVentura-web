begin;

select plan(17);

select has_table('public', 'trail_nodes', 'trail graph node table exists');
select has_table('public', 'trail_edges', 'trail graph edge table exists');
select has_table('public', 'candidate_edges', 'candidate edge table exists');
select has_table('public', 'session_edge_attributions', 'session edge attribution table exists');
select has_table('public', 'session_edge_metric_slices', 'session edge metric slice table exists');
select has_table('public', 'trail_edge_segment_metrics', 'trail edge segment metric table exists');
select has_table('public', 'trail_node_transitions', 'trail node transition table exists');
select hasnt_table('public', 'session_trajectory_attributions', 'legacy trajectory attribution table removed');
select hasnt_table('public', 'candidate_trajectories', 'legacy candidate trajectory table removed');
select hasnt_table('public', 'trajectory_segment_metrics', 'legacy trajectory segment metric table removed');
select has_view('public', 'operator_session_edge_attribution', 'operator edge attribution view exists');
select has_view('public', 'operator_candidate_edges', 'operator candidate edge view exists');
select has_function('public', 'replace_session_edge_attributions', array['uuid', 'jsonb'], 'edge attribution replace rpc exists');
select has_function('public', 'trail_graph_for_mountain', array['text'], 'trail graph rpc exists');
select has_function('public', 'candidate_edges_for_mountain', array['text'], 'candidate edge rpc exists');

select is_empty(
  $$
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'operator_session_ingestion',
        'operator_session_edge_attribution',
        'operator_session_route_attribution'
      )
      and column_name in ('lat', 'lon', 'raw_points', 'payload')
  $$,
  'operator session views do not expose raw coordinates or payloads'
);

select is_empty(
  $$
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'trail_nodes',
        'trail_edges',
        'candidate_edges',
        'session_edge_attributions',
        'session_edge_metric_slices',
        'trail_edge_segment_metrics'
      )
  $$,
  'graph base table direct reads are blocked by RLS'
);

select * from finish();

rollback;
