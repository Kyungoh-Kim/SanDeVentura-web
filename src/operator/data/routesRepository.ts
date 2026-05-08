import {
  type GeoJsonLineString,
  type OperatorOverviewMetrics,
  type OperatorRouteCoverage,
  type OperatorRouteDetail,
  type OperatorRouteQualityDetail,
  type OperatorSessionIngestion,
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
  route_id: string | null;
  upload_state: string;
  consent_version: string | null;
  accepted_point_count: number;
  rejected_point_count: number;
  last_error: string | null;
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

export async function fetchSessionIngestion(): Promise<OperatorSessionIngestion[] | null> {
  if (supabase === null) {
    return null;
  }

  const { data, error } = await supabase
    .from('operator_session_ingestion')
    .select(
      'session_id, mountain_id, route_id, upload_state, consent_version, accepted_point_count, rejected_point_count, last_error',
    )
    .order('session_id');

  if (error) {
    return null;
  }

  return ((data ?? []) as SessionIngestionRow[]).map((row) => ({
    sessionId: row.session_id,
    mountainId: row.mountain_id,
    routeId: row.route_id,
    uploadState: row.upload_state as OperatorSessionIngestion['uploadState'],
    consentVersion: row.consent_version,
    acceptedPointCount: row.accepted_point_count,
    rejectedPointCount: row.rejected_point_count,
    lastError: row.last_error,
  }));
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
