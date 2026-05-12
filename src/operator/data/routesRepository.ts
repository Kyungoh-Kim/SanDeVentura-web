import {
  type GeoJsonLineString,
  type OperatorOverviewMetrics,
  type OperatorRouteCoverage,
  type OperatorRouteDetail,
  type OperatorRouteQualityDetail,
  type OperatorSessionCellAttribution,
  type OperatorSessionIngestion,
  type OperatorSessionRouteAttribution,
  type OperatorSessionTrajectoryAttribution,
  type RouteState,
} from './readModels';
import { supabase } from './supabaseClient';

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

type SessionCellAttributionRow = {
  session_id: string;
  target_kind: 'route' | 'candidate';
  route_id: string | null;
  route_display_name: string | null;
  cell_key: string;
  point_count: number;
  avg_accuracy: number | null;
  avg_altitude: number | null;
  last_seen_at: string | null;
};

type SessionTrajectoryAttributionRow = {
  session_id: string;
  target_kind: 'route' | 'candidate';
  route_id: string | null;
  route_display_name: string | null;
  candidate_trajectory_id: string | null;
  point_count: number;
  avg_accuracy: number | null;
  avg_altitude: number | null;
  matched_length_m: number | null;
  residual_length_m: number | null;
  frechet_distance: number | null;
  overlap_ratio: number | null;
  algorithm_version: string;
  matched_at: string;
};

export async function fetchOperatorSummary(): Promise<OperatorOverviewMetrics | null> {
  if (supabase === null) {
    return null;
  }

  const { data, error } = await supabase
    .from('operator_quality_summary')
    .select('upload_success_rate, queued_uploads, route_coverage, snap_requests, trail_served')
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = data as SummaryRow | null;
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
  if (supabase === null) {
    return [];
  }

  const { data, error } = await supabase
    .from('operator_route_coverage')
    .select(
      'route_id, mountain_id, mountain_display_name, route_display_name, route_state, confidence, version, session_count, branch_ambiguity_score, gps_quality_score, updated_at',
    )
    .order('mountain_id');

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CoverageRow[]).map(coverageFromRow);
}

export async function fetchRouteQualityDetails(): Promise<OperatorRouteQualityDetail[]> {
  if (supabase === null) {
    return [];
  }

  const { data, error } = await supabase
    .from('operator_route_quality_detail')
    .select(
      'route_id, mountain_id, mountain_display_name, route_display_name, route_state, confidence, version, session_count, branch_ambiguity_score, gps_quality_score, accepted_point_count, rejected_point_count, latest_evidence_at, updated_at',
    )
    .order('mountain_id');

  if (error) {
    throw new Error(error.message);
  }

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
  if (supabase === null) {
    return null;
  }

  const { data, error } = await supabase.rpc('latest_canonical_trail', {
    p_route_id: routeId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = ((data ?? []) as LatestTrailRow[])[0];
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
  if (supabase === null) return [];

  const { data, error } = await supabase
    .from('operator_route_coverage')
    .select('route_id')
    .eq('mountain_id', mountainId)
    .not('route_id', 'is', null);

  if (error) throw new Error(error.message);

  const routeIds = ((data ?? []) as Array<{ route_id: string }>).map((r) => r.route_id);
  const details = await Promise.all(routeIds.map((id) => fetchRouteDetail(id)));
  return details.filter((d): d is OperatorRouteDetail => d !== null);
}

export async function fetchSessionIngestion(): Promise<OperatorSessionIngestion[] | null> {
  if (supabase === null) {
    return null;
  }

  const { data, error } = await supabase
    .from('operator_session_ingestion')
    .select(
      'session_id, mountain_id, mountain_display_name, route_id, started_at, ended_at, created_at, pipeline_state, upload_state, consent_version, accepted_point_count, rejected_point_count, last_error, matched_route_count, matched_route_cell_count, matched_route_point_count, candidate_cell_count, candidate_point_count, attribution_precision',
    )
    .order('started_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    return null;
  }

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
    matchedRouteCellCount: row.matched_route_cell_count,
    matchedRoutePointCount: row.matched_route_point_count,
    candidateCellCount: row.candidate_cell_count,
    candidatePointCount: row.candidate_point_count,
    attributionPrecision: row.attribution_precision as OperatorSessionIngestion['attributionPrecision'],
  }));
}

export async function fetchSessionRouteAttribution(
  sessionId: string,
): Promise<OperatorSessionRouteAttribution[]> {
  if (supabase === null) return [];

  const { data, error } = await supabase
    .from('operator_session_route_attribution')
    .select(
      'session_id, route_id, route_display_name, cell_count, point_count, transition_count, match_method, frechet_distance, overlap_ratio, score_margin, attribution_precision',
    )
    .eq('session_id', sessionId)
    .order('route_id');

  if (error) throw new Error(error.message);

  return ((data ?? []) as SessionRouteAttributionRow[]).map((row) => ({
    sessionId: row.session_id,
    routeId: row.route_id,
    routeDisplayName: row.route_display_name,
    cellCount: row.cell_count,
    pointCount: row.point_count,
    transitionCount: row.transition_count,
    matchMethod: row.match_method as OperatorSessionRouteAttribution['matchMethod'],
    frechetDistance: row.frechet_distance,
    overlapRatio: row.overlap_ratio,
    scoreMargin: row.score_margin,
    attributionPrecision: row.attribution_precision as OperatorSessionRouteAttribution['attributionPrecision'],
  }));
}

export async function fetchSessionCellAttribution(
  sessionId: string,
): Promise<OperatorSessionCellAttribution[]> {
  if (supabase === null) return [];

  const { data, error } = await supabase
    .from('operator_session_cell_attribution')
    .select(
      'session_id, target_kind, route_id, route_display_name, cell_key, point_count, avg_accuracy, avg_altitude, last_seen_at',
    )
    .eq('session_id', sessionId)
    .order('target_kind')
    .order('route_id')
    .order('cell_key');

  if (error) throw new Error(error.message);

  return ((data ?? []) as SessionCellAttributionRow[]).map((row) => ({
    sessionId: row.session_id,
    targetKind: row.target_kind,
    routeId: row.route_id,
    routeDisplayName: row.route_display_name,
    cellKey: row.cell_key,
    pointCount: row.point_count,
    avgAccuracy: row.avg_accuracy,
    avgAltitude: row.avg_altitude,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function fetchSessionTrajectoryAttribution(
  sessionId: string,
): Promise<OperatorSessionTrajectoryAttribution[]> {
  if (supabase === null) return [];

  const { data, error } = await supabase
    .from('operator_session_trajectory_attribution')
    .select(
      'session_id, target_kind, route_id, route_display_name, candidate_trajectory_id, point_count, avg_accuracy, avg_altitude, matched_length_m, residual_length_m, frechet_distance, overlap_ratio, algorithm_version, matched_at',
    )
    .eq('session_id', sessionId)
    .order('target_kind')
    .order('route_id');

  if (error) throw new Error(error.message);

  return ((data ?? []) as SessionTrajectoryAttributionRow[]).map((row) => ({
    sessionId: row.session_id,
    targetKind: row.target_kind,
    routeId: row.route_id,
    routeDisplayName: row.route_display_name,
    candidateTrajectoryId: row.candidate_trajectory_id,
    pointCount: row.point_count,
    avgAccuracy: row.avg_accuracy,
    avgAltitude: row.avg_altitude,
    matchedLengthMeters: row.matched_length_m,
    residualLengthMeters: row.residual_length_m,
    frechetDistance: row.frechet_distance,
    overlapRatio: row.overlap_ratio,
    algorithmVersion: row.algorithm_version,
    matchedAt: row.matched_at,
  }));
}

export async function renameRoute(routeId: string, displayName: string): Promise<void> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { error } = await supabase
    .from('routes')
    .update({ display_name: displayName })
    .eq('id', routeId);
  if (error) throw new Error(error.message);
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
