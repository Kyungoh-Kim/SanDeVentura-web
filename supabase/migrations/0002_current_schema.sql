-- =============================================================================
-- 0002_current_schema.sql
-- Baseline schema for the trail graph inference pipeline.
-- =============================================================================

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;



--
-- Name: candidate_edges_for_mountain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.candidate_edges_for_mountain(p_mountain_id text) RETURNS TABLE(id uuid, mountain_id text, trail_geojson jsonb, attach_start_edge_id uuid, attach_start_measure_m double precision, attach_end_edge_id uuid, attach_end_measure_m double precision, residual_kind text, point_count integer, session_count integer, length_m double precision, confidence double precision, confidence_level text, promotion_ready boolean, validation_failure_reason text, latest_evidence_at timestamp with time zone, algorithm_version text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  with scored as (
    select
      ce.*,
      case
        when ce.attach_start_edge_id is null or ce.attach_start_measure_m is null then null
        else st_distance(
          st_startpoint(ce.geom::geometry)::geography,
          st_lineinterpolatepoint(
            start_edge.geom::geometry,
            least(1, greatest(0, ce.attach_start_measure_m / nullif(coalesce(start_edge.length_m, st_length(start_edge.geom)), 0)))
          )::geography
        )
      end as start_attach_gap_m,
      case
        when ce.attach_end_edge_id is null or ce.attach_end_measure_m is null then null
        else st_distance(
          st_endpoint(ce.geom::geometry)::geography,
          st_lineinterpolatepoint(
            end_edge.geom::geometry,
            least(1, greatest(0, ce.attach_end_measure_m / nullif(coalesce(end_edge.length_m, st_length(end_edge.geom)), 0)))
          )::geography
        )
      end as end_attach_gap_m
    from public.candidate_edges ce
    left join public.trail_edges start_edge on start_edge.id = ce.attach_start_edge_id
    left join public.trail_edges end_edge on end_edge.id = ce.attach_end_edge_id
    where ce.mountain_id = p_mountain_id
      and ce.status = 'candidate'
  ),
  validated as (
    select
      scored.*,
      coalesce(
        scored.validation_failure_reason,
        case
          when scored.start_attach_gap_m > 60 then 'start_attach_not_connected'
          when scored.end_attach_gap_m > 60 then 'end_attach_not_connected'
          else null
        end
      ) as effective_validation_failure_reason
    from scored
  )
  select
    validated.id,
    validated.mountain_id,
    st_asgeojson(validated.geom::geometry)::jsonb,
    validated.attach_start_edge_id,
    validated.attach_start_measure_m,
    validated.attach_end_edge_id,
    validated.attach_end_measure_m,
    validated.residual_kind,
    validated.point_count,
    validated.session_count,
    validated.length_m,
    validated.confidence,
    validated.confidence_level,
    validated.confidence_level = 'recommended'
      and validated.session_count >= 3
      and coalesce(validated.length_m, 0) >= 80
      and coalesce(validated.attach_repeatability, 1) >= 0.67
      and validated.effective_validation_failure_reason is null as promotion_ready,
    validated.effective_validation_failure_reason,
    validated.latest_evidence_at,
    validated.algorithm_version
  from validated
  order by promotion_ready desc, validated.confidence desc nulls last, validated.latest_evidence_at desc nulls last
$$;


--
-- Name: latest_canonical_trail(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.latest_canonical_trail(p_route_id text) RETURNS TABLE(route_id text, mountain_id text, mountain_name text, route_name text, route_state text, version integer, confidence double precision, updated_at timestamp with time zone, trail_geojson jsonb, session_count integer, branch_ambiguity_score double precision, gps_quality_score double precision)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  select
    ct.route_id,
    r.mountain_id,
    m.display_name                                  as mountain_name,
    r.display_name                                  as route_name,
    ct.confidence_level                             as route_state,
    ct.version,
    ct.confidence,
    ct.updated_at,
    case
      when ct.geom is null then null
      else st_asgeojson(ct.geom::geometry)::jsonb
    end                                             as trail_geojson,
    ct.session_count,
    ct.branch_ambiguity_score,
    ct.gps_quality_score
  from public.canonical_trails ct
  join public.routes  r on r.id  = ct.route_id
  join public.mountains m on m.id = r.mountain_id
  where ct.route_id = p_route_id
  order by ct.version desc
  limit 1
$$;


--
-- Name: purge_session_raw_points(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_session_raw_points(p_session_id uuid) RETURNS TABLE(deleted_track_point_count integer, deleted_rejected_point_count integer)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
declare
  v_deleted_track_points integer := 0;
  v_deleted_rejected_points integer := 0;
begin
  delete from public.rejected_track_points
   where session_id = p_session_id;
  get diagnostics v_deleted_rejected_points = row_count;

  delete from public.track_points
   where session_id = p_session_id;
  get diagnostics v_deleted_track_points = row_count;

  update public.hiking_sessions
     set raw_retention_state = 'purged',
         recomputable = false
   where id = p_session_id;

  return query
  select v_deleted_track_points, v_deleted_rejected_points;
end;
$$;


--
-- Name: rebuild_trail_edge_segment_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rebuild_trail_edge_segment_metrics() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
begin
  delete from public.trail_edge_segment_metrics
   where true;

  insert into public.trail_edge_segment_metrics (
    mountain_id, target_kind, target_id, edge_id, candidate_edge_id, direction,
    segment_index, start_measure_m, end_measure_m, session_count, sample_count,
    duration_seconds_avg, duration_seconds_sum, duration_observation_count,
    speed_mps_avg, elevation_gain_m, elevation_loss_m, abrupt_altitude_change_count,
    max_abs_altitude_delta_m, latest_evidence_at, algorithm_version, updated_at
  )
  select
    mountain_id,
    target_kind,
    case when target_kind = 'edge' then edge_id::text else candidate_edge_id::text end as target_id,
    edge_id,
    candidate_edge_id,
    direction,
    segment_index,
    min(start_measure_m),
    max(end_measure_m),
    count(distinct session_id)::integer,
    coalesce(sum(sample_count), 0)::integer,
    case
      when sum(duration_observation_count) > 0
      then sum(coalesce(duration_seconds, 0)) / sum(duration_observation_count)
      else null
    end,
    sum(coalesce(duration_seconds, 0)),
    sum(duration_observation_count)::integer,
    case
      when sum(coalesce(duration_seconds, 0)) > 0
      then sum(speed_distance_m) / sum(coalesce(duration_seconds, 0))
      else null
    end,
    sum(elevation_gain_m),
    sum(elevation_loss_m),
    sum(abrupt_altitude_change_count)::integer,
    max(max_abs_altitude_delta_m),
    max(latest_evidence_at),
    max(algorithm_version),
    now()
  from public.session_edge_metric_slices
  group by mountain_id, target_kind, edge_id, candidate_edge_id, direction, segment_index;
end;
$$;


--
-- Name: replace_session_edge_attributions(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_session_edge_attributions(p_session_id uuid, p_rows jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
begin
  delete from public.session_edge_attributions
   where session_id = p_session_id;

  insert into public.session_edge_attributions (
    session_id, mountain_id, interval_index, target_kind, edge_id, candidate_edge_id,
    residual_kind, direction, session_start_measure_m, session_end_measure_m,
    edge_start_measure_m, edge_end_measure_m, attach_start_edge_id,
    attach_start_measure_m, attach_end_edge_id, attach_end_measure_m, point_count,
    matched_length_m, avg_accuracy, avg_altitude, algorithm_version, matched_at
  )
  select
    p_session_id,
    row->>'mountainId',
    (row->>'intervalIndex')::integer,
    row->>'targetKind',
    nullif(row->>'edgeId', '')::uuid,
    nullif(row->>'candidateEdgeId', '')::uuid,
    nullif(row->>'residualKind', ''),
    coalesce(row->>'direction', 'unknown'),
    nullif(row->>'sessionStartMeasureMeters', '')::double precision,
    nullif(row->>'sessionEndMeasureMeters', '')::double precision,
    nullif(row->>'edgeStartMeasureMeters', '')::double precision,
    nullif(row->>'edgeEndMeasureMeters', '')::double precision,
    nullif(row->>'attachStartEdgeId', '')::uuid,
    nullif(row->>'attachStartMeasureMeters', '')::double precision,
    nullif(row->>'attachEndEdgeId', '')::uuid,
    nullif(row->>'attachEndMeasureMeters', '')::double precision,
    (row->>'pointCount')::integer,
    nullif(row->>'matchedLengthMeters', '')::double precision,
    nullif(row->>'avgAccuracy', '')::double precision,
    nullif(row->>'avgAltitude', '')::double precision,
    coalesce(row->>'algorithmVersion', 'trail-graph-v1'),
    now()
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  where row->>'mountainId' is not null
    and row->>'targetKind' in ('edge', 'candidate')
    and row->>'intervalIndex' is not null
    and row->>'pointCount' is not null;
end;
$$;


--
-- Name: replace_session_edge_metric_slices(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_session_edge_metric_slices(p_session_id uuid, p_rows jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
begin
  delete from public.session_edge_metric_slices
   where session_id = p_session_id;

  insert into public.session_edge_metric_slices (
    session_id, mountain_id, interval_index, target_kind, edge_id, candidate_edge_id,
    direction, segment_index, start_measure_m, end_measure_m, sample_count,
    duration_seconds, duration_observation_count, speed_distance_m,
    elevation_gain_m, elevation_loss_m, abrupt_altitude_change_count,
    max_abs_altitude_delta_m, latest_evidence_at, algorithm_version
  )
  select
    p_session_id,
    row->>'mountainId',
    (row->>'intervalIndex')::integer,
    row->>'targetKind',
    nullif(row->>'edgeId', '')::uuid,
    nullif(row->>'candidateEdgeId', '')::uuid,
    coalesce(row->>'direction', 'unknown'),
    (row->>'segmentIndex')::integer,
    (row->>'startMeasureMeters')::double precision,
    (row->>'endMeasureMeters')::double precision,
    coalesce((row->>'sampleCount')::integer, 0),
    nullif(row->>'durationSeconds', '')::double precision,
    coalesce((row->>'durationObservationCount')::integer, 0),
    coalesce((row->>'speedDistanceMeters')::double precision, 0),
    coalesce((row->>'elevationGainMeters')::double precision, 0),
    coalesce((row->>'elevationLossMeters')::double precision, 0),
    coalesce((row->>'abruptAltitudeChangeCount')::integer, 0),
    nullif(row->>'maxAbsAltitudeDeltaMeters', '')::double precision,
    nullif(row->>'latestEvidenceAt', '')::timestamptz,
    coalesce(row->>'algorithmVersion', 'trail-graph-v1')
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) as row
  where row->>'mountainId' is not null
    and row->>'targetKind' in ('edge', 'candidate')
    and row->>'segmentIndex' is not null;
end;
$$;


--
-- Name: route_quality_inputs(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.route_quality_inputs(p_route_id text) RETURNS TABLE(accepted_point_count integer, rejected_point_count integer, latest_evidence_at timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  with route_edges as (
    select id
    from public.trail_edges
    where route_id = p_route_id
  ),
  route_sessions as (
    select distinct sea.session_id
    from public.session_edge_attributions sea
    join route_edges re on re.id = sea.edge_id
    union
    select id
    from public.hiking_sessions
    where route_id = p_route_id
  ),
  session_counts as (
    select
      coalesce(sum(hs.accepted_point_count), 0)::integer as accepted_point_count,
      coalesce(sum(hs.rejected_point_count), 0)::integer as rejected_point_count
    from public.hiking_sessions hs
    join route_sessions rs on rs.session_id = hs.id
  ),
  evidence_times as (
    select sea.matched_at as evidence_at
    from public.session_edge_attributions sea
    join route_edges re on re.id = sea.edge_id
    union all
    select coalesce(hs.ended_at, hs.started_at)
    from public.hiking_sessions hs
    join route_sessions rs on rs.session_id = hs.id
  )
  select
    session_counts.accepted_point_count,
    session_counts.rejected_point_count,
    (select max(evidence_at) from evidence_times where evidence_at is not null)
  from session_counts
$$;


--
-- Name: session_track_points(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.session_track_points(p_session_id uuid) RETURNS TABLE(session_id uuid, recorded_at timestamp with time zone, lat double precision, lon double precision, accuracy double precision, altitude double precision, sequence_index integer)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  select
    tp.session_id,
    tp.recorded_at,
    st_y(tp.geom::geometry) as lat,
    st_x(tp.geom::geometry) as lon,
    tp.accuracy,
    tp.altitude,
    tp.sequence_index
  from public.track_points tp
  where tp.session_id = p_session_id
  order by tp.sequence_index
$$;


--
-- Name: snap_position_to_trail(text, double precision, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.snap_position_to_trail(p_route_id text, p_lat double precision, p_lon double precision) RETURNS TABLE(success boolean, distance_meters double precision, snapped_lat double precision, snapped_lon double precision, trail_version integer, route_state text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  with latest as (
    select *
    from public.canonical_trails
    where route_id = p_route_id
      and geom is not null
    order by version desc
    limit 1
  ),
  input as (
    select st_setsrid(st_makepoint(p_lon, p_lat), 4326) as geom
  ),
  snapped as (
    select
      latest.version,
      latest.confidence_level,
      st_lineinterpolatepoint(
        latest.geom::geometry,
        st_linelocatepoint(latest.geom::geometry, input.geom)
      )                                                      as geom,
      st_distance(latest.geom, input.geom::geography)        as distance_meters
    from latest, input
  )
  select
    true,
    snapped.distance_meters,
    st_y(snapped.geom),
    st_x(snapped.geom),
    snapped.version,
    snapped.confidence_level
  from snapped
$$;


--
-- Name: trail_edges_for_mountain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trail_edges_for_mountain(p_mountain_id text) RETURNS TABLE(id uuid, mountain_id text, route_id text, from_node_id uuid, to_node_id uuid, trail_geojson jsonb, length_m double precision, session_count integer, point_count integer, confidence double precision, status text, algorithm_version text)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  select
    te.id,
    te.mountain_id,
    te.route_id,
    te.from_node_id,
    te.to_node_id,
    st_asgeojson(te.geom::geometry)::jsonb,
    te.length_m,
    te.session_count,
    te.point_count,
    te.confidence,
    te.status,
    te.algorithm_version
  from public.trail_edges te
  where te.mountain_id = p_mountain_id
    and te.status <> 'retired'
  order by te.status desc, te.updated_at desc
$$;


--
-- Name: trail_graph_for_mountain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trail_graph_for_mountain(p_mountain_id text) RETURNS TABLE(graph_json jsonb)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
  select jsonb_build_object(
    'nodes',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tn.id,
        'kind', tn.kind,
        'pointGeoJson', st_asgeojson(tn.geom::geometry)::jsonb,
        'supportCount', tn.support_count,
        'confidence', tn.confidence
      ) order by tn.created_at)
      from public.trail_nodes tn
      where tn.mountain_id = p_mountain_id
    ), '[]'::jsonb),
    'edges',
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', te.id,
        'routeId', te.route_id,
        'fromNodeId', te.from_node_id,
        'toNodeId', te.to_node_id,
        'trailGeoJson', st_asgeojson(te.geom::geometry)::jsonb,
        'lengthMeters', te.length_m,
        'sessionCount', te.session_count,
        'pointCount', te.point_count,
        'confidence', te.confidence,
        'status', te.status,
        'algorithmVersion', te.algorithm_version
      ) order by te.updated_at desc)
      from public.trail_edges te
      where te.mountain_id = p_mountain_id
        and te.status <> 'retired'
    ), '[]'::jsonb)
  ) as graph_json
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: candidate_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidate_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mountain_id text NOT NULL,
    geom extensions.geography(LineString,4326) NOT NULL,
    attach_start_node_id uuid,
    attach_end_node_id uuid,
    attach_start_edge_id uuid,
    attach_end_edge_id uuid,
    attach_start_measure_m double precision,
    attach_end_measure_m double precision,
    residual_kind text DEFAULT 'standalone'::text NOT NULL,
    point_count integer DEFAULT 0 NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    contributing_sessions uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    avg_accuracy double precision,
    avg_altitude double precision,
    length_m double precision,
    confidence double precision,
    confidence_level text DEFAULT 'reference'::text NOT NULL,
    status text DEFAULT 'candidate'::text NOT NULL,
    validation_failure_reason text,
    attach_repeatability double precision,
    latest_evidence_at timestamp with time zone,
    algorithm_version text DEFAULT 'trail-graph-v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT candidate_edges_confidence_level_check CHECK ((confidence_level = ANY (ARRAY['reference'::text, 'recommended'::text]))),
    CONSTRAINT candidate_edges_residual_kind_check CHECK ((residual_kind = ANY (ARRAY['branch_out'::text, 'branch_in'::text, 'connector'::text, 'standalone'::text]))),
    CONSTRAINT candidate_edges_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'promoted'::text, 'retired'::text, 'review_required'::text])))
);


--
-- Name: canonical_trails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_trails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    version integer NOT NULL,
    geom extensions.geography(LineString,4326),
    confidence double precision,
    confidence_level text NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    branch_ambiguity_score double precision,
    gps_quality_score double precision,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    route_id text NOT NULL,
    algorithm_version text DEFAULT 'trail-graph-v1'::text NOT NULL,
    source_kind text DEFAULT 'trail_graph_edge'::text NOT NULL
);


--
-- Name: hiking_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hiking_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    mountain_id text NOT NULL,
    client_session_key text NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    status text NOT NULL,
    upload_consent_version text NOT NULL,
    accepted_point_count integer DEFAULT 0 NOT NULL,
    rejected_point_count integer DEFAULT 0 NOT NULL,
    retention_review_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    route_id text,
    processed_algorithm_version text,
    raw_retention_state text DEFAULT 'available'::text NOT NULL,
    recomputable boolean DEFAULT true NOT NULL,
    CONSTRAINT hiking_sessions_raw_retention_state_check CHECK ((raw_retention_state = ANY (ARRAY['available'::text, 'purged'::text])))
);


--
-- Name: mountains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mountains (
    id text NOT NULL,
    display_name text NOT NULL,
    source text DEFAULT 'internal'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    bbox text
);


--
-- Name: mvp_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mvp_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    mountain_id text,
    session_id uuid,
    event_name text NOT NULL,
    event_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: routes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routes (
    id text NOT NULL,
    mountain_id text NOT NULL,
    display_name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trail_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trail_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mountain_id text NOT NULL,
    route_id text,
    from_node_id uuid,
    to_node_id uuid,
    geom extensions.geography(LineString,4326) NOT NULL,
    length_m double precision,
    session_count integer DEFAULT 0 NOT NULL,
    point_count integer DEFAULT 0 NOT NULL,
    confidence double precision,
    status text DEFAULT 'reference'::text NOT NULL,
    algorithm_version text DEFAULT 'trail-graph-v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trail_edges_status_check CHECK ((status = ANY (ARRAY['candidate'::text, 'reference'::text, 'recommended'::text, 'retired'::text])))
);


--
-- Name: operator_candidate_edges; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_candidate_edges WITH (security_invoker='true') AS
 WITH scored AS (
         SELECT ce.id,
            ce.mountain_id,
            ce.geom,
            ce.attach_start_edge_id,
            ce.attach_start_measure_m,
            ce.attach_end_edge_id,
            ce.attach_end_measure_m,
            ce.residual_kind,
            ce.point_count,
            ce.session_count,
            ce.length_m,
            ce.confidence,
            ce.confidence_level,
            ce.attach_repeatability,
            ce.validation_failure_reason,
            ce.latest_evidence_at,
            ce.algorithm_version,
            ce.updated_at,
            CASE
                WHEN ((ce.attach_start_edge_id IS NULL) OR (ce.attach_start_measure_m IS NULL)) THEN NULL::double precision
                ELSE extensions.st_distance(extensions.st_startpoint((ce.geom)::extensions.geometry)::extensions.geography, extensions.st_lineinterpolatepoint((start_edge.geom)::extensions.geometry, LEAST((1)::double precision, GREATEST((0)::double precision, (ce.attach_start_measure_m / NULLIF(COALESCE(start_edge.length_m, extensions.st_length(start_edge.geom)), (0)::double precision)))))::extensions.geography)
            END AS start_attach_gap_m,
            CASE
                WHEN ((ce.attach_end_edge_id IS NULL) OR (ce.attach_end_measure_m IS NULL)) THEN NULL::double precision
                ELSE extensions.st_distance(extensions.st_endpoint((ce.geom)::extensions.geometry)::extensions.geography, extensions.st_lineinterpolatepoint((end_edge.geom)::extensions.geometry, LEAST((1)::double precision, GREATEST((0)::double precision, (ce.attach_end_measure_m / NULLIF(COALESCE(end_edge.length_m, extensions.st_length(end_edge.geom)), (0)::double precision)))))::extensions.geography)
            END AS end_attach_gap_m
           FROM ((public.candidate_edges ce
             LEFT JOIN public.trail_edges start_edge ON ((start_edge.id = ce.attach_start_edge_id)))
             LEFT JOIN public.trail_edges end_edge ON ((end_edge.id = ce.attach_end_edge_id)))
          WHERE (ce.status = 'candidate'::text)
        ), validated AS (
         SELECT scored.id,
            scored.mountain_id,
            scored.geom,
            scored.attach_start_edge_id,
            scored.attach_start_measure_m,
            scored.attach_end_edge_id,
            scored.attach_end_measure_m,
            scored.residual_kind,
            scored.point_count,
            scored.session_count,
            scored.length_m,
            scored.confidence,
            scored.confidence_level,
            scored.attach_repeatability,
            COALESCE(scored.validation_failure_reason, CASE
                WHEN (scored.start_attach_gap_m > (60)::double precision) THEN 'start_attach_not_connected'::text
                WHEN (scored.end_attach_gap_m > (60)::double precision) THEN 'end_attach_not_connected'::text
                ELSE NULL::text
            END) AS validation_failure_reason,
            scored.latest_evidence_at,
            scored.algorithm_version,
            scored.updated_at
           FROM scored
        )
 SELECT validated.id,
    validated.mountain_id,
    m.display_name AS mountain_display_name,
    (extensions.st_asgeojson((validated.geom)::extensions.geometry))::jsonb AS trail_geojson,
    validated.attach_start_edge_id,
    validated.attach_start_measure_m,
    validated.attach_end_edge_id,
    validated.attach_end_measure_m,
    validated.residual_kind,
    validated.point_count,
    validated.session_count,
    validated.length_m,
    validated.confidence,
    validated.confidence_level,
    ((validated.confidence_level = 'recommended'::text) AND (validated.session_count >= 3) AND (COALESCE(validated.length_m, (0)::double precision) >= (80)::double precision) AND (COALESCE(validated.attach_repeatability, (1)::double precision) >= (0.67)::double precision) AND (validated.validation_failure_reason IS NULL)) AS promotion_ready,
    validated.validation_failure_reason,
    validated.latest_evidence_at,
    validated.algorithm_version,
    validated.updated_at
   FROM (validated
     JOIN public.mountains m ON ((m.id = validated.mountain_id)));


--
-- Name: operator_route_coverage; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_route_coverage WITH (security_invoker='true') AS
 WITH edge_stats AS (
         SELECT trail_edges.route_id,
                CASE
                    WHEN bool_or((trail_edges.status = 'recommended'::text)) THEN 'recommended'::text
                    WHEN bool_or((trail_edges.status = 'reference'::text)) THEN 'reference'::text
                    ELSE 'none'::text
                END AS edge_state,
            max(trail_edges.confidence) AS confidence,
            (COALESCE(sum(trail_edges.session_count), (0)::bigint))::integer AS session_count,
            max(trail_edges.updated_at) AS updated_at
           FROM public.trail_edges
          WHERE ((trail_edges.route_id IS NOT NULL) AND (trail_edges.status <> 'retired'::text))
          GROUP BY trail_edges.route_id
        ), latest_trails AS (
         SELECT DISTINCT ON (canonical_trails.route_id) canonical_trails.route_id,
            canonical_trails.confidence_level,
            canonical_trails.confidence,
            canonical_trails.version,
            canonical_trails.session_count,
            canonical_trails.branch_ambiguity_score,
            canonical_trails.gps_quality_score,
            canonical_trails.updated_at
           FROM public.canonical_trails
          ORDER BY canonical_trails.route_id, canonical_trails.version DESC
        )
 SELECT r.id AS route_id,
    r.mountain_id,
    m.display_name AS mountain_display_name,
    r.display_name AS route_display_name,
    COALESCE(edge_stats.edge_state, latest_trails.confidence_level, 'none'::text) AS route_state,
    COALESCE(edge_stats.confidence, latest_trails.confidence) AS confidence,
    latest_trails.version,
    COALESCE(edge_stats.session_count, latest_trails.session_count, 0) AS session_count,
    latest_trails.branch_ambiguity_score,
    latest_trails.gps_quality_score,
    COALESCE(edge_stats.updated_at, latest_trails.updated_at) AS updated_at
   FROM (((public.routes r
     JOIN public.mountains m ON ((m.id = r.mountain_id)))
     LEFT JOIN edge_stats ON ((edge_stats.route_id = r.id)))
     LEFT JOIN latest_trails ON ((latest_trails.route_id = r.id)))
UNION ALL
 SELECT NULL::text AS route_id,
    m.id AS mountain_id,
    m.display_name AS mountain_display_name,
    NULL::text AS route_display_name,
    'none'::text AS route_state,
    NULL::double precision AS confidence,
    NULL::integer AS version,
    0 AS session_count,
    NULL::double precision AS branch_ambiguity_score,
    NULL::double precision AS gps_quality_score,
    NULL::timestamp with time zone AS updated_at
   FROM public.mountains m
  WHERE (NOT (EXISTS ( SELECT 1
           FROM public.routes r2
          WHERE (r2.mountain_id = m.id))))
  ORDER BY 2, 1;


--
-- Name: operator_route_quality_detail; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_route_quality_detail WITH (security_invoker='true') AS
 SELECT coverage.route_id,
    coverage.mountain_id,
    coverage.mountain_display_name,
    coverage.route_display_name,
    coverage.route_state,
    coverage.confidence,
    coverage.version,
    coverage.session_count,
    coverage.branch_ambiguity_score,
    coverage.gps_quality_score,
    COALESCE(inputs.accepted_point_count, 0) AS accepted_point_count,
    COALESCE(inputs.rejected_point_count, 0) AS rejected_point_count,
    inputs.latest_evidence_at,
    coverage.updated_at
   FROM (public.operator_route_coverage coverage
     LEFT JOIN LATERAL public.route_quality_inputs(coverage.route_id) inputs(accepted_point_count, rejected_point_count, latest_evidence_at) ON ((coverage.route_id IS NOT NULL)));


--
-- Name: operator_quality_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_quality_summary WITH (security_invoker='true') AS
 SELECT ( SELECT
                CASE
                    WHEN (count(*) FILTER (WHERE (hiking_sessions.status = ANY (ARRAY['ingested'::text, 'complete'::text, 'accepted'::text, 'rejected'::text]))) = 0) THEN NULL::double precision
                    ELSE ((count(*) FILTER (WHERE (hiking_sessions.status = ANY (ARRAY['ingested'::text, 'complete'::text, 'accepted'::text]))))::double precision / (count(*) FILTER (WHERE (hiking_sessions.status = ANY (ARRAY['ingested'::text, 'complete'::text, 'accepted'::text, 'rejected'::text]))))::double precision)
                END AS upload_success_rate
           FROM public.hiking_sessions) AS upload_success_rate,
    ( SELECT (count(*))::integer AS count
           FROM public.hiking_sessions
          WHERE (hiking_sessions.status = ANY (ARRAY['queued'::text, 'ingesting'::text]))) AS queued_uploads,
    ( SELECT
                CASE
                    WHEN (count(*) = 0) THEN NULL::double precision
                    ELSE ((count(*) FILTER (WHERE (COALESCE(operator_route_coverage.route_state, 'none'::text) <> 'none'::text)))::double precision / (count(*))::double precision)
                END AS route_coverage
           FROM public.operator_route_coverage
          WHERE (operator_route_coverage.route_id IS NOT NULL)) AS route_coverage,
    ( SELECT (count(*))::integer AS count
           FROM public.mvp_events
          WHERE (mvp_events.event_name = 'snap_requested'::text)) AS snap_requests,
    ( SELECT (count(*))::integer AS count
           FROM public.mvp_events
          WHERE (mvp_events.event_name = 'trail_served'::text)) AS trail_served;


--
-- Name: session_edge_attributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_edge_attributions (
    session_id uuid NOT NULL,
    mountain_id text NOT NULL,
    interval_index integer NOT NULL,
    target_kind text NOT NULL,
    edge_id uuid,
    candidate_edge_id uuid,
    residual_kind text,
    direction text DEFAULT 'unknown'::text NOT NULL,
    session_start_measure_m double precision,
    session_end_measure_m double precision,
    edge_start_measure_m double precision,
    edge_end_measure_m double precision,
    attach_start_edge_id uuid,
    attach_start_measure_m double precision,
    attach_end_edge_id uuid,
    attach_end_measure_m double precision,
    point_count integer NOT NULL,
    matched_length_m double precision,
    avg_accuracy double precision,
    avg_altitude double precision,
    algorithm_version text DEFAULT 'trail-graph-v1'::text NOT NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_edge_attributions_direction_check CHECK ((direction = ANY (ARRAY['forward'::text, 'reverse'::text, 'unknown'::text]))),
    CONSTRAINT session_edge_attributions_target_check CHECK ((((target_kind = 'edge'::text) AND (edge_id IS NOT NULL) AND (candidate_edge_id IS NULL)) OR ((target_kind = 'candidate'::text) AND (edge_id IS NULL) AND (candidate_edge_id IS NOT NULL))))
);


--
-- Name: operator_session_edge_attribution; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_session_edge_attribution WITH (security_invoker='true') AS
 SELECT sea.session_id,
    sea.mountain_id,
    sea.interval_index,
    sea.target_kind,
    sea.edge_id,
    te.route_id,
    r.display_name AS route_display_name,
    sea.candidate_edge_id,
    sea.residual_kind,
    sea.direction,
    sea.session_start_measure_m,
    sea.session_end_measure_m,
    sea.edge_start_measure_m,
    sea.edge_end_measure_m,
    sea.attach_start_edge_id,
    sea.attach_start_measure_m,
    sea.attach_end_edge_id,
    sea.attach_end_measure_m,
    sea.point_count,
    sea.matched_length_m,
    sea.avg_accuracy,
    sea.avg_altitude,
    sea.algorithm_version,
    sea.matched_at,
    hs.raw_retention_state,
    hs.recomputable
   FROM (((public.session_edge_attributions sea
     LEFT JOIN public.trail_edges te ON ((te.id = sea.edge_id)))
     LEFT JOIN public.routes r ON ((r.id = te.route_id)))
     JOIN public.hiking_sessions hs ON ((hs.id = sea.session_id)));


--
-- Name: operator_session_ingestion; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_session_ingestion WITH (security_invoker='true') AS
 WITH edge_by_session AS (
         SELECT session_edge_attributions.session_id,
            (count(*) FILTER (WHERE (session_edge_attributions.target_kind = 'edge'::text)))::integer AS matched_edge_count,
            (COALESCE(sum(session_edge_attributions.point_count) FILTER (WHERE (session_edge_attributions.target_kind = 'edge'::text)), (0)::bigint))::integer AS matched_edge_point_count,
            (count(*) FILTER (WHERE (session_edge_attributions.target_kind = 'candidate'::text)))::integer AS candidate_edge_count,
            (COALESCE(sum(session_edge_attributions.point_count) FILTER (WHERE (session_edge_attributions.target_kind = 'candidate'::text)), (0)::bigint))::integer AS candidate_point_count,
            (count(*))::integer AS attribution_count
           FROM public.session_edge_attributions
          GROUP BY session_edge_attributions.session_id
        )
 SELECT hs.id AS session_id,
    hs.mountain_id,
    m.display_name AS mountain_display_name,
    hs.route_id,
    hs.status AS pipeline_state,
    hs.status AS upload_state,
    hs.upload_consent_version AS consent_version,
    hs.accepted_point_count,
    hs.rejected_point_count,
    NULL::text AS last_error,
    COALESCE(edge_by_session.matched_edge_count, 0) AS matched_route_count,
    COALESCE(edge_by_session.matched_edge_count, 0) AS matched_route_cell_count,
        CASE
            WHEN (COALESCE(edge_by_session.attribution_count, 0) > 0) THEN edge_by_session.matched_edge_point_count
            ELSE NULL::integer
        END AS matched_route_point_count,
    COALESCE(edge_by_session.candidate_edge_count, 0) AS candidate_cell_count,
        CASE
            WHEN (COALESCE(edge_by_session.attribution_count, 0) > 0) THEN edge_by_session.candidate_point_count
            ELSE NULL::integer
        END AS candidate_point_count,
        CASE
            WHEN (COALESCE(edge_by_session.attribution_count, 0) > 0) THEN 'exact'::text
            ELSE 'none'::text
        END AS attribution_precision,
    hs.processed_algorithm_version,
    hs.raw_retention_state,
    hs.recomputable,
    hs.started_at,
    hs.ended_at,
    hs.created_at
   FROM ((public.hiking_sessions hs
     JOIN public.mountains m ON ((m.id = hs.mountain_id)))
     LEFT JOIN edge_by_session ON ((edge_by_session.session_id = hs.id)));


--
-- Name: operator_session_route_attribution; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_session_route_attribution WITH (security_invoker='true') AS
 SELECT sea.session_id,
    te.route_id,
    COALESCE(r.display_name, 'Graph edge'::text) AS route_display_name,
    (count(*))::integer AS cell_count,
    (sum(sea.point_count))::integer AS point_count,
    0 AS transition_count,
    'trail_graph_interval'::text AS match_method,
    NULL::double precision AS frechet_distance,
    NULL::double precision AS overlap_ratio,
    NULL::double precision AS score_margin,
    'exact'::text AS attribution_precision
   FROM ((public.session_edge_attributions sea
     JOIN public.trail_edges te ON ((te.id = sea.edge_id)))
     LEFT JOIN public.routes r ON ((r.id = te.route_id)))
  WHERE (sea.target_kind = 'edge'::text)
  GROUP BY sea.session_id, te.route_id, r.display_name;


--
-- Name: trail_edge_segment_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trail_edge_segment_metrics (
    mountain_id text NOT NULL,
    target_kind text NOT NULL,
    target_id text NOT NULL,
    edge_id uuid,
    candidate_edge_id uuid,
    direction text NOT NULL,
    segment_index integer NOT NULL,
    start_measure_m double precision NOT NULL,
    end_measure_m double precision NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    duration_seconds_avg double precision,
    duration_seconds_sum double precision DEFAULT 0 NOT NULL,
    duration_observation_count integer DEFAULT 0 NOT NULL,
    speed_mps_avg double precision,
    elevation_gain_m double precision DEFAULT 0 NOT NULL,
    elevation_loss_m double precision DEFAULT 0 NOT NULL,
    abrupt_altitude_change_count integer DEFAULT 0 NOT NULL,
    max_abs_altitude_delta_m double precision,
    latest_evidence_at timestamp with time zone,
    algorithm_version text DEFAULT 'trail-graph-v1'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trail_edge_segment_metrics_target_check CHECK ((((target_kind = 'edge'::text) AND (edge_id IS NOT NULL) AND (candidate_edge_id IS NULL)) OR ((target_kind = 'candidate'::text) AND (edge_id IS NULL) AND (candidate_edge_id IS NOT NULL))))
);


--
-- Name: operator_trail_edge_segment_metrics; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_trail_edge_segment_metrics WITH (security_invoker='true') AS
 SELECT trail_edge_segment_metrics.mountain_id,
    trail_edge_segment_metrics.target_kind,
    trail_edge_segment_metrics.target_id,
    trail_edge_segment_metrics.edge_id,
    trail_edge_segment_metrics.candidate_edge_id,
    trail_edge_segment_metrics.direction,
    trail_edge_segment_metrics.segment_index,
    trail_edge_segment_metrics.start_measure_m,
    trail_edge_segment_metrics.end_measure_m,
    trail_edge_segment_metrics.session_count,
    trail_edge_segment_metrics.sample_count,
    trail_edge_segment_metrics.duration_seconds_avg,
    trail_edge_segment_metrics.duration_seconds_sum,
    trail_edge_segment_metrics.duration_observation_count,
    trail_edge_segment_metrics.speed_mps_avg,
    trail_edge_segment_metrics.elevation_gain_m,
    trail_edge_segment_metrics.elevation_loss_m,
    trail_edge_segment_metrics.abrupt_altitude_change_count,
    trail_edge_segment_metrics.max_abs_altitude_delta_m,
    trail_edge_segment_metrics.latest_evidence_at,
    trail_edge_segment_metrics.algorithm_version,
    trail_edge_segment_metrics.updated_at
   FROM public.trail_edge_segment_metrics;


--
-- Name: operator_trail_graph_quality; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_trail_graph_quality WITH (security_invoker='true') AS
 SELECT te.id AS edge_id,
    te.mountain_id,
    m.display_name AS mountain_display_name,
    te.route_id,
    r.display_name AS route_display_name,
    te.status,
    te.session_count,
    te.point_count,
    te.length_m,
    te.confidence,
    te.algorithm_version,
    te.updated_at
   FROM ((public.trail_edges te
     JOIN public.mountains m ON ((m.id = te.mountain_id)))
     LEFT JOIN public.routes r ON ((r.id = te.route_id)))
  WHERE (te.status <> 'retired'::text);


--
-- Name: trail_node_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trail_node_transitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mountain_id text NOT NULL,
    node_id uuid,
    from_edge_id uuid,
    to_edge_id uuid,
    direction text DEFAULT 'unknown'::text NOT NULL,
    session_count integer DEFAULT 0 NOT NULL,
    latest_seen_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: operator_trail_node_transitions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.operator_trail_node_transitions WITH (security_invoker='true') AS
 SELECT tnt.mountain_id,
    tnt.node_id,
    tnt.from_edge_id,
    tnt.to_edge_id,
    tnt.direction,
    tnt.session_count,
    tnt.latest_seen_at,
    tnt.updated_at
   FROM public.trail_node_transitions tnt;


--
-- Name: rejected_track_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rejected_track_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    reason text NOT NULL,
    recorded_at timestamp with time zone,
    lat double precision,
    lon double precision,
    altitude double precision,
    accuracy double precision,
    speed double precision,
    point_sequence_index integer,
    debug_payload_sample jsonb,
    debug_payload_expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: session_edge_metric_slices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_edge_metric_slices (
    session_id uuid NOT NULL,
    mountain_id text NOT NULL,
    interval_index integer NOT NULL,
    target_kind text NOT NULL,
    edge_id uuid,
    candidate_edge_id uuid,
    direction text NOT NULL,
    segment_index integer NOT NULL,
    start_measure_m double precision NOT NULL,
    end_measure_m double precision NOT NULL,
    sample_count integer DEFAULT 0 NOT NULL,
    duration_seconds double precision,
    duration_observation_count integer DEFAULT 0 NOT NULL,
    speed_distance_m double precision DEFAULT 0 NOT NULL,
    elevation_gain_m double precision DEFAULT 0 NOT NULL,
    elevation_loss_m double precision DEFAULT 0 NOT NULL,
    abrupt_altitude_change_count integer DEFAULT 0 NOT NULL,
    max_abs_altitude_delta_m double precision,
    latest_evidence_at timestamp with time zone,
    algorithm_version text DEFAULT 'trail-graph-v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT session_edge_metric_slices_target_check CHECK ((((target_kind = 'edge'::text) AND (edge_id IS NOT NULL) AND (candidate_edge_id IS NULL)) OR ((target_kind = 'candidate'::text) AND (edge_id IS NULL) AND (candidate_edge_id IS NOT NULL))))
);


--
-- Name: session_route_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_route_assignments (
    session_id uuid NOT NULL,
    route_id text NOT NULL,
    contributed_cell_count integer DEFAULT 0 NOT NULL,
    contributed_transition_count integer DEFAULT 0 NOT NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    match_method text DEFAULT 'exact_overlap'::text NOT NULL,
    frechet_distance double precision,
    overlap_ratio double precision,
    score_margin double precision,
    matched_point_count integer,
    matched_length_m double precision,
    residual_length_m double precision,
    CONSTRAINT session_route_assignments_match_method_check CHECK ((match_method = ANY (ARRAY['exact_overlap'::text, 'frechet_match'::text, 'candidate_residual'::text, 'trajectory_match'::text, 'trail_graph_interval'::text])))
);


--
-- Name: track_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.track_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    mountain_id text NOT NULL,
    recorded_at timestamp with time zone NOT NULL,
    geom extensions.geography(Point,4326) NOT NULL,
    altitude double precision,
    accuracy double precision,
    speed double precision,
    quality_score double precision,
    sequence_index integer NOT NULL
);


--
-- Name: trail_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trail_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mountain_id text NOT NULL,
    kind text DEFAULT 'synthetic'::text NOT NULL,
    geom extensions.geography(Point,4326) NOT NULL,
    support_count integer DEFAULT 0 NOT NULL,
    confidence double precision,
    algorithm_version text DEFAULT 'trail-graph-v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trail_nodes_kind_check CHECK ((kind = ANY (ARRAY['endpoint'::text, 'junction'::text, 'synthetic'::text])))
);


--
-- Name: unprocessed_ingested_sessions; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.unprocessed_ingested_sessions WITH (security_invoker='true') AS
 SELECT s.id,
    s.mountain_id,
    s.route_id,
    s.started_at,
    s.accepted_point_count
   FROM (public.hiking_sessions s
     LEFT JOIN public.session_route_assignments a ON ((a.session_id = s.id)))
  WHERE ((s.status = 'ingested'::text) AND (s.accepted_point_count > 0) AND (a.session_id IS NULL))
  ORDER BY s.started_at;


--
-- Name: candidate_edges candidate_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_edges
    ADD CONSTRAINT candidate_edges_pkey PRIMARY KEY (id);


--
-- Name: canonical_trails canonical_trails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_trails
    ADD CONSTRAINT canonical_trails_pkey PRIMARY KEY (id);


--
-- Name: canonical_trails canonical_trails_route_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_trails
    ADD CONSTRAINT canonical_trails_route_id_version_key UNIQUE (route_id, version);


--
-- Name: hiking_sessions hiking_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hiking_sessions
    ADD CONSTRAINT hiking_sessions_pkey PRIMARY KEY (id);


--
-- Name: hiking_sessions hiking_sessions_user_id_client_session_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hiking_sessions
    ADD CONSTRAINT hiking_sessions_user_id_client_session_key_key UNIQUE (user_id, client_session_key);


--
-- Name: mountains mountains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mountains
    ADD CONSTRAINT mountains_pkey PRIMARY KEY (id);


--
-- Name: mvp_events mvp_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mvp_events
    ADD CONSTRAINT mvp_events_pkey PRIMARY KEY (id);


--
-- Name: rejected_track_points rejected_track_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rejected_track_points
    ADD CONSTRAINT rejected_track_points_pkey PRIMARY KEY (id);


--
-- Name: routes routes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_pkey PRIMARY KEY (id);


--
-- Name: session_route_assignments session_route_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_route_assignments
    ADD CONSTRAINT session_route_assignments_pkey PRIMARY KEY (session_id, route_id);


--
-- Name: track_points track_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_points
    ADD CONSTRAINT track_points_pkey PRIMARY KEY (id);


--
-- Name: trail_edge_segment_metrics trail_edge_segment_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edge_segment_metrics
    ADD CONSTRAINT trail_edge_segment_metrics_pkey PRIMARY KEY (target_kind, target_id, direction, segment_index);


--
-- Name: trail_edges trail_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edges
    ADD CONSTRAINT trail_edges_pkey PRIMARY KEY (id);


--
-- Name: trail_node_transitions trail_node_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_node_transitions
    ADD CONSTRAINT trail_node_transitions_pkey PRIMARY KEY (id);


--
-- Name: trail_nodes trail_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_nodes
    ADD CONSTRAINT trail_nodes_pkey PRIMARY KEY (id);


--
-- Name: candidate_edges_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_edges_geom_idx ON public.candidate_edges USING gist (geom);


--
-- Name: candidate_edges_mountain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_edges_mountain_idx ON public.candidate_edges USING btree (mountain_id);


--
-- Name: candidate_edges_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX candidate_edges_status_idx ON public.candidate_edges USING btree (status);


--
-- Name: hiking_sessions_client_session_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hiking_sessions_client_session_key_idx ON public.hiking_sessions USING btree (user_id, client_session_key);


--
-- Name: rejected_track_points_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rejected_track_points_session_idx ON public.rejected_track_points USING btree (session_id);


--
-- Name: session_edge_attributions_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_edge_attributions_candidate_idx ON public.session_edge_attributions USING btree (candidate_edge_id);


--
-- Name: session_edge_attributions_edge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_edge_attributions_edge_idx ON public.session_edge_attributions USING btree (edge_id);


--
-- Name: session_edge_attributions_session_interval_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX session_edge_attributions_session_interval_key ON public.session_edge_attributions USING btree (session_id, interval_index);


--
-- Name: session_edge_metric_slices_candidate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_edge_metric_slices_candidate_idx ON public.session_edge_metric_slices USING btree (candidate_edge_id);


--
-- Name: session_edge_metric_slices_edge_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_edge_metric_slices_edge_idx ON public.session_edge_metric_slices USING btree (edge_id);


--
-- Name: session_route_assignments_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX session_route_assignments_route_idx ON public.session_route_assignments USING btree (route_id);


--
-- Name: track_points_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX track_points_geom_idx ON public.track_points USING gist (geom);


--
-- Name: track_points_session_sequence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX track_points_session_sequence_idx ON public.track_points USING btree (session_id, sequence_index);


--
-- Name: trail_edges_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trail_edges_geom_idx ON public.trail_edges USING gist (geom);


--
-- Name: trail_edges_mountain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trail_edges_mountain_idx ON public.trail_edges USING btree (mountain_id);


--
-- Name: trail_edges_route_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trail_edges_route_idx ON public.trail_edges USING btree (route_id);


--
-- Name: trail_node_transitions_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trail_node_transitions_key ON public.trail_node_transitions USING btree (mountain_id, COALESCE(node_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(from_edge_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(to_edge_id, '00000000-0000-0000-0000-000000000000'::uuid), direction);


--
-- Name: trail_nodes_geom_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trail_nodes_geom_idx ON public.trail_nodes USING gist (geom);


--
-- Name: trail_nodes_mountain_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trail_nodes_mountain_idx ON public.trail_nodes USING btree (mountain_id);


--
-- Name: candidate_edges candidate_edges_attach_end_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_edges
    ADD CONSTRAINT candidate_edges_attach_end_edge_id_fkey FOREIGN KEY (attach_end_edge_id) REFERENCES public.trail_edges(id) ON DELETE SET NULL;


--
-- Name: candidate_edges candidate_edges_attach_end_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_edges
    ADD CONSTRAINT candidate_edges_attach_end_node_id_fkey FOREIGN KEY (attach_end_node_id) REFERENCES public.trail_nodes(id) ON DELETE SET NULL;


--
-- Name: candidate_edges candidate_edges_attach_start_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_edges
    ADD CONSTRAINT candidate_edges_attach_start_edge_id_fkey FOREIGN KEY (attach_start_edge_id) REFERENCES public.trail_edges(id) ON DELETE SET NULL;


--
-- Name: candidate_edges candidate_edges_attach_start_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_edges
    ADD CONSTRAINT candidate_edges_attach_start_node_id_fkey FOREIGN KEY (attach_start_node_id) REFERENCES public.trail_nodes(id) ON DELETE SET NULL;


--
-- Name: candidate_edges candidate_edges_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidate_edges
    ADD CONSTRAINT candidate_edges_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id) ON DELETE CASCADE;


--
-- Name: canonical_trails canonical_trails_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_trails
    ADD CONSTRAINT canonical_trails_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id);


--
-- Name: hiking_sessions hiking_sessions_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hiking_sessions
    ADD CONSTRAINT hiking_sessions_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id);


--
-- Name: hiking_sessions hiking_sessions_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hiking_sessions
    ADD CONSTRAINT hiking_sessions_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id);


--
-- Name: rejected_track_points rejected_track_points_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rejected_track_points
    ADD CONSTRAINT rejected_track_points_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.hiking_sessions(id);


--
-- Name: routes routes_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routes
    ADD CONSTRAINT routes_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id);


--
-- Name: session_edge_attributions session_edge_attributions_attach_end_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_attributions
    ADD CONSTRAINT session_edge_attributions_attach_end_edge_id_fkey FOREIGN KEY (attach_end_edge_id) REFERENCES public.trail_edges(id) ON DELETE SET NULL;


--
-- Name: session_edge_attributions session_edge_attributions_attach_start_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_attributions
    ADD CONSTRAINT session_edge_attributions_attach_start_edge_id_fkey FOREIGN KEY (attach_start_edge_id) REFERENCES public.trail_edges(id) ON DELETE SET NULL;


--
-- Name: session_edge_attributions session_edge_attributions_candidate_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_attributions
    ADD CONSTRAINT session_edge_attributions_candidate_edge_id_fkey FOREIGN KEY (candidate_edge_id) REFERENCES public.candidate_edges(id) ON DELETE CASCADE;


--
-- Name: session_edge_attributions session_edge_attributions_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_attributions
    ADD CONSTRAINT session_edge_attributions_edge_id_fkey FOREIGN KEY (edge_id) REFERENCES public.trail_edges(id) ON DELETE CASCADE;


--
-- Name: session_edge_attributions session_edge_attributions_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_attributions
    ADD CONSTRAINT session_edge_attributions_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id) ON DELETE CASCADE;


--
-- Name: session_edge_attributions session_edge_attributions_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_attributions
    ADD CONSTRAINT session_edge_attributions_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.hiking_sessions(id) ON DELETE CASCADE;


--
-- Name: session_edge_metric_slices session_edge_metric_slices_candidate_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_metric_slices
    ADD CONSTRAINT session_edge_metric_slices_candidate_edge_id_fkey FOREIGN KEY (candidate_edge_id) REFERENCES public.candidate_edges(id) ON DELETE CASCADE;


--
-- Name: session_edge_metric_slices session_edge_metric_slices_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_metric_slices
    ADD CONSTRAINT session_edge_metric_slices_edge_id_fkey FOREIGN KEY (edge_id) REFERENCES public.trail_edges(id) ON DELETE CASCADE;


--
-- Name: session_edge_metric_slices session_edge_metric_slices_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_metric_slices
    ADD CONSTRAINT session_edge_metric_slices_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id) ON DELETE CASCADE;


--
-- Name: session_edge_metric_slices session_edge_metric_slices_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_edge_metric_slices
    ADD CONSTRAINT session_edge_metric_slices_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.hiking_sessions(id) ON DELETE CASCADE;


--
-- Name: session_route_assignments session_route_assignments_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_route_assignments
    ADD CONSTRAINT session_route_assignments_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE CASCADE;


--
-- Name: session_route_assignments session_route_assignments_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_route_assignments
    ADD CONSTRAINT session_route_assignments_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.hiking_sessions(id) ON DELETE CASCADE;


--
-- Name: track_points track_points_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_points
    ADD CONSTRAINT track_points_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id);


--
-- Name: track_points track_points_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.track_points
    ADD CONSTRAINT track_points_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.hiking_sessions(id);


--
-- Name: trail_edge_segment_metrics trail_edge_segment_metrics_candidate_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edge_segment_metrics
    ADD CONSTRAINT trail_edge_segment_metrics_candidate_edge_id_fkey FOREIGN KEY (candidate_edge_id) REFERENCES public.candidate_edges(id) ON DELETE CASCADE;


--
-- Name: trail_edge_segment_metrics trail_edge_segment_metrics_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edge_segment_metrics
    ADD CONSTRAINT trail_edge_segment_metrics_edge_id_fkey FOREIGN KEY (edge_id) REFERENCES public.trail_edges(id) ON DELETE CASCADE;


--
-- Name: trail_edge_segment_metrics trail_edge_segment_metrics_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edge_segment_metrics
    ADD CONSTRAINT trail_edge_segment_metrics_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id) ON DELETE CASCADE;


--
-- Name: trail_edges trail_edges_from_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edges
    ADD CONSTRAINT trail_edges_from_node_id_fkey FOREIGN KEY (from_node_id) REFERENCES public.trail_nodes(id) ON DELETE SET NULL;


--
-- Name: trail_edges trail_edges_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edges
    ADD CONSTRAINT trail_edges_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id) ON DELETE CASCADE;


--
-- Name: trail_edges trail_edges_route_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edges
    ADD CONSTRAINT trail_edges_route_id_fkey FOREIGN KEY (route_id) REFERENCES public.routes(id) ON DELETE SET NULL;


--
-- Name: trail_edges trail_edges_to_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_edges
    ADD CONSTRAINT trail_edges_to_node_id_fkey FOREIGN KEY (to_node_id) REFERENCES public.trail_nodes(id) ON DELETE SET NULL;


--
-- Name: trail_node_transitions trail_node_transitions_from_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_node_transitions
    ADD CONSTRAINT trail_node_transitions_from_edge_id_fkey FOREIGN KEY (from_edge_id) REFERENCES public.trail_edges(id) ON DELETE CASCADE;


--
-- Name: trail_node_transitions trail_node_transitions_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_node_transitions
    ADD CONSTRAINT trail_node_transitions_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id) ON DELETE CASCADE;


--
-- Name: trail_node_transitions trail_node_transitions_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_node_transitions
    ADD CONSTRAINT trail_node_transitions_node_id_fkey FOREIGN KEY (node_id) REFERENCES public.trail_nodes(id) ON DELETE CASCADE;


--
-- Name: trail_node_transitions trail_node_transitions_to_edge_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_node_transitions
    ADD CONSTRAINT trail_node_transitions_to_edge_id_fkey FOREIGN KEY (to_edge_id) REFERENCES public.trail_edges(id) ON DELETE CASCADE;


--
-- Name: trail_nodes trail_nodes_mountain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trail_nodes
    ADD CONSTRAINT trail_nodes_mountain_id_fkey FOREIGN KEY (mountain_id) REFERENCES public.mountains(id) ON DELETE CASCADE;


--
-- Name: track_points Block direct raw point reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block direct raw point reads" ON public.track_points FOR SELECT USING (false);


--
-- Name: rejected_track_points Block direct rejected point reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Block direct rejected point reads" ON public.rejected_track_points FOR SELECT USING (false);


--
-- Name: canonical_trails Users can read canonical trail summaries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read canonical trail summaries" ON public.canonical_trails FOR SELECT USING (true);


--
-- Name: mountains Users can read mountain catalog; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read mountain catalog" ON public.mountains FOR SELECT USING (true);


--
-- Name: hiking_sessions Users can read own session summaries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own session summaries" ON public.hiking_sessions FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: routes Users can read route catalog; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read route catalog" ON public.routes FOR SELECT USING (true);


--
-- Name: candidate_edges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidate_edges ENABLE ROW LEVEL SECURITY;

--
-- Name: canonical_trails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canonical_trails ENABLE ROW LEVEL SECURITY;

--
-- Name: hiking_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hiking_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: mountains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mountains ENABLE ROW LEVEL SECURITY;

--
-- Name: mvp_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mvp_events ENABLE ROW LEVEL SECURITY;

--
-- Name: rejected_track_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rejected_track_points ENABLE ROW LEVEL SECURITY;

--
-- Name: routes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.routes ENABLE ROW LEVEL SECURITY;

--
-- Name: session_edge_attributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_edge_attributions ENABLE ROW LEVEL SECURITY;

--
-- Name: session_edge_metric_slices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_edge_metric_slices ENABLE ROW LEVEL SECURITY;

--
-- Name: session_route_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.session_route_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: track_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.track_points ENABLE ROW LEVEL SECURITY;

--
-- Name: trail_edge_segment_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trail_edge_segment_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: trail_edges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trail_edges ENABLE ROW LEVEL SECURITY;

--
-- Name: trail_node_transitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trail_node_transitions ENABLE ROW LEVEL SECURITY;

--
-- Name: trail_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trail_nodes ENABLE ROW LEVEL SECURITY;



-- Explicit runtime permissions. Browser clients use Edge Functions; direct
-- database access remains closed except to service_role.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
