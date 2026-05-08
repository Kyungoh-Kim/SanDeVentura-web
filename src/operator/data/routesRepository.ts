import {
  operatorOverviewMetrics,
  routeCoverageRows,
  routeQualityRows,
  type GeoJsonLineString,
  type OperatorOverviewMetrics,
  type OperatorRouteCoverage,
  type OperatorRouteDetail,
  type OperatorRouteQualityDetail,
  type RouteState,
} from './readModels';
import { supabase } from './supabaseClient';

type CoverageRow = {
  mountain_id: string;
  display_name: string;
  route_state: RouteState;
  confidence: number | null;
  version: number | null;
  session_count: number;
  branch_ambiguity_score: number | null;
  gps_quality_score: number | null;
  updated_at: string | null;
};

type LatestTrailRow = {
  mountain_id: string;
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

export async function fetchOperatorSummary(): Promise<OperatorOverviewMetrics> {
  if (supabase === null) {
    return operatorOverviewMetrics;
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
  return row === null
    ? operatorOverviewMetrics
    : {
        uploadSuccessRate: row.upload_success_rate,
        queuedUploads: row.queued_uploads,
        routeCoverage: row.route_coverage,
        snapRequests: row.snap_requests,
        trailServed: row.trail_served,
      };
}

export async function fetchRouteCoverage(): Promise<OperatorRouteCoverage[]> {
  if (supabase === null) {
    return routeCoverageRows;
  }

  const { data, error } = await supabase
    .from('operator_route_coverage')
    .select(
      'mountain_id, display_name, route_state, confidence, version, session_count, branch_ambiguity_score, gps_quality_score, updated_at',
    )
    .order('mountain_id');

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as CoverageRow[]).map((row) => ({
    mountainId: row.mountain_id,
    displayName: row.display_name,
    routeState: row.route_state,
    confidence: row.confidence,
    version: row.version,
    sessionCount: row.session_count,
    branchAmbiguityScore: row.branch_ambiguity_score,
    gpsQualityScore: row.gps_quality_score,
  }));
}

export async function fetchRouteQualityDetails(): Promise<OperatorRouteQualityDetail[]> {
  if (supabase === null) {
    return routeQualityRows;
  }

  const { data, error } = await supabase
    .from('operator_route_quality_detail')
    .select(
      'mountain_id, display_name, route_state, confidence, version, session_count, branch_ambiguity_score, gps_quality_score, accepted_point_count, rejected_point_count, latest_evidence_at, updated_at',
    )
    .order('mountain_id');

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as QualityDetailRow[]).map((row) => ({
    mountainId: row.mountain_id,
    displayName: row.display_name,
    routeState: row.route_state,
    confidence: row.confidence,
    version: row.version,
    sessionCount: row.session_count,
    branchAmbiguityScore: row.branch_ambiguity_score,
    gpsQualityScore: row.gps_quality_score,
    acceptedPointCount: row.accepted_point_count,
    rejectedPointCount: row.rejected_point_count,
    latestEvidenceAt: row.latest_evidence_at,
    updatedAt: row.updated_at,
  }));
}

export async function fetchRouteDetail(
  mountainId: string,
): Promise<OperatorRouteDetail | null> {
  if (supabase === null) {
    return routeCoverageRows.find((row) => row.mountainId === mountainId) ?? null;
  }

  const { data, error } = await supabase.rpc('latest_canonical_trail', {
    p_mountain_id: mountainId,
  });

  if (error) {
    throw new Error(error.message);
  }

  const row = ((data ?? []) as LatestTrailRow[])[0];
  if (!row) {
    const fallback = routeCoverageRows.find((item) => item.mountainId === mountainId);
    return fallback
      ? { ...fallback, updatedAt: null, trailGeoJson: null }
      : null;
  }

  return {
    mountainId: row.mountain_id,
    displayName:
      routeCoverageRows.find((item) => item.mountainId === row.mountain_id)?.displayName ??
      row.mountain_id,
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
