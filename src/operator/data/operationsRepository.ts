import { type CandidateCell } from './readModels';
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
    .from('candidate_cell_clusters')
    .select('mountain_id, cell_count, total_session_contributions, latest_evidence_at');
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    mountainId: row.mountain_id,
    cellCount: row.cell_count,
    totalSessionContributions: row.total_session_contributions,
    latestEvidenceAt: row.latest_evidence_at,
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
