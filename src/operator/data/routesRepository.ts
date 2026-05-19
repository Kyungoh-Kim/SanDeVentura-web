import {
  type GeoJsonLineString,
  type OperatorOverviewMetrics,
  type OperatorRouteCoverage,
  type OperatorRouteDetail,
  type OperatorRouteQualityDetail,
  type OperatorSessionIngestion,
  type OperatorSessionRouteAttribution,
  type OperatorSessionEdgeAttribution,
  type OperatorTrajectorySegmentMetric,
  type ResidualKind,
  type RouteState,
  type TrailEdge,
} from './readModels';
import { invokeOperatorApi } from './operatorApiClient';

type CoverageRow = {
  route_id: string | null;
  mountain_id: string;
  mountain_display_name: string;
  route_display_name: string | null;
  route_state: RouteState;
  confidence: number | null;
  version: number | null;
  session_count: number;
  branch_ambiguity_score: number | null;
  gps_quality_score: number | null;
  updated_at: string | null;
};

type LatestTrailRow = {
  route_id: string;
  mountain_id: string;
  mountain_name: string | null;
  route_name: string | null;
  route_state: RouteState;
  version: number | null;
  confidence: number | null;
  updated_at: string | null;
  trail_geojson: unknown;
  session_count: number;
  branch_ambiguity_score: number | null;
  gps_quality_score: number | null;
};

type SummaryRow = {
  upload_success_rate: number | null;
  queued_uploads: number;
  route_coverage: number | null;
  snap_requests: number;
  trail_served: number;
};

type QualityDetailRow = CoverageRow & {
  accepted_point_count: number;
  rejected_point_count: number;
  latest_evidence_at: string | null;
};

type SessionIngestionRow = {
  session_id: string;
  mountain_id: string;
  mountain_display_name: string;
  route_id: string | null;
  started_at: string;
  ended_at: string | null;
  created_at: string;
  pipeline_state: string;
  upload_state: string;
  consent_version: string | null;
  accepted_point_count: number;
  rejected_point_count: number;
  last_error: string | null;
  matched_route_count: number;
  matched_route_cell_count: number;
  matched_route_point_count: number | null;
  candidate_cell_count: number;
  candidate_point_count: number | null;
  attribution_precision: string;
  processed_algorithm_version: string | null;
  raw_retention_state: 'available' | 'purged';
  recomputable: boolean;
};

type SessionRouteAttributionRow = {
  session_id: string;
  route_id: string;
  route_display_name: string;
  cell_count: number;
  point_count: number | null;
  transition_count: number;
  match_method: string;
  frechet_distance: number | null;
  overlap_ratio: number | null;
  score_margin: number | null;
  attribution_precision: string;
};

type SessionEdgeAttributionRow = {
  session_id: string;
  mountain_id: string;
  interval_index: number;
  target_kind: 'edge' | 'candidate';
  edge_id: string | null;
  route_id: string | null;
  route_display_name: string | null;
  candidate_edge_id: string | null;
  residual_kind: ResidualKind | null;
  direction: 'forward' | 'reverse' | 'unknown';
  session_start_measure_m: number | null;
  session_end_measure_m: number | null;
  edge_start_measure_m: number | null;
  edge_end_measure_m: number | null;
  attach_start_edge_id: string | null;
  attach_start_measure_m: number | null;
  attach_end_edge_id: string | null;
  attach_end_measure_m: number | null;
  point_count: number;
  avg_accuracy: number | null;
  avg_altitude: number | null;
  matched_length_m: number | null;
  algorithm_version: string;
  matched_at: string;
  raw_retention_state: 'available' | 'purged';
  recomputable: boolean;
};

type TrajectorySegmentMetricRow = {
  mountain_id: string;
  target_kind: 'edge' | 'candidate';
  target_id: string;
  route_id: string | null;
  edge_id: string | null;
  candidate_edge_id: string | null;
  direction: 'forward' | 'reverse';
  segment_index: number;
  start_measure_m: number;
  end_measure_m: number;
  session_count: number;
  sample_count: number;
  duration_seconds_avg: number | null;
  duration_seconds_sum: number;
  duration_observation_count: number;
  speed_mps_avg: number | null;
  elevation_gain_m: number;
  elevation_loss_m: number;
  abrupt_altitude_change_count: number;
  max_abs_altitude_delta_m: number | null;
  latest_evidence_at: string | null;
  algorithm_version: string;
  updated_at: string;
};

type TrailEdgeRow = {
  id: string;
  mountain_id: string;
  route_id: string | null;
  trail_geojson: unknown;
  length_m: number | null;
  session_count: number;
  point_count: number;
  confidence: number | null;
  status: TrailEdge['status'];
  algorithm_version: string;
};

export async function fetchOperatorSummary(): Promise<OperatorOverviewMetrics | null> {
  const row = await invokeOperatorApi<SummaryRow | null>('operatorSummary');

  if (row === null) return null;

  return {
    uploadSuccessRate: row.upload_success_rate,
    queuedUploads: row.queued_uploads,
    routeCoverage: row.route_coverage,
    snapRequests: row.snap_requests,
    trailServed: row.trail_served,
  };
}

export async function fetchRouteCoverage(): Promise<OperatorRouteCoverage[]> {
  const data = await invokeOperatorApi<CoverageRow[]>('routeCoverage');

  return ((data ?? []) as CoverageRow[]).map(coverageFromRow);
}

export async function fetchRouteQualityDetails(): Promise<OperatorRouteQualityDetail[]> {
  const data = await invokeOperatorApi<QualityDetailRow[]>('routeQualityDetails');

  return ((data ?? []) as QualityDetailRow[]).map((row) => ({
    ...coverageFromRow(row),
    acceptedPointCount: row.accepted_point_count,
    rejectedPointCount: row.rejected_point_count,
    latestEvidenceAt: row.latest_evidence_at,
    updatedAt: row.updated_at,
  }));
}

export async function fetchRouteDetail(
  routeId: string,
): Promise<OperatorRouteDetail | null> {
  const row = await invokeOperatorApi<LatestTrailRow | null>('routeDetail', { routeId });
  if (!row) return null;

  return {
    routeId: row.route_id,
    mountainId: row.mountain_id,
    mountainDisplayName: row.mountain_name ?? row.mountain_id,
    routeDisplayName: row.route_name,
    routeState: row.route_state,
    confidence: row.confidence,
    version: row.version,
    sessionCount: row.session_count,
    branchAmbiguityScore: row.branch_ambiguity_score,
    gpsQualityScore: row.gps_quality_score,
    updatedAt: row.updated_at,
    trailGeoJson: parseLineString(row.trail_geojson),
  };
}

export async function fetchMountainRouteDetails(
  mountainId: string,
): Promise<OperatorRouteDetail[]> {
  const coverage = await fetchRouteCoverage();
  const routeIds = coverage
    .filter((route) => route.mountainId === mountainId && route.routeId !== null)
    .map((route) => route.routeId as string);
  const details = await Promise.all(routeIds.map((id) => fetchRouteDetail(id)));
  return details.filter((d): d is OperatorRouteDetail => d !== null);
}

export async function fetchTrailEdgesForMountain(mountainId: string): Promise<TrailEdge[]> {
  const data = await invokeOperatorApi<TrailEdgeRow[]>('trailEdgesForMountain', { mountainId });
  return ((data ?? []) as TrailEdgeRow[]).map((row) => ({
    id: row.id,
    mountainId: row.mountain_id,
    routeId: row.route_id,
    trailGeoJson: parseLineString(row.trail_geojson),
    lengthMeters: row.length_m,
    sessionCount: row.session_count,
    pointCount: row.point_count,
    confidence: row.confidence,
    status: row.status,
    algorithmVersion: row.algorithm_version,
  }));
}

export async function fetchSessionIngestion(): Promise<OperatorSessionIngestion[] | null> {
  const data = await invokeOperatorApi<SessionIngestionRow[]>('sessionIngestion');

  return ((data ?? []) as SessionIngestionRow[]).map((row) => ({
    sessionId: row.session_id,
    mountainId: row.mountain_id,
    mountainDisplayName: row.mountain_display_name,
    routeId: row.route_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    pipelineState: row.pipeline_state,
    uploadState: row.upload_state as OperatorSessionIngestion['uploadState'],
    consentVersion: row.consent_version,
    acceptedPointCount: row.accepted_point_count,
    rejectedPointCount: row.rejected_point_count,
    lastError: row.last_error,
    matchedRouteCount: row.matched_route_count,
    matchedRouteSupportCount: row.matched_route_cell_count,
    matchedRoutePointCount: row.matched_route_point_count,
    candidateSupportCount: row.candidate_cell_count,
    candidatePointCount: row.candidate_point_count,
    attributionPrecision: row.attribution_precision as OperatorSessionIngestion['attributionPrecision'],
    processedAlgorithmVersion: row.processed_algorithm_version,
    rawRetentionState: row.raw_retention_state,
    recomputable: row.recomputable,
  }));
}

export async function fetchSessionRouteAttribution(
  sessionId: string,
): Promise<OperatorSessionRouteAttribution[]> {
  const data = await invokeOperatorApi<SessionRouteAttributionRow[]>(
    'sessionRouteAttribution',
    { sessionId },
  );

  return ((data ?? []) as SessionRouteAttributionRow[]).map((row) => ({
    sessionId: row.session_id,
    routeId: row.route_id,
    routeDisplayName: row.route_display_name,
    supportCount: row.cell_count,
    pointCount: row.point_count,
    transitionCount: row.transition_count,
    matchMethod: row.match_method as OperatorSessionRouteAttribution['matchMethod'],
    frechetDistance: row.frechet_distance,
    overlapRatio: row.overlap_ratio,
    scoreMargin: row.score_margin,
    attributionPrecision: row.attribution_precision as OperatorSessionRouteAttribution['attributionPrecision'],
  }));
}

export async function fetchSessionEdgeAttribution(
  sessionId: string,
): Promise<OperatorSessionEdgeAttribution[]> {
  const data = await invokeOperatorApi<SessionEdgeAttributionRow[]>(
    'sessionEdgeAttribution',
    { sessionId },
  );

  return ((data ?? []) as SessionEdgeAttributionRow[]).map((row) => ({
    sessionId: row.session_id,
    mountainId: row.mountain_id,
    intervalIndex: row.interval_index,
    targetKind: row.target_kind,
    edgeId: row.edge_id,
    routeId: row.route_id,
    routeDisplayName: row.route_display_name,
    candidateEdgeId: row.candidate_edge_id,
    residualKind: row.residual_kind,
    direction: row.direction,
    sessionStartMeasureMeters: row.session_start_measure_m,
    sessionEndMeasureMeters: row.session_end_measure_m,
    edgeStartMeasureMeters: row.edge_start_measure_m,
    edgeEndMeasureMeters: row.edge_end_measure_m,
    attachStartEdgeId: row.attach_start_edge_id,
    attachStartMeasureMeters: row.attach_start_measure_m,
    attachEndEdgeId: row.attach_end_edge_id,
    attachEndMeasureMeters: row.attach_end_measure_m,
    pointCount: row.point_count,
    avgAccuracy: row.avg_accuracy,
    avgAltitude: row.avg_altitude,
    matchedLengthMeters: row.matched_length_m,
    algorithmVersion: row.algorithm_version,
    matchedAt: row.matched_at,
    rawRetentionState: row.raw_retention_state,
    recomputable: row.recomputable,
  }));
}

export async function fetchTrajectorySegmentMetrics(
  targetKind: 'edge' | 'candidate',
  targetId: string,
): Promise<OperatorTrajectorySegmentMetric[]> {
  const data = await invokeOperatorApi<TrajectorySegmentMetricRow[]>(
    'trajectorySegmentMetrics',
    { targetKind, targetId },
  );

  return ((data ?? []) as TrajectorySegmentMetricRow[]).map((row) => ({
    mountainId: row.mountain_id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    routeId: row.route_id ?? null,
    edgeId: row.edge_id,
    candidateEdgeId: row.candidate_edge_id,
    direction: row.direction,
    segmentIndex: row.segment_index,
    startMeasureMeters: row.start_measure_m,
    endMeasureMeters: row.end_measure_m,
    sessionCount: row.session_count,
    sampleCount: row.sample_count,
    durationSecondsAvg: row.duration_seconds_avg,
    durationSecondsSum: row.duration_seconds_sum,
    durationObservationCount: row.duration_observation_count,
    speedMetersPerSecondAvg: row.speed_mps_avg,
    elevationGainMeters: row.elevation_gain_m,
    elevationLossMeters: row.elevation_loss_m,
    abruptAltitudeChangeCount: row.abrupt_altitude_change_count,
    maxAbsAltitudeDeltaMeters: row.max_abs_altitude_delta_m,
    latestEvidenceAt: row.latest_evidence_at,
    algorithmVersion: row.algorithm_version,
    updatedAt: row.updated_at,
  }));
}

export async function renameRoute(routeId: string, displayName: string): Promise<void> {
  await invokeOperatorApi<null>('renameRoute', { routeId, displayName });
}

function coverageFromRow(row: CoverageRow): OperatorRouteCoverage {
  return {
    routeId: row.route_id,
    mountainId: row.mountain_id,
    mountainDisplayName: row.mountain_display_name,
    routeDisplayName: row.route_display_name,
    routeState: row.route_state,
    confidence: row.confidence,
    version: row.version,
    sessionCount: row.session_count,
    branchAmbiguityScore: row.branch_ambiguity_score,
    gpsQualityScore: row.gps_quality_score,
    updatedAt: row.updated_at,
  };
}

function parseLineString(value: unknown): GeoJsonLineString | null {
  if (!isRecord(value) || value.type !== 'LineString' || !Array.isArray(value.coordinates)) {
    return null;
  }

  const coordinates: Array<[number, number]> = [];
  for (const coordinate of value.coordinates) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length < 2 ||
      typeof coordinate[0] !== 'number' ||
      typeof coordinate[1] !== 'number'
    ) {
      return null;
    }
    coordinates.push([coordinate[0], coordinate[1]]);
  }

  return coordinates.length >= 2
    ? { type: 'LineString', coordinates }
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
