import { type CandidateCell, type CandidateTrajectory, type GeoJsonLineString } from './readModels';
import { supabase } from './supabaseClient';

export type MatchAndAggregateResult = {
  processedSessions: number;
  affectedRoutes: number;
  orphanCellsAdded: number;
  candidateClustersFormed: number;
};

export type PromoteCandidateClusterResult = {
  routeId: string;
  confidenceLevel: string;
  confidence: number;
  cellCount: number;
  transitionCount: number;
  sessionCount: number;
  sessionsReset: number;
};

export type CandidateCluster = {
  mountainId: string;
  cellCount: number;
  totalSessionContributions: number;
  latestEvidenceAt: string | null;
  trajectoryCount?: number;
  totalPointCount?: number;
};


export async function triggerMatchAndAggregate(): Promise<MatchAndAggregateResult> {
  if (!supabase) {
    throw new Error('Supabase client not configured');
  }

  const { data, error } = await supabase.functions.invoke(
    'match-and-aggregate-sessions',
    { method: 'POST', body: {} },
  );

  if (error) {
    throw new Error(error.message ?? 'Edge function invocation failed');
  }

  if (!data?.success) {
    const msg = data?.errors?.[0] ?? 'Unknown error from edge function';
    throw new Error(msg);
  }

  return {
    processedSessions: data.processedSessions ?? 0,
    affectedRoutes: data.affectedRoutes ?? 0,
    orphanCellsAdded: data.orphanCellsAdded ?? 0,
    candidateClustersFormed: data.candidateClustersFormed ?? 0,
  };
}

export async function fetchCandidateClusters(): Promise<CandidateCluster[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('operator_candidate_trajectory_clusters')
    .select('mountain_id, trajectory_count, total_point_count, total_session_contributions, latest_evidence_at');
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    mountainId: row.mountain_id,
    cellCount: row.trajectory_count,
    trajectoryCount: row.trajectory_count,
    totalPointCount: row.total_point_count,
    totalSessionContributions: row.total_session_contributions,
    latestEvidenceAt: row.latest_evidence_at,
  }));
}

export async function fetchCandidateTrajectories(mountainId: string): Promise<CandidateTrajectory[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('candidate_trajectories_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    id: row.id,
    mountainId: row.mountain_id,
    trailGeoJson: parseLineString(row.trail_geojson),
    pointCount: row.point_count,
    sessionCount: row.session_count,
    lengthMeters: row.length_m,
    confidence: row.confidence,
    latestEvidenceAt: row.latest_evidence_at,
    algorithmVersion: row.algorithm_version,
  }));
}

export async function fetchCandidateCells(mountainId: string): Promise<CandidateCell[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('candidate_cells_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    cellKey: row.cell_key,
    lat: row.lat,
    lon: row.lon,
    pointCount: row.point_count,
    sessionCount: row.session_count,
  }));
}

export async function fetchTrailCells(mountainId: string): Promise<CandidateCell[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('trail_cells_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    cellKey: row.cell_key,
    lat: row.lat,
    lon: row.lon,
    pointCount: row.point_count,
    sessionCount: row.session_count,
  }));
}

export type RouteSplitAuditEntry = {
  id: string;
  mountainId: string;
  originalRouteId: string;
  branchPointCellKey: string;
  segmentARouteId: string | null;
  segmentBRouteId: string | null;
  branchRouteId: string | null;
  cfgConfidence: number | null;
  crossBranchRatio: number | null;
  invalidReason: string | null;
  matchScore: number | null;
  frechetDistance: number | null;
  clusterWeight: number | null;
  autoDecision: 'auto_split' | 'review_required';
  affectedSessionCount: number;
  dryRun: boolean;
  decidedAt: string;
};

export type EvaluateRouteSplitsResult = {
  plansEvaluated: number;
  plansValid: number;
  dryRun: boolean;
  plans: Array<{
    originalRouteId: string;
    valid: boolean;
    invalidReason?: string;
    cfgConfidence: number;
    crossBranchRatio: number;
    frechetDistance: number | null;
    matchScore: number | null;
    clusterWeight: number;
    autoDecision: 'auto_split' | 'review_required';
    newSegmentBRouteId: string;
    newBranchRouteId: string;
    affectedSessions: string[];
  }>;
};

export async function fetchRouteSplitAudit(limit = 20): Promise<RouteSplitAuditEntry[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('route_split_audit')
    .select('*')
    .order('decided_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    id: row.id,
    mountainId: row.mountain_id,
    originalRouteId: row.original_route_id,
    branchPointCellKey: row.branch_point_cell_key,
    segmentARouteId: row.segment_a_route_id,
    segmentBRouteId: row.segment_b_route_id,
    branchRouteId: row.branch_route_id,
    cfgConfidence: row.cfg_confidence,
    crossBranchRatio: row.cross_branch_ratio,
    invalidReason: row.invalid_reason,
    matchScore: row.match_score,
    frechetDistance: row.frechet_distance,
    clusterWeight: row.cluster_weight,
    autoDecision: row.auto_decision ?? 'review_required',
    affectedSessionCount: row.affected_session_count,
    dryRun: row.dry_run,
    decidedAt: row.decided_at,
  }));
}

export async function triggerEvaluateRouteSplits(
  mountainId?: string,
  dryRun = true,
): Promise<EvaluateRouteSplitsResult> {
  if (!supabase) throw new Error('Supabase client not configured');

  const { data, error } = await supabase.functions.invoke(
    'evaluate-route-splits',
    { method: 'POST', body: { mountainId, dryRun } },
  );

  if (error) throw new Error(error.message ?? 'Edge function invocation failed');

  return {
    plansEvaluated: data?.plansEvaluated ?? 0,
    plansValid: data?.plansValid ?? 0,
    dryRun: data?.dryRun ?? true,
    plans: data?.plans ?? [],
  };
}

export async function promoteCandidateCluster(
  mountainId: string,
  displayName: string,
): Promise<PromoteCandidateClusterResult> {
  if (!supabase) throw new Error('Supabase client not configured');

  const { data, error } = await supabase.functions.invoke(
    'promote-candidate-cluster',
    { method: 'POST', body: { mountainId, displayName } },
  );

  if (error) throw new Error(error.message ?? 'Edge function invocation failed');
  if (!data?.success) {
    const msg = data?.errors?.[0] ?? 'Unknown error from edge function';
    throw new Error(msg);
  }

  return {
    routeId: data.routeId,
    confidenceLevel: data.confidenceLevel,
    confidence: data.confidence ?? 0,
    cellCount: data.cellCount ?? 0,
    transitionCount: data.transitionCount ?? 0,
    sessionCount: data.sessionCount ?? 0,
    sessionsReset: data.sessionsReset ?? 0,
  };
}

function parseLineString(value: unknown): GeoJsonLineString | null {
  if (!value || typeof value !== 'object' || !('coordinates' in value)) return null;
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates)) return null;
  const parsed: Array<[number, number]> = [];
  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const lon = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    parsed.push([lon, lat]);
  }
  return parsed.length >= 2 ? { type: 'LineString', coordinates: parsed } : null;
}
