import {
  clusterCandidateResiduals,
  inferCanonicalRouteFromCells,
  weightedDiscreteFrechet,
  type CandidateResidualCluster,
  type TrailCell,
  type TrailTransition,
} from './route_inference.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

const minCfgConfidence = 0.80;
const minCrossBranchRatio = 0.55;
const minClusterSessionCount = 3;
const minClusterCellCount = 3;
const minSegmentCells = 5;

// ── Input types ───────────────────────────────────────────────────────────────

export type CrossTransitionRow = {
  routeId: string;
  fromCellKey: string;
  toCellKey: string;
  direction: 'route_to_candidate' | 'candidate_to_route';
  sessionCount: number;
  transitionCount: number;
  contributingSessions: string[];
};

export type MountainCtx = {
  mountainId: string;
  candidateCells: TrailCell[];
  candidateTransitions: TrailTransition[];
  crossTransitions: CrossTransitionRow[];
  // Cells and transitions for each route that has cross-transitions to candidates
  routeCells: Map<string, TrailCell[]>;
  routeTransitions: Map<string, TrailTransition[]>;
};

// ── Output types ──────────────────────────────────────────────────────────────

export type BranchCandidate = {
  originalRouteId: string;
  branchPointCellKey: string;
  clusterCellKeys: Set<string>;
  clusterSessionCount: number;
  cfgConfidence: number;
  crossBranchRatio: number;
  frechetDistance: number | null;
  matchScore: number | null;
  clusterWeight: number;
  autoDecision: 'auto_split' | 'review_required';
  contributingSessions: string[];
};

export type SplitPlan = {
  mountainId: string;
  originalRouteId: string;
  branchPointCellKey: string;
  segmentACellKeys: string[];
  segmentBCellKeys: string[];
  branchCellKeys: string[];
  newSegmentBRouteId: string;
  newBranchRouteId: string;
  cfgConfidence: number;
  crossBranchRatio: number;
  frechetDistance: number | null;
  matchScore: number | null;
  clusterWeight: number;
  autoDecision: 'auto_split' | 'review_required';
  affectedSessions: string[];
  valid: boolean;
  invalidReason?: string;
};

// ── Main exported functions ───────────────────────────────────────────────────

export function detectBranchCandidates(ctx: MountainCtx): BranchCandidate[] {
  if (ctx.candidateCells.length === 0 || ctx.crossTransitions.length === 0) {
    return [];
  }

  const clusters = clusterCandidateResiduals(ctx.candidateCells, ctx.candidateTransitions, {
    minClusterSessionCount: 2,
    minClusterCellCount,
  });
  const results: BranchCandidate[] = [];

  for (const cluster of clusters) {
    const connection = findStrongestCrossConnection(cluster, ctx.crossTransitions);
    if (!connection) continue;

    const { routeId, branchPointCellKey } = connection;
    const routeCellsForRoute = ctx.routeCells.get(routeId) ?? [];
    const routeTransitionsForRoute = ctx.routeTransitions.get(routeId) ?? [];

    const cfgConfidence = computeClusterConfidence(cluster, ctx.candidateTransitions);
    const crossBranchRatio = computeCrossBranchRatio(
      branchPointCellKey,
      routeTransitionsForRoute,
      ctx.crossTransitions.filter(
        (t) => t.routeId === routeId && t.direction === 'route_to_candidate',
      ),
    );

    const clusterPath = orderedPathFromCells(cluster.cells, cluster.transitions, cluster.sessionCount);
    const routePath = orderedPathFromCells(routeCellsForRoute, routeTransitionsForRoute);
    const frechet = clusterPath.length > 0 && routePath.length > 0
      ? weightedDiscreteFrechet(clusterPath, routePath, new Map(routeCellsForRoute.map((cell) => [cell.cellKey, cell])))
      : null;
    const autoDecision = cfgConfidence >= minCfgConfidence &&
        crossBranchRatio >= minCrossBranchRatio &&
        cluster.sessionCount >= minClusterSessionCount
      ? 'auto_split'
      : 'review_required';

    results.push({
      originalRouteId: routeId,
      branchPointCellKey,
      clusterCellKeys: cluster.cellKeys,
      clusterSessionCount: cluster.sessionCount,
      cfgConfidence,
      crossBranchRatio,
      frechetDistance: frechet?.frechetDistance ?? null,
      matchScore: frechet === null ? null : cfgConfidence * 100 + crossBranchRatio * 50 +
        cluster.clusterWeight * 0.5 - frechet.frechetDistance,
      clusterWeight: cluster.clusterWeight,
      autoDecision,
      contributingSessions: cluster.contributingSessions,
    });
  }

  return results;
}

export function computeSplitPlan(
  mountainId: string,
  originalRouteId: string,
  routeCells: TrailCell[],
  routeTransitions: TrailTransition[],
  branchPointCellKey: string,
  branchClusterCells: TrailCell[],
  branchClusterTransitions: TrailTransition[],
  cfgConfidence: number,
  crossBranchRatio: number,
  frechetDistance: number | null,
  matchScore: number | null,
  clusterWeight: number,
  autoDecision: 'auto_split' | 'review_required',
  contributingSessions: string[],
): SplitPlan {
  const invalid = (reason: string): SplitPlan => ({
    mountainId,
    originalRouteId,
    branchPointCellKey,
    segmentACellKeys: [],
    segmentBCellKeys: [],
    branchCellKeys: [],
    newSegmentBRouteId: '',
    newBranchRouteId: '',
    cfgConfidence,
    crossBranchRatio,
    frechetDistance,
    matchScore,
    clusterWeight,
    autoDecision,
    affectedSessions: contributingSessions,
    valid: false,
    invalidReason: reason,
  });

  if (routeCells.length === 0) return invalid('route_has_no_cells');
  if (autoDecision !== 'auto_split') return invalid('review_required');
  if (cfgConfidence < minCfgConfidence) return invalid(`cfg_confidence_too_low: ${cfgConfidence.toFixed(2)} < ${minCfgConfidence}`);
  if (crossBranchRatio < minCrossBranchRatio) return invalid(`cross_branch_ratio_too_low: ${crossBranchRatio.toFixed(2)} < ${minCrossBranchRatio}`);
  if (contributingSessions.length < minClusterSessionCount) {
    return invalid(`affected_sessions_too_low: ${contributingSessions.length} < ${minClusterSessionCount}`);
  }

  // Derive ordered path from inferCanonicalRouteFromCells
  const route = inferCanonicalRouteFromCells(routeCells, routeTransitions);
  if (route.line.length < 2) return invalid('route_has_no_valid_path');

  // Split the inferred route by the exact ordered cell corridor, not by smoothed coordinates.
  const orderedCellKeys = route.cellKeys;

  if (orderedCellKeys.length === 0) return invalid('could_not_reconstruct_path');

  const branchIndex = orderedCellKeys.indexOf(branchPointCellKey);
  if (branchIndex === -1) return invalid('branch_point_not_in_route_path');

  // Segment A: [0..branchIndex] inclusive, Segment B: [branchIndex..end] inclusive
  const segmentACellKeys = orderedCellKeys.slice(0, branchIndex + 1);
  const segmentBCellKeys = orderedCellKeys.slice(branchIndex);

  if (segmentACellKeys.length < minSegmentCells) {
    return invalid(`segment_a_too_short: ${segmentACellKeys.length} < ${minSegmentCells}`);
  }
  if (segmentBCellKeys.length < minSegmentCells) {
    return invalid(`segment_b_too_short: ${segmentBCellKeys.length} < ${minSegmentCells}`);
  }

  const branchCellKeys = branchClusterCells.map((c) => c.cellKey);
  if (branchCellKeys.length === 0) return invalid('branch_cluster_is_empty');

  const shortHash = makeShortHash(branchPointCellKey);
  const newSegmentBRouteId = `${originalRouteId}-cont-${shortHash}`;
  const newBranchRouteId = `${mountainId}-branch-${shortHash}`;

  void branchClusterTransitions;

  return {
    mountainId,
    originalRouteId,
    branchPointCellKey,
    segmentACellKeys,
    segmentBCellKeys,
    branchCellKeys,
    newSegmentBRouteId,
    newBranchRouteId,
    cfgConfidence,
    crossBranchRatio,
    frechetDistance,
    matchScore,
    clusterWeight,
    autoDecision,
    affectedSessions: contributingSessions,
    valid: true,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

type ClusterConnection = { routeId: string; branchPointCellKey: string; strength: number };

function findStrongestCrossConnection(
  cluster: CandidateResidualCluster,
  crossTransitions: CrossTransitionRow[],
): ClusterConnection | null {
  let best: ClusterConnection | null = null;

  for (const t of crossTransitions) {
    if (t.direction !== 'route_to_candidate') continue;
    if (!cluster.cellKeys.has(t.toCellKey)) continue;

    const strength = t.sessionCount;
    if (!best || strength > best.strength) {
      best = { routeId: t.routeId, branchPointCellKey: t.fromCellKey, strength };
    }
  }

  return best;
}

function computeClusterConfidence(
  cluster: CandidateResidualCluster,
  allCandidateTransitions: TrailTransition[],
): number {
  const clusterTransitions = allCandidateTransitions.filter(
    (t) => cluster.cellKeys.has(t.fromCellKey) && cluster.cellKeys.has(t.toCellKey),
  );

  const maxSessionCount = Math.max(...cluster.cells.map((c) => c.sessionCount), 0);
  if (maxSessionCount === 0) return 0;

  const route = inferCanonicalRouteFromCells(cluster.cells, clusterTransitions, {
    sessionCount: maxSessionCount,
    latestEvidenceAt: cluster.cells[0]?.lastSeenAt ?? null,
  });

  return route.confidence;
}

function computeCrossBranchRatio(
  branchPointCellKey: string,
  routeTransitions: TrailTransition[],
  crossTransitions: CrossTransitionRow[],
): number {
  const internalStrength = routeTransitions
    .filter((t) => t.fromCellKey === branchPointCellKey)
    .reduce((sum, t) => sum + t.sessionCount, 0);

  const crossStrength = crossTransitions
    .filter((t) => t.fromCellKey === branchPointCellKey)
    .reduce((sum, t) => sum + t.sessionCount, 0);

  const total = internalStrength + crossStrength;
  return total === 0 ? 0 : crossStrength / total;
}

function orderedPathFromCells(
  cells: TrailCell[],
  transitions: TrailTransition[],
  sessionCount?: number,
): TrailCell[] {
  if (cells.length === 0) return [];
  const route = inferCanonicalRouteFromCells(cells, transitions, { sessionCount });
  const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const ordered = route.cellKeys
    .map((cellKey) => cellByKey.get(cellKey))
    .filter((cell): cell is TrailCell => cell !== undefined);
  return ordered.length > 0 ? ordered : cells;
}

function makeShortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}
