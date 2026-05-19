import { type CandidateEdge, type GeoJsonLineString, type ResidualKind } from './readModels';
import { invokeOperatorApi } from './operatorApiClient';
import { supabase } from './supabaseClient';

export type MatchAndAggregateResult = {
  processedSessions: number;
  affectedRoutes: number;
  candidatePointsAdded: number;
  candidateEdgesFormed: number;
};

export type PromoteCandidateEdgeResult = {
  candidateEdgeId: string;
  promotedEdgeId: string;
  createdNodeIds: string[];
  splitEdgeIds: string[];
  retiredEdgeIds: string[];
  confidence: number | null;
  status: string;
};

export type CandidateCluster = {
  mountainId: string;
  edgeCount: number;
  promotionReadyCount: number;
  totalPointCount: number;
  totalSessionContributions: number;
  latestEvidenceAt: string | null;
};

export async function triggerMatchAndAggregate(): Promise<MatchAndAggregateResult> {
  if (!supabase) throw new Error('Supabase client not configured');

  const { data, error } = await supabase.functions.invoke(
    'match-and-aggregate-sessions',
    { method: 'POST', body: {} },
  );

  if (error) throw new Error(error.message ?? 'Edge function invocation failed');
  if (!data?.success) {
    const msg = data?.errors?.[0] ?? 'Unknown error from edge function';
    throw new Error(msg);
  }

  return {
    processedSessions: data.processedSessions ?? 0,
    affectedRoutes: data.affectedRoutes ?? 0,
    candidatePointsAdded: data.candidatePointsAdded ?? 0,
    candidateEdgesFormed: data.candidateEdgesFormed ?? data.candidateClustersFormed ?? 0,
  };
}

export async function fetchCandidateClusters(): Promise<CandidateCluster[]> {
  const data = await fetchCandidateEdgeRows();
  const clusters = new Map<string, CandidateCluster>();
  for (const row of data) {
    const existing = clusters.get(row.mountainId) ?? {
      mountainId: row.mountainId,
      edgeCount: 0,
      promotionReadyCount: 0,
      totalPointCount: 0,
      totalSessionContributions: 0,
      latestEvidenceAt: null,
    };
    existing.edgeCount += 1;
    if (row.promotionReady === true) existing.promotionReadyCount += 1;
    existing.totalPointCount += row.pointCount ?? 0;
    existing.totalSessionContributions += row.sessionCount ?? 0;
    if (
      row.latestEvidenceAt &&
      (!existing.latestEvidenceAt || Date.parse(row.latestEvidenceAt) > Date.parse(existing.latestEvidenceAt))
    ) {
      existing.latestEvidenceAt = row.latestEvidenceAt;
    }
    clusters.set(row.mountainId, existing);
  }
  return [...clusters.values()];
}

export async function fetchCandidateEdgeRows(): Promise<CandidateEdge[]> {
  const data = await invokeOperatorApi<any[]>('candidateEdgeRows');
  return (data as any[]).map(candidateEdgeFromRow);
}

export async function fetchCandidateEdges(mountainId: string): Promise<CandidateEdge[]> {
  const data = await invokeOperatorApi<any[]>('candidateEdgesForMountain', { mountainId });
  return (data as any[]).map(candidateEdgeFromRow);
}

export async function promoteCandidateEdge(
  candidateEdgeId: string,
  displayName: string,
): Promise<PromoteCandidateEdgeResult> {
  if (!supabase) throw new Error('Supabase client not configured');
  const { data, error } = await supabase.functions.invoke(
    'promote-candidate-edge',
    { method: 'POST', body: { candidateEdgeId, displayName } },
  );
  if (error) throw new Error(error.message ?? 'Edge function invocation failed');
  if (!data?.success) {
    const msg = data?.errors?.[0] ?? 'Unknown error from edge function';
    throw new Error(msg);
  }
  return {
    candidateEdgeId: data.candidateEdgeId,
    promotedEdgeId: data.promotedEdgeId,
    createdNodeIds: data.createdNodeIds ?? [],
    splitEdgeIds: data.splitEdgeIds ?? [],
    retiredEdgeIds: data.retiredEdgeIds ?? [],
    confidence: data.confidence ?? null,
    status: data.status,
  };
}

function parseLineString(value: unknown): GeoJsonLineString | null {
  if (!value || typeof value !== 'object') return null;
  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return null;
  const coordinates = geometry.coordinates
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
      const lon = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] as [number, number] : null;
    })
    .filter((coordinate): coordinate is [number, number] => coordinate !== null);
  return coordinates.length >= 2 ? { type: 'LineString', coordinates } : null;
}

function candidateEdgeFromRow(row: any): CandidateEdge {
  return {
    id: row.id,
    mountainId: row.mountain_id,
    mountainDisplayName: row.mountain_display_name ?? row.mountain_id,
    trailGeoJson: parseLineString(row.trail_geojson),
    attachStartEdgeId: row.attach_start_edge_id,
    attachStartMeasureMeters: row.attach_start_measure_m,
    attachEndEdgeId: row.attach_end_edge_id,
    attachEndMeasureMeters: row.attach_end_measure_m,
    residualKind: row.residual_kind as ResidualKind,
    pointCount: row.point_count,
    sessionCount: row.session_count,
    lengthMeters: row.length_m,
    confidence: row.confidence,
    confidenceLevel: row.confidence_level,
    promotionReady: row.promotion_ready,
    validationFailureReason: row.validation_failure_reason,
    latestEvidenceAt: row.latest_evidence_at,
    algorithmVersion: row.algorithm_version,
  };
}
