import { gridDisk } from 'npm:h3-js';

import {
  inferCanonicalRouteFromCells,
  type TrailCell,
  type TrailTransition,
} from './route_inference.ts';

// ── Constants ─────────────────────────────────────────────────────────────────

const minCfgConfidence = 0.50;
const minCrossBranchRatio = 0.30;
const minClusterSessionCount = 2;
const minSegmentCells = 3;

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
  affectedSessions: string[];
  valid: boolean;
  invalidReason?: string;
};

// ── Internal cluster type ─────────────────────────────────────────────────────

type CandidateCluster = {
  cellKeys: Set<string>;
  sessionCount: number;
  contributingSessions: string[];
  cells: TrailCell[];
  transitions: TrailTransition[];
};

// ── Main exported functions ───────────────────────────────────────────────────

export function detectBranchCandidates(ctx: MountainCtx): BranchCandidate[] {
  if (ctx.candidateCells.length === 0 || ctx.crossTransitions.length === 0) {
    return [];
  }

  const clusters = findCandidateClusters(ctx.candidateCells, ctx.candidateTransitions);
  const results: BranchCandidate[] = [];

  for (const cluster of clusters) {
    if (cluster.sessionCount < minClusterSessionCount) continue;

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

    if (
      cfgConfidence >= minCfgConfidence &&
      crossBranchRatio >= minCrossBranchRatio
    ) {
      results.push({
        originalRouteId: routeId,
        branchPointCellKey,
        clusterCellKeys: cluster.cellKeys,
        clusterSessionCount: cluster.sessionCount,
        cfgConfidence,
        crossBranchRatio,
        contributingSessions: cluster.contributingSessions,
      });
    }

    // Unused variable warning suppression — routeCellsForRoute is available
    void routeCellsForRoute;
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
    affectedSessions: contributingSessions,
    valid: false,
    invalidReason: reason,
  });

  if (routeCells.length === 0) return invalid('route_has_no_cells');

  // Derive ordered path from inferCanonicalRouteFromCells
  const route = inferCanonicalRouteFromCells(routeCells, routeTransitions);
  if (route.line.length < 2) return invalid('route_has_no_valid_path');

  // Map lat/lon → cellKey using route cells
  const cellByLatLon = new Map<string, string>();
  for (const cell of routeCells) {
    cellByLatLon.set(latLonKey(cell.lat, cell.lon), cell.cellKey);
  }

  const orderedCellKeys: string[] = [];
  for (const point of route.line) {
    const key = cellByLatLon.get(latLonKey(point.lat, point.lon));
    if (key) orderedCellKeys.push(key);
  }

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
    affectedSessions: contributingSessions,
    valid: true,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function findCandidateClusters(
  cells: TrailCell[],
  transitions: TrailTransition[],
): CandidateCluster[] {
  if (cells.length === 0) return [];

  const cellMap = new Map(cells.map((c) => [c.cellKey, c]));
  const adjacency = new Map<string, Set<string>>();

  for (const cell of cells) {
    if (!adjacency.has(cell.cellKey)) adjacency.set(cell.cellKey, new Set());
  }

  // Connect via actual transitions
  for (const t of transitions) {
    if (cellMap.has(t.fromCellKey) && cellMap.has(t.toCellKey)) {
      adjacency.get(t.fromCellKey)!.add(t.toCellKey);
      adjacency.get(t.toCellKey)!.add(t.fromCellKey);
    }
  }

  // Connect via H3 adjacency (gridDisk radius 1)
  for (const cell of cells) {
    const neighbors = gridDisk(cell.cellKey, 1).filter(
      (n: string) => n !== cell.cellKey && cellMap.has(n),
    );
    for (const neighbor of neighbors) {
      adjacency.get(cell.cellKey)!.add(neighbor);
      adjacency.get(neighbor)!.add(cell.cellKey);
    }
  }

  // BFS connected components
  const visited = new Set<string>();
  const clusters: CandidateCluster[] = [];

  for (const cell of cells) {
    if (visited.has(cell.cellKey)) continue;

    const clusterKeys = new Set<string>();
    const queue: string[] = [cell.cellKey];

    while (queue.length > 0) {
      const key = queue.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      clusterKeys.add(key);
      for (const neighbor of adjacency.get(key) ?? []) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }

    const clusterCells = [...clusterKeys]
      .map((k) => cellMap.get(k)!)
      .filter(Boolean);

    const sessionCount = Math.max(...clusterCells.map((c) => c.sessionCount), 0);
    const contributingSessions = dedupeUuids(
      clusterCells.flatMap((c) => (c as any).contributingSessions ?? []),
    );

    const clusterTransitions = transitions.filter(
      (t) => clusterKeys.has(t.fromCellKey) && clusterKeys.has(t.toCellKey),
    );

    clusters.push({
      cellKeys: clusterKeys,
      sessionCount,
      contributingSessions,
      cells: clusterCells,
      transitions: clusterTransitions,
    });
  }

  return clusters;
}

type ClusterConnection = { routeId: string; branchPointCellKey: string; strength: number };

function findStrongestCrossConnection(
  cluster: CandidateCluster,
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
  cluster: CandidateCluster,
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

function latLonKey(lat: number, lon: number): string {
  return `${lat.toFixed(8)},${lon.toFixed(8)}`;
}

function makeShortHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

function dedupeUuids(uuids: string[]): string[] {
  return [...new Set(uuids)];
}
