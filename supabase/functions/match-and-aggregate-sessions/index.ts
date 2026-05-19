import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  buildTrajectorySegmentMetrics,
  matchTrajectoryToTrailGraph,
  mergeTrajectoryLines,
  refineSessionTrajectory,
  sliceTrajectoryPath,
  trajectorySupportMatch,
  trajectoryLengthMeters,
  trajectoryLineWkt,
  type RefinedTrajectory,
  type RoutePoint,
  type TrailGraphInterval,
  type TrailGraphMatchedInterval,
  type TrailGraphResidualInterval,
  type TrajectoryPoint,
  type TrajectorySegmentMetric,
} from '../_shared/route_inference.ts';

const batchSize = 25;
const candidateFrechetThresholdMeters = 45;
const candidateOverlapThreshold = 0.45;
const attachMeasureThresholdMeters = 35;
const attachEndpointThresholdMeters = 60;
const algorithmVersion = 'trail-graph-v1';

type SupabaseClient = any;

type StoredTrailEdge = {
  id: string;
  mountainId: string;
  routeId: string | null;
  path: TrajectoryPoint[];
  lengthMeters: number | null;
  sessionCount: number;
  pointCount: number;
  confidence: number | null;
  status: string;
};

type StoredCandidateEdge = {
  id: string;
  mountainId: string;
  path: TrajectoryPoint[];
  attachStartEdgeId: string | null;
  attachStartMeasureMeters: number | null;
  attachEndEdgeId: string | null;
  attachEndMeasureMeters: number | null;
  residualKind: TrailGraphResidualInterval['residualKind'];
  pointCount: number;
  sessionCount: number;
  confidence: number | null;
  lengthMeters: number | null;
};

type CandidateSaveResult = {
  id: string;
  referencePath: TrajectoryPoint[];
  created: boolean;
};

type CandidateRepresentativeMerge = {
  path: TrajectoryPoint[];
  source: 'existing' | 'incoming' | 'merged';
};

type CandidateAttach = {
  attachStartEdgeId: string | null;
  attachStartMeasureMeters: number | null;
  attachEndEdgeId: string | null;
  attachEndMeasureMeters: number | null;
  residualKind: TrailGraphResidualInterval['residualKind'];
};

type SessionEdgeAttributionRow = {
  mountainId: string;
  intervalIndex: number;
  targetKind: 'edge' | 'candidate';
  edgeId: string | null;
  candidateEdgeId: string | null;
  residualKind: string | null;
  direction: 'forward' | 'reverse' | 'unknown';
  sessionStartMeasureMeters: number | null;
  sessionEndMeasureMeters: number | null;
  edgeStartMeasureMeters: number | null;
  edgeEndMeasureMeters: number | null;
  attachStartEdgeId: string | null;
  attachStartMeasureMeters: number | null;
  attachEndEdgeId: string | null;
  attachEndMeasureMeters: number | null;
  pointCount: number;
  matchedLengthMeters: number | null;
  avgAccuracy: number | null;
  avgAltitude: number | null;
  algorithmVersion: string;
};

type MetricSliceRow = {
  mountainId: string;
  intervalIndex: number;
  targetKind: 'edge' | 'candidate';
  edgeId: string | null;
  candidateEdgeId: string | null;
  direction: 'forward' | 'reverse';
  segmentIndex: number;
  startMeasureMeters: number;
  endMeasureMeters: number;
  sampleCount: number;
  durationSeconds: number | null;
  durationObservationCount: number;
  speedDistanceMeters: number;
  elevationGainMeters: number;
  elevationLossMeters: number;
  abruptAltitudeChangeCount: number;
  maxAbsAltitudeDeltaMeters: number | null;
  latestEvidenceAt: string | null;
  algorithmVersion: string;
};

type ProcessSessionResult = {
  affectedRouteIds: string[];
  candidatePointsAdded: number;
  candidateEdgesFormed: number;
  purgedTrackPointCount: number;
  purgedRejectedPointCount: number;
  error?: string;
};

type RawPurgeResult = {
  trackPointCount: number;
  rejectedPointCount: number;
  error?: string;
};

export async function handleMatchAndAggregateSessions(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: sessions, error: sessionsError } = await supabase
    .from('unprocessed_ingested_sessions')
    .select('id, mountain_id, route_id, accepted_point_count')
    .limit(batchSize);

  if (sessionsError) {
    return jsonResponse({ success: false, errors: [sessionsError.message] }, 500);
  }

  if (!sessions || sessions.length === 0) {
    return jsonResponse(emptyBatchResult());
  }

  const affectedRouteIds = new Set<string>();
  let candidatePointsAdded = 0;
  let candidateEdgesFormed = 0;
  let processedCount = 0;
  let purgedTrackPointCount = 0;
  let purgedRejectedPointCount = 0;

  for (const session of sessions) {
    const result = await processSession(
      supabase,
      session.id,
      session.mountain_id,
      session.route_id ?? null,
    );
    if (result.error) {
      console.error(`Session ${session.id} failed: ${result.error}`);
      continue;
    }

    for (const routeId of result.affectedRouteIds) affectedRouteIds.add(routeId);
    candidatePointsAdded += result.candidatePointsAdded;
    candidateEdgesFormed += result.candidateEdgesFormed;
    purgedTrackPointCount += result.purgedTrackPointCount;
    purgedRejectedPointCount += result.purgedRejectedPointCount;
    processedCount += 1;
  }

  return jsonResponse({
    success: true,
    processedSessions: processedCount,
    affectedRoutes: affectedRouteIds.size,
    candidatePointsAdded,
    candidateEdgesFormed,
    candidateClustersFormed: candidateEdgesFormed,
    purgedTrackPointCount,
    purgedRejectedPointCount,
  });
}

async function processSession(
  supabase: SupabaseClient,
  sessionId: string,
  mountainId: string,
  seedRouteId: string | null,
): Promise<ProcessSessionResult> {
  const points = await fetchSessionPoints(supabase, sessionId);
  if (points.length === 0) {
    await markSessionProcessed(supabase, sessionId);
    return resultAfterPurge(await purgeSessionRawPoints(supabase, sessionId));
  }

  const trajectory = refineSessionTrajectory(points);
  if (trajectory.points.length < 2) {
    await markSessionProcessed(supabase, sessionId);
    return resultAfterPurge(await purgeSessionRawPoints(supabase, sessionId));
  }

  const edges = await fetchTrailEdges(supabase, mountainId);
  const seededEdge = seedRouteId === null
    ? null
    : edges.find((edge) => edge.routeId === seedRouteId) ?? null;
  const shouldBootstrapSeedEdge = seedRouteId !== null && seededEdge === null;

  const attributionRows: SessionEdgeAttributionRow[] = [];
  const metricRows: MetricSliceRow[] = [];
  const affectedRouteIds = new Set<string>();
  let candidatePointsAdded = 0;
  let candidateEdgesFormed = 0;

  if (shouldBootstrapSeedEdge) {
    const edge = await createTrailEdgeFromTrajectory(supabase, mountainId, seedRouteId, trajectory);
    if (edge === null) return emptySessionResult('trail_edge_bootstrap_failed');

    attributionRows.push(edgeAttributionRow(mountainId, 0, edge.id, wholeMatchedInterval(edge.id, trajectory), trajectory));
    metricRows.push(...metricSliceRows(mountainId, 0, 'edge', edge.id, null, trajectory, trajectory.points));
    await recordSessionAssignment(supabase, sessionId, seedRouteId, trajectory.pointCount, trajectory.lengthMeters, 0);
    affectedRouteIds.add(seedRouteId);
  } else {
    const matchResult = matchTrajectoryToTrailGraph(
      trajectory.points,
      edges.map((edge) => ({ id: edge.id, path: edge.path, status: edge.status })),
    );
    const intervals = matchResult.intervals.length > 0
      ? matchResult.intervals
      : fallbackCandidateIntervals(trajectory);

    for (let index = 0; index < intervals.length; index += 1) {
      const interval = intervals[index];
      const intervalPath = sliceTrajectoryPath(trajectory.points, interval.sessionStartIndex, interval.sessionEndIndex);
      if (intervalPath.length < 2) continue;

      if (interval.kind === 'matched_edge') {
        const edge = edges.find((item) => item.id === interval.edgeId);
        if (!edge) continue;

        const updatedEdge = await appendTrailEdgeEvidence(supabase, edge, intervalPath, trajectory);
        if (updatedEdge.error) return emptySessionResult(updatedEdge.error);
        attributionRows.push(edgeAttributionRow(mountainId, index, edge.id, interval, trajectory));
        metricRows.push(...metricSliceRows(mountainId, index, 'edge', edge.id, null, trajectoryFromPath(intervalPath, trajectory), edge.path));
        if (edge.routeId !== null) {
          affectedRouteIds.add(edge.routeId);
          await recordSessionAssignment(
            supabase,
            sessionId,
            edge.routeId,
            interval.pointCount,
            interval.lengthMeters,
            0,
          );
        }
      } else {
        const candidateSave = await saveCandidateEdge(supabase, mountainId, sessionId, interval, intervalPath, trajectory, edges);
        if (candidateSave === null) return emptySessionResult('candidate_edge_save_failed');
        candidatePointsAdded += interval.pointCount;
        if (candidateSave.created) candidateEdgesFormed += 1;
        attributionRows.push(candidateAttributionRow(mountainId, index, candidateSave.id, interval, trajectory));
        metricRows.push(...metricSliceRows(
          mountainId,
          index,
          'candidate',
          null,
          candidateSave.id,
          trajectoryFromPath(intervalPath, trajectory),
          candidateSave.referencePath,
        ));
      }
    }
  }

  const attributionError = await saveSessionEdgeAttributions(supabase, sessionId, attributionRows);
  if (attributionError) return emptySessionResult(attributionError);

  const metricError = await saveSessionMetricSlices(supabase, sessionId, metricRows);
  if (metricError) return emptySessionResult(metricError);

  const { error: rebuildError } = await supabase.rpc('rebuild_trail_edge_segment_metrics');
  if (rebuildError) return emptySessionResult(rebuildError.message);

  await markSessionProcessed(supabase, sessionId);
  const purgeResult = await purgeSessionRawPoints(supabase, sessionId);
  if (purgeResult.error) return emptySessionResult(purgeResult.error);

  return {
    affectedRouteIds: [...affectedRouteIds],
    candidatePointsAdded,
    candidateEdgesFormed,
    purgedTrackPointCount: purgeResult.trackPointCount,
    purgedRejectedPointCount: purgeResult.rejectedPointCount,
  };
}

async function fetchSessionPoints(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<RoutePoint[]> {
  const { data, error } = await supabase.rpc('session_track_points', {
    p_session_id: sessionId,
  });
  if (error || !data) return [];
  return (data as any[])
    .map((row) => ({
      sessionId: row.session_id,
      recordedAt: row.recorded_at,
      lat: Number(row.lat),
      lon: Number(row.lon),
      accuracy: row.accuracy ?? null,
      altitude: row.altitude ?? null,
      sequenceIndex: row.sequence_index,
    }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
}

async function fetchTrailEdges(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<StoredTrailEdge[]> {
  const { data, error } = await supabase.rpc('trail_edges_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];

  return (data as any[])
    .map((row) => ({
      id: row.id,
      mountainId: row.mountain_id,
      routeId: row.route_id ?? null,
      path: parseGeoJsonLine(row.trail_geojson),
      lengthMeters: row.length_m ?? null,
      sessionCount: row.session_count ?? 0,
      pointCount: row.point_count ?? 0,
      confidence: row.confidence ?? null,
      status: row.status ?? 'reference',
    }))
    .filter((edge) => edge.path.length >= 2);
}

async function fetchCandidateEdges(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<StoredCandidateEdge[]> {
  const { data, error } = await supabase.rpc('candidate_edges_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];

  return (data as any[])
    .map((row) => ({
      id: row.id,
      mountainId: row.mountain_id,
      path: parseGeoJsonLine(row.trail_geojson),
      attachStartEdgeId: row.attach_start_edge_id ?? null,
      attachStartMeasureMeters: row.attach_start_measure_m ?? null,
      attachEndEdgeId: row.attach_end_edge_id ?? null,
      attachEndMeasureMeters: row.attach_end_measure_m ?? null,
      residualKind: row.residual_kind,
      pointCount: row.point_count ?? 0,
      sessionCount: row.session_count ?? 0,
      confidence: row.confidence ?? null,
      lengthMeters: row.length_m ?? null,
    }))
    .filter((candidate) => candidate.path.length >= 2);
}

async function createTrailEdgeFromTrajectory(
  supabase: SupabaseClient,
  mountainId: string,
  routeId: string,
  trajectory: RefinedTrajectory,
): Promise<StoredTrailEdge | null> {
  const fromNodeId = await createTrailNode(supabase, mountainId, 'endpoint', trajectory.points[0]);
  const toNodeId = await createTrailNode(supabase, mountainId, 'endpoint', trajectory.points[trajectory.points.length - 1]);
  const confidence = routeConfidence(1, qualityScore(trajectory.avgAccuracy));
  const { data, error } = await supabase
    .from('trail_edges')
    .insert({
      mountain_id: mountainId,
      route_id: routeId,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      geom: trajectoryLineWkt(trajectory),
      length_m: trajectory.lengthMeters,
      session_count: 1,
      point_count: trajectory.pointCount,
      confidence,
      status: confidence >= 0.70 ? 'recommended' : 'reference',
      algorithm_version: algorithmVersion,
    })
    .select('id')
    .single();
  if (error || !data) return null;

  await insertCanonicalTrail(supabase, routeId, trajectory.points, 1, confidence, trajectory.avgAccuracy);

  return {
    id: data.id,
    mountainId,
    routeId,
    path: trajectory.points,
    lengthMeters: trajectory.lengthMeters,
    sessionCount: 1,
    pointCount: trajectory.pointCount,
    confidence,
    status: confidence >= 0.70 ? 'recommended' : 'reference',
  };
}

async function appendTrailEdgeEvidence(
  supabase: SupabaseClient,
  edge: StoredTrailEdge,
  incomingPath: TrajectoryPoint[],
  trajectory: RefinedTrajectory,
): Promise<{ error: string | null }> {
  const sessionCount = edge.sessionCount + 1;
  const pointCount = edge.pointCount + incomingPath.length;
  const merged = mergeTrajectoryLines(edge.path, incomingPath, Math.max(1, edge.sessionCount), 1);
  const confidence = routeConfidence(sessionCount, qualityScore(trajectory.avgAccuracy));
  const status = confidence >= 0.70 && sessionCount >= 5 ? 'recommended' : 'reference';
  const { error } = await supabase
    .from('trail_edges')
    .update({
      geom: trajectoryLineWkt(merged),
      length_m: trajectoryLengthMeters(merged),
      session_count: sessionCount,
      point_count: pointCount,
      confidence,
      status,
      algorithm_version: algorithmVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('id', edge.id);
  if (error) return { error: error.message };

  if (edge.routeId !== null) {
    await insertCanonicalTrail(supabase, edge.routeId, merged, sessionCount, confidence, trajectory.avgAccuracy);
  }

  return { error: null };
}

async function saveCandidateEdge(
  supabase: SupabaseClient,
  mountainId: string,
  sessionId: string,
  interval: TrailGraphResidualInterval,
  path: TrajectoryPoint[],
  trajectory: RefinedTrajectory,
  edges: StoredTrailEdge[],
): Promise<CandidateSaveResult | null> {
  const anchoredPath = anchorCandidatePath(path, interval, edges);
  const incomingValidationFailure = candidateAttachValidationFailure(path, interval, edges);
  const candidates = await fetchCandidateEdges(supabase, mountainId);
  const scored = candidates
    .map((candidate) => ({
      candidate,
      support: candidateSupportScore(candidate, interval, anchoredPath),
    }))
    .filter((item) => item.support.isSupported)
    .sort((left, right) => left.support.score - right.support.score);

  const best = scored[0] ?? null;
  if (best) {
    const merged = mergeCandidateRepresentativePath(best.candidate, anchoredPath, best.support.supportKind);
    const storedAttach = candidateAttachForMerge(best.candidate, interval, merged.source);
    const representativePath = anchorPathToStoredAttach(merged.path, storedAttach, edges);
    const sessionCount = best.candidate.sessionCount + 1;
    const pointCount = best.candidate.pointCount + interval.pointCount;
    const confidence = routeConfidence(sessionCount, qualityScore(trajectory.avgAccuracy));
    const lengthMeters = trajectoryLengthMeters(representativePath);
    const validationFailureReason = incomingValidationFailure ??
      candidateRepresentativeValidationFailure(representativePath, storedAttach, edges);
    const { error } = await supabase
      .from('candidate_edges')
      .update({
        geom: trajectoryLineWkt(representativePath),
        ...(merged.source === 'incoming'
          ? {
            attach_start_edge_id: interval.attachStartEdgeId,
            attach_start_measure_m: interval.attachStartMeasureMeters,
            attach_end_edge_id: interval.attachEndEdgeId,
            attach_end_measure_m: interval.attachEndMeasureMeters,
            residual_kind: interval.residualKind,
          }
          : {}),
        point_count: pointCount,
        session_count: sessionCount,
        contributing_sessions: await appendCandidateSession(supabase, best.candidate.id, sessionId),
        avg_accuracy: trajectory.avgAccuracy,
        avg_altitude: trajectory.avgAltitude,
        length_m: lengthMeters,
        confidence,
        confidence_level: confidence >= 0.70 && sessionCount >= 3 && lengthMeters >= 80
          ? 'recommended'
          : 'reference',
        validation_failure_reason: validationFailureReason,
        latest_evidence_at: trajectory.latestEvidenceAt,
        algorithm_version: algorithmVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', best.candidate.id);
    return error ? null : {
      id: best.candidate.id,
      referencePath: representativePath,
      created: false,
    };
  }

  const confidence = routeConfidence(1, qualityScore(trajectory.avgAccuracy));
  const validationFailureReason = incomingValidationFailure ??
    candidateRepresentativeValidationFailure(anchoredPath, interval, edges);
  const { data, error } = await supabase
    .from('candidate_edges')
    .insert({
      mountain_id: mountainId,
      geom: trajectoryLineWkt(anchoredPath),
      attach_start_edge_id: interval.attachStartEdgeId,
      attach_start_measure_m: interval.attachStartMeasureMeters,
      attach_end_edge_id: interval.attachEndEdgeId,
      attach_end_measure_m: interval.attachEndMeasureMeters,
      residual_kind: interval.residualKind,
      point_count: interval.pointCount,
      session_count: 1,
      contributing_sessions: [sessionId],
      avg_accuracy: trajectory.avgAccuracy,
      avg_altitude: trajectory.avgAltitude,
      length_m: trajectoryLengthMeters(anchoredPath),
      confidence,
      confidence_level: 'reference',
      attach_repeatability: interval.attachStartEdgeId || interval.attachEndEdgeId ? 1 : null,
      validation_failure_reason: validationFailureReason,
      latest_evidence_at: trajectory.latestEvidenceAt,
      algorithm_version: algorithmVersion,
    })
    .select('id')
    .single();
  return error || !data ? null : {
    id: data.id,
    referencePath: anchoredPath,
    created: true,
  };
}

async function appendCandidateSession(
  supabase: SupabaseClient,
  candidateId: string,
  sessionId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from('candidate_edges')
    .select('contributing_sessions')
    .eq('id', candidateId)
    .maybeSingle();
  const current = Array.isArray(data?.contributing_sessions) ? data.contributing_sessions : [];
  return current.includes(sessionId) ? current : [...current, sessionId];
}

async function createTrailNode(
  supabase: SupabaseClient,
  mountainId: string,
  kind: 'endpoint' | 'junction' | 'synthetic',
  point: TrajectoryPoint,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('trail_nodes')
    .insert({
      mountain_id: mountainId,
      kind,
      geom: `POINT(${point.lon} ${point.lat})`,
      support_count: 1,
      confidence: 0.75,
      algorithm_version: algorithmVersion,
    })
    .select('id')
    .single();
  return error || !data ? null : data.id;
}

async function insertCanonicalTrail(
  supabase: SupabaseClient,
  routeId: string,
  path: TrajectoryPoint[],
  sessionCount: number,
  confidence: number,
  avgAccuracy: number | null,
): Promise<void> {
  const { data } = await supabase
    .from('canonical_trails')
    .select('version')
    .eq('route_id', routeId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  await supabase.from('canonical_trails').insert({
    route_id: routeId,
    version: (data?.version ?? 0) + 1,
    geom: trajectoryLineWkt(path),
    confidence,
    confidence_level: confidence >= 0.70 && sessionCount >= 5 ? 'recommended' : 'reference',
    session_count: sessionCount,
    branch_ambiguity_score: 0,
    gps_quality_score: qualityScore(avgAccuracy),
    algorithm_version: algorithmVersion,
    source_kind: 'trail_graph_edge',
  });
}

async function saveSessionEdgeAttributions(
  supabase: SupabaseClient,
  sessionId: string,
  rows: SessionEdgeAttributionRow[],
): Promise<string | null> {
  const { error } = await supabase.rpc('replace_session_edge_attributions', {
    p_session_id: sessionId,
    p_rows: rows,
  });
  return error ? error.message : null;
}

async function saveSessionMetricSlices(
  supabase: SupabaseClient,
  sessionId: string,
  rows: MetricSliceRow[],
): Promise<string | null> {
  const { error } = await supabase.rpc('replace_session_edge_metric_slices', {
    p_session_id: sessionId,
    p_rows: rows,
  });
  return error ? error.message : null;
}

async function recordSessionAssignment(
  supabase: SupabaseClient,
  sessionId: string,
  routeId: string,
  matchedPointCount: number,
  matchedLengthMeters: number,
  residualLengthMeters: number,
): Promise<void> {
  await supabase.from('session_route_assignments').upsert(
    {
      session_id: sessionId,
      route_id: routeId,
      contributed_cell_count: matchedPointCount,
      contributed_transition_count: 0,
      match_method: 'trail_graph_interval',
      matched_point_count: matchedPointCount,
      matched_length_m: matchedLengthMeters,
      residual_length_m: residualLengthMeters,
    },
    { onConflict: 'session_id,route_id' },
  );
}

async function markSessionProcessed(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await supabase
    .from('hiking_sessions')
    .update({
      status: 'complete',
      processed_algorithm_version: algorithmVersion,
    })
    .eq('id', sessionId);
}

async function purgeSessionRawPoints(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<RawPurgeResult> {
  const { data, error } = await supabase.rpc('purge_session_raw_points', {
    p_session_id: sessionId,
  });
  if (error) {
    return { trackPointCount: 0, rejectedPointCount: 0, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    trackPointCount: row?.deleted_track_point_count ?? 0,
    rejectedPointCount: row?.deleted_rejected_point_count ?? 0,
  };
}

function wholeMatchedInterval(edgeId: string, trajectory: RefinedTrajectory): TrailGraphMatchedInterval {
  return {
    kind: 'matched_edge',
    edgeId,
    sessionStartIndex: 0,
    sessionEndIndex: trajectory.points.length - 1,
    sessionStartMeasureMeters: 0,
    sessionEndMeasureMeters: trajectory.lengthMeters,
    edgeStartMeasureMeters: 0,
    edgeEndMeasureMeters: trajectory.lengthMeters,
    direction: 'forward',
    lengthMeters: trajectory.lengthMeters,
    pointCount: trajectory.points.length,
  };
}

function fallbackCandidateIntervals(trajectory: RefinedTrajectory): TrailGraphInterval[] {
  return [{
    kind: 'candidate_edge',
    sessionStartIndex: 0,
    sessionEndIndex: trajectory.points.length - 1,
    sessionStartMeasureMeters: 0,
    sessionEndMeasureMeters: trajectory.lengthMeters,
    attachStartEdgeId: null,
    attachStartMeasureMeters: null,
    attachEndEdgeId: null,
    attachEndMeasureMeters: null,
    residualKind: 'standalone',
    lengthMeters: trajectory.lengthMeters,
    pointCount: trajectory.points.length,
  }];
}

function edgeAttributionRow(
  mountainId: string,
  intervalIndex: number,
  edgeId: string,
  interval: TrailGraphMatchedInterval,
  trajectory: RefinedTrajectory,
): SessionEdgeAttributionRow {
  return {
    mountainId,
    intervalIndex,
    targetKind: 'edge',
    edgeId,
    candidateEdgeId: null,
    residualKind: null,
    direction: interval.direction,
    sessionStartMeasureMeters: interval.sessionStartMeasureMeters,
    sessionEndMeasureMeters: interval.sessionEndMeasureMeters,
    edgeStartMeasureMeters: interval.edgeStartMeasureMeters,
    edgeEndMeasureMeters: interval.edgeEndMeasureMeters,
    attachStartEdgeId: null,
    attachStartMeasureMeters: null,
    attachEndEdgeId: null,
    attachEndMeasureMeters: null,
    pointCount: interval.pointCount,
    matchedLengthMeters: interval.lengthMeters,
    avgAccuracy: trajectory.avgAccuracy,
    avgAltitude: trajectory.avgAltitude,
    algorithmVersion,
  };
}

function candidateAttributionRow(
  mountainId: string,
  intervalIndex: number,
  candidateEdgeId: string,
  interval: TrailGraphResidualInterval,
  trajectory: RefinedTrajectory,
): SessionEdgeAttributionRow {
  return {
    mountainId,
    intervalIndex,
    targetKind: 'candidate',
    edgeId: null,
    candidateEdgeId,
    residualKind: interval.residualKind,
    direction: 'unknown',
    sessionStartMeasureMeters: interval.sessionStartMeasureMeters,
    sessionEndMeasureMeters: interval.sessionEndMeasureMeters,
    edgeStartMeasureMeters: null,
    edgeEndMeasureMeters: null,
    attachStartEdgeId: interval.attachStartEdgeId,
    attachStartMeasureMeters: interval.attachStartMeasureMeters,
    attachEndEdgeId: interval.attachEndEdgeId,
    attachEndMeasureMeters: interval.attachEndMeasureMeters,
    pointCount: interval.pointCount,
    matchedLengthMeters: interval.lengthMeters,
    avgAccuracy: trajectory.avgAccuracy,
    avgAltitude: trajectory.avgAltitude,
    algorithmVersion,
  };
}

function metricSliceRows(
  mountainId: string,
  intervalIndex: number,
  targetKind: 'edge' | 'candidate',
  edgeId: string | null,
  candidateEdgeId: string | null,
  trajectory: RefinedTrajectory,
  referencePath: TrajectoryPoint[],
): MetricSliceRow[] {
  return buildTrajectorySegmentMetrics(trajectory, 100, referencePath).map((metric) =>
    metricSlicePayload(mountainId, intervalIndex, targetKind, edgeId, candidateEdgeId, metric)
  );
}

function metricSlicePayload(
  mountainId: string,
  intervalIndex: number,
  targetKind: 'edge' | 'candidate',
  edgeId: string | null,
  candidateEdgeId: string | null,
  metric: TrajectorySegmentMetric,
): MetricSliceRow {
  return {
    mountainId,
    intervalIndex,
    targetKind,
    edgeId,
    candidateEdgeId,
    direction: metric.direction,
    segmentIndex: metric.segmentIndex,
    startMeasureMeters: metric.startMeasureMeters,
    endMeasureMeters: metric.endMeasureMeters,
    sampleCount: metric.sampleCount,
    durationSeconds: metric.durationSeconds,
    durationObservationCount: metric.durationObservationCount,
    speedDistanceMeters: metric.speedMetersPerSecond !== null && metric.durationSeconds !== null
      ? metric.speedMetersPerSecond * metric.durationSeconds
      : metric.endMeasureMeters - metric.startMeasureMeters,
    elevationGainMeters: metric.elevationGainMeters,
    elevationLossMeters: metric.elevationLossMeters,
    abruptAltitudeChangeCount: metric.abruptAltitudeChangeCount,
    maxAbsAltitudeDeltaMeters: metric.maxAbsAltitudeDeltaMeters,
    latestEvidenceAt: metric.latestEvidenceAt,
    algorithmVersion,
  };
}

function trajectoryFromPath(path: TrajectoryPoint[], source: RefinedTrajectory): RefinedTrajectory {
  return {
    points: path,
    pointCount: path.length,
    avgAccuracy: source.avgAccuracy,
    avgAltitude: source.avgAltitude,
    latestEvidenceAt: source.latestEvidenceAt,
    lengthMeters: trajectoryLengthMeters(path),
  };
}

function compatibleAttach(candidate: StoredCandidateEdge, interval: TrailGraphResidualInterval): boolean {
  return attachCompatible(
    candidate.attachStartEdgeId,
    candidate.attachStartMeasureMeters,
    interval.attachStartEdgeId,
    interval.attachStartMeasureMeters,
  ) && attachCompatible(
    candidate.attachEndEdgeId,
    candidate.attachEndMeasureMeters,
    interval.attachEndEdgeId,
    interval.attachEndMeasureMeters,
  );
}

function attachCompatible(
  leftEdgeId: string | null,
  leftMeasure: number | null,
  rightEdgeId: string | null,
  rightMeasure: number | null,
): boolean {
  if (leftEdgeId === null && rightEdgeId === null) return true;
  if (leftEdgeId !== rightEdgeId) return false;
  if (leftMeasure === null || rightMeasure === null) return true;
  return Math.abs(leftMeasure - rightMeasure) <= attachMeasureThresholdMeters;
}

function candidateAttachForMerge(
  candidate: StoredCandidateEdge,
  interval: TrailGraphResidualInterval,
  source: CandidateRepresentativeMerge['source'],
): CandidateAttach {
  if (source === 'incoming') return interval;
  return {
    attachStartEdgeId: candidate.attachStartEdgeId,
    attachStartMeasureMeters: candidate.attachStartMeasureMeters,
    attachEndEdgeId: candidate.attachEndEdgeId,
    attachEndMeasureMeters: candidate.attachEndMeasureMeters,
    residualKind: candidate.residualKind,
  };
}

function anchorCandidatePath(
  path: TrajectoryPoint[],
  attach: CandidateAttach,
  edges: StoredTrailEdge[],
): TrajectoryPoint[] {
  return anchorPathToStoredAttach(path, attach, edges);
}

function anchorPathToStoredAttach(
  path: TrajectoryPoint[],
  attach: CandidateAttach,
  edges: StoredTrailEdge[],
): TrajectoryPoint[] {
  if (path.length < 2) return path;

  let anchored = [...path];
  const startAnchor = attachPoint(edges, attach.attachStartEdgeId, attach.attachStartMeasureMeters);
  const endAnchor = attachPoint(edges, attach.attachEndEdgeId, attach.attachEndMeasureMeters);

  if (startAnchor && distanceMeters(startAnchor, anchored[0]) > 1) {
    anchored = [startAnchor, ...anchored];
  }
  if (endAnchor && distanceMeters(endAnchor, anchored[anchored.length - 1]) > 1) {
    anchored = [...anchored, endAnchor];
  }

  return anchored;
}

function candidateAttachValidationFailure(
  path: TrajectoryPoint[],
  attach: CandidateAttach,
  edges: StoredTrailEdge[],
): string | null {
  if (path.length < 2) return 'candidate_geometry_too_short';

  const startAnchor = attachPoint(edges, attach.attachStartEdgeId, attach.attachStartMeasureMeters);
  if (startAnchor) {
    const gapMeters = distanceMeters(startAnchor, path[0]);
    if (gapMeters > attachEndpointThresholdMeters) {
      return `start_attach_gap_${Math.round(gapMeters)}m_exceeds_${attachEndpointThresholdMeters}m`;
    }
  }

  const endAnchor = attachPoint(edges, attach.attachEndEdgeId, attach.attachEndMeasureMeters);
  if (endAnchor) {
    const gapMeters = distanceMeters(endAnchor, path[path.length - 1]);
    if (gapMeters > attachEndpointThresholdMeters) {
      return `end_attach_gap_${Math.round(gapMeters)}m_exceeds_${attachEndpointThresholdMeters}m`;
    }
  }

  return null;
}

function candidateRepresentativeValidationFailure(
  path: TrajectoryPoint[],
  attach: CandidateAttach,
  edges: StoredTrailEdge[],
): string | null {
  if (path.length < 2) return 'candidate_geometry_too_short';

  const startAnchor = attachPoint(edges, attach.attachStartEdgeId, attach.attachStartMeasureMeters);
  if (startAnchor && distanceMeters(startAnchor, path[0]) > 1) {
    return 'start_attach_not_connected';
  }

  const endAnchor = attachPoint(edges, attach.attachEndEdgeId, attach.attachEndMeasureMeters);
  if (endAnchor && distanceMeters(endAnchor, path[path.length - 1]) > 1) {
    return 'end_attach_not_connected';
  }

  return null;
}

function attachPoint(
  edges: StoredTrailEdge[],
  edgeId: string | null,
  measureMeters: number | null,
): TrajectoryPoint | null {
  if (edgeId === null || measureMeters === null) return null;
  const edge = edges.find((item) => item.id === edgeId);
  if (!edge || edge.path.length < 2) return null;
  return interpolatePointAtMeasure(edge.path, measureMeters);
}

function interpolatePointAtMeasure(path: TrajectoryPoint[], measureMeters: number): TrajectoryPoint {
  if (path.length === 0) return { lat: 0, lon: 0 };
  if (path.length === 1 || measureMeters <= 0) return path[0];

  let consumed = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const segmentLength = distanceMeters(previous, current);
    if (segmentLength <= 0) continue;
    if (consumed + segmentLength >= measureMeters) {
      const ratio = Math.max(0, Math.min(1, (measureMeters - consumed) / segmentLength));
      return {
        lat: previous.lat + (current.lat - previous.lat) * ratio,
        lon: previous.lon + (current.lon - previous.lon) * ratio,
      };
    }
    consumed += segmentLength;
  }

  return path[path.length - 1];
}

function distanceMeters(left: TrajectoryPoint, right: TrajectoryPoint): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = (right.lat - left.lat) * Math.PI / 180;
  const dLon = (right.lon - left.lon) * Math.PI / 180;
  const leftLat = left.lat * Math.PI / 180;
  const rightLat = right.lat * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(leftLat) * Math.cos(rightLat) * Math.sin(dLon / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function candidateSupportScore(
  candidate: StoredCandidateEdge,
  interval: TrailGraphResidualInterval,
  path: TrajectoryPoint[],
): {
  isSupported: boolean;
  supportKind: 'full' | 'partial';
  score: number;
} {
  const support = trajectorySupportMatch(path, candidate.path, candidateFrechetThresholdMeters);
  const sameResidualKind = candidate.residualKind === interval.residualKind;
  const attachMatches = compatibleAttach(candidate, interval);

  const attachCompatibleSupport = sameResidualKind &&
    attachMatches &&
    support.frechetDistance <= candidateFrechetThresholdMeters &&
    support.incomingOverlapRatio >= candidateOverlapThreshold;
  const geometryCompatibleSupport = support.supportKind === 'full' && sameResidualKind && attachMatches;
  const partialGeometrySupport = support.supportKind === 'partial' && sameResidualKind && attachMatches;
  const isSupported = attachCompatibleSupport || geometryCompatibleSupport || partialGeometrySupport;

  return {
    isSupported,
    supportKind: support.supportKind === 'full' ? 'full' : 'partial',
    score: support.score +
      (sameResidualKind ? 0 : 25) +
      (attachMatches ? 0 : 50) +
      Math.abs((candidate.lengthMeters ?? trajectoryLengthMeters(candidate.path)) - trajectoryLengthMeters(path)) / 100,
  };
}

function mergeCandidateRepresentativePath(
  candidate: StoredCandidateEdge,
  incomingPath: TrajectoryPoint[],
  supportKind: 'full' | 'partial',
): CandidateRepresentativeMerge {
  const existingLength = candidate.lengthMeters ?? trajectoryLengthMeters(candidate.path);
  const incomingLength = trajectoryLengthMeters(incomingPath);
  if (supportKind === 'partial') {
    if (existingLength >= incomingLength * 1.25) {
      return { path: candidate.path, source: 'existing' };
    }
    if (incomingLength >= existingLength * 1.25) {
      return { path: incomingPath, source: 'incoming' };
    }
  }

  return {
    path: mergeTrajectoryLines(
      candidate.path,
      incomingPath,
      Math.max(1, candidate.sessionCount),
      1,
    ),
    source: 'merged',
  };
}

function parseGeoJsonLine(value: unknown): TrajectoryPoint[] {
  const geometry = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!isRecord(geometry) || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
    return [];
  }

  return geometry.coordinates
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
      const lon = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    })
    .filter((point): point is TrajectoryPoint => point !== null);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultAfterPurge(purgeResult: RawPurgeResult): ProcessSessionResult {
  if (purgeResult.error) return emptySessionResult(purgeResult.error);
  return {
    affectedRouteIds: [],
    candidatePointsAdded: 0,
    candidateEdgesFormed: 0,
    purgedTrackPointCount: purgeResult.trackPointCount,
    purgedRejectedPointCount: purgeResult.rejectedPointCount,
  };
}

function emptySessionResult(error: string): ProcessSessionResult {
  return {
    affectedRouteIds: [],
    candidatePointsAdded: 0,
    candidateEdgesFormed: 0,
    purgedTrackPointCount: 0,
    purgedRejectedPointCount: 0,
    error,
  };
}

function emptyBatchResult(): Record<string, unknown> {
  return {
    success: true,
    processedSessions: 0,
    affectedRoutes: 0,
    candidatePointsAdded: 0,
    candidateEdgesFormed: 0,
    candidateClustersFormed: 0,
    purgedTrackPointCount: 0,
    purgedRejectedPointCount: 0,
  };
}

function qualityScore(accuracy: number | null): number {
  if (accuracy === null) return 0.75;
  return Math.max(0, Math.min(1, 1 - accuracy / 100));
}

function routeConfidence(sessionCount: number, gpsQualityScore: number): number {
  const sessionScore = Math.min(1, sessionCount / 5);
  return Math.max(0, Math.min(1, sessionScore * 0.35 + gpsQualityScore * 0.65));
}

if (import.meta.main) {
  Deno.serve(handleMatchAndAggregateSessions);
}
