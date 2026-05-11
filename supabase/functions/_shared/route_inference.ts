import { cellToLatLng, gridDisk, gridPathCells, latLngToCell } from 'npm:h3-js';

export type RoutePoint = {
  sessionId: string;
  recordedAt: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  sequenceIndex: number;
};

export type TrailCell = {
  cellKey: string;
  lat: number;
  lon: number;
  pointCount: number;
  sessionCount: number;
  avgAccuracy: number | null;
  avgAltitude: number | null;
  lastSeenAt: string;
  qualityScore: number;
};

export type TrailTransition = {
  fromCellKey: string;
  toCellKey: string;
  transitionCount: number;
  sessionCount: number;
  edgeCost: number;
};

export type RouteQualityInputs = {
  acceptedPointCount?: number;
  rejectedPointCount?: number;
  latestEvidenceAt?: string | null;
  now?: Date;
  sessionCount?: number;
};

export type CanonicalRoute = {
  cells: TrailCell[];
  transitions: TrailTransition[];
  line: Array<{ lat: number; lon: number }>;
  cellKeys: string[];
  confidence: number;
  confidenceLevel: 'none' | 'reference' | 'recommended';
  sessionCount: number;
  branchAmbiguityScore: number;
  gpsQualityScore: number;
  transitionConsistencyScore: number;
  rejectedPointRate: number;
  recencyScore: number;
};

type CellSupport = TrailCell & {
  sessionIds: Set<string>;
};

type TransitionSupport = TrailTransition & {
  sessionIds: Set<string>;
};

type Component = {
  cells: CellSupport[];
  transitions: TransitionSupport[];
  sessionCount: number;
  score: number;
};

export type RouteMatchMetrics = {
  frechetDistance: number;
  overlapRatio: number;
  score: number;
};

export type RouteFitSplit = {
  routeCells: TrailCell[];
  candidateCells: TrailCell[];
};

export type CandidateResidualCluster = {
  cellKeys: Set<string>;
  sessionCount: number;
  contributingSessions: string[];
  cells: TrailCell[];
  transitions: TrailTransition[];
  clusterWeight: number;
};

export const H3_RESOLUTION = 11;
const minCellPointCount = 2;
const minCellSessionCount = 1;
const minTransitionCount = 1;
const minTransitionSessionCount = 1;
const recommendedConfidence = 0.70;
const recommendedSessionCount = 5;
const maxRecommendedBranchAmbiguity = 0.30;
const maxRecommendedRejectedPointRate = 0.30;
const minRecommendedGpsQuality = 0.70;
const minRecommendedRecency = 0.50;
const neighborSupportWeight = 0.35;
const smoothingClampMeters = 20;

export function inferCanonicalRoute(
  points: RoutePoint[],
  inputs: RouteQualityInputs = {},
): CanonicalRoute {
  if (points.length === 0) {
    return emptyRoute();
  }

  const sessions = groupBySession(points);
  const rawCells = buildCells(sessions);
  const rawTransitions = buildTransitions(sessions);
  const supportedCells = new Map(
    [...rawCells.values()]
      .filter((cell) =>
        cell.pointCount >= minCellPointCount &&
        cell.sessionCount >= minCellSessionCount
      )
      .map((cell) => [cell.cellKey, cell]),
  );
  const supportedTransitions = [...rawTransitions.values()].filter((transition) =>
    supportedCells.has(transition.fromCellKey) &&
    supportedCells.has(transition.toCellKey) &&
    transition.transitionCount >= minTransitionCount &&
    transition.sessionCount >= minTransitionSessionCount
  );

  const cells = pruneIsolatedCells(supportedCells, supportedTransitions);
  const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const transitions = supportedTransitions.filter((transition) =>
    cellByKey.has(transition.fromCellKey) && cellByKey.has(transition.toCellKey)
  );

  const component = selectBestComponent(cells, transitions);
  if (component === null) {
    return routeFromScores({
      cells,
      transitions,
      line: [],
      cellKeys: [],
      confidence: 0,
      confidenceLevel: 'none',
      sessionCount: sessions.size,
      branchAmbiguityScore: 0,
      gpsQualityScore: scoreGpsQuality(cells),
      transitionConsistencyScore: 0,
      rejectedPointRate: rejectedPointRate(points.length, inputs),
      recencyScore: recencyScore(latestEvidenceAt(points, inputs), inputs.now),
    });
  }

  const selected = selectPath(component);
  const pathCells = selected.cellKeys
    .map((cellKey) => cellByKey.get(cellKey))
    .filter((cell): cell is CellSupport => cell !== undefined)
    .map(publicCell);
  const supportMap = new Map(component.cells.map((cell) => [cell.cellKey, publicCell(cell)]));
  const line = smoothCanonicalLine(pathCells, supportMap);

  if (line.length < 2) {
    return routeFromScores({
      cells,
      transitions,
      line: [],
      cellKeys: [],
      confidence: 0,
      confidenceLevel: 'none',
      sessionCount: sessions.size,
      branchAmbiguityScore: 0,
      gpsQualityScore: scoreGpsQuality(cells),
      transitionConsistencyScore: 0,
      rejectedPointRate: rejectedPointRate(points.length, inputs),
      recencyScore: recencyScore(latestEvidenceAt(points, inputs), inputs.now),
    });
  }

  const branchAmbiguityScore = branchAmbiguity(component.transitions);
  const gpsQualityScore = scoreGpsQuality(component.cells);
  const transitionConsistencyScore = transitionConsistency(
    component.transitions,
    selected.edgeKeys,
  );
  const rejectedRate = rejectedPointRate(points.length, inputs);
  const recency = recencyScore(latestEvidenceAt(points, inputs), inputs.now);
  const sessionSupportScore = Math.min(1, component.sessionCount / recommendedSessionCount);
  const confidence = clamp(
    sessionSupportScore * 0.35 +
      gpsQualityScore * 0.20 +
      transitionConsistencyScore * 0.15 +
      (1 - branchAmbiguityScore) * 0.15 +
      (1 - rejectedRate) * 0.10 +
      recency * 0.05,
  );

  return routeFromScores({
    cells: component.cells.map(publicCell),
    transitions: component.transitions.map(publicTransition),
    line,
    cellKeys: selected.cellKeys,
    confidence,
    confidenceLevel: isRecommended({
      confidence,
      sessionCount: component.sessionCount,
      branchAmbiguityScore,
      gpsQualityScore,
      rejectedPointRate: rejectedRate,
      recencyScore: recency,
    })
      ? 'recommended'
      : 'reference',
    sessionCount: component.sessionCount,
    branchAmbiguityScore,
    gpsQualityScore,
    transitionConsistencyScore,
    rejectedPointRate: rejectedRate,
    recencyScore: recency,
  });
}

// Build a single-session hitmap from raw GPS points.
// Returns public types suitable for accumulation into trail_cells / trail_cell_transitions.
// Intermediate H3 cells along each GPS segment are filled via gridPathCells so
// the stored cells represent the full path, not just sampled vertices.
export function buildSessionHitmap(
  points: RoutePoint[],
): { cells: TrailCell[]; transitions: TrailTransition[]; path: TrailCell[] } {
  if (points.length === 0) {
    return { cells: [], transitions: [], path: [] };
  }
  const expanded = expandWithGridPath(points);
  const sessions = groupBySession(expanded);
  const rawCells = buildCells(sessions);
  const rawTransitions = buildTransitions(sessions);
  const cells = [...rawCells.values()].map(publicCell);
  const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  return {
    cells,
    transitions: [...rawTransitions.values()].map(publicTransition),
    path: buildOrderedCellPath(expanded, cellByKey),
  };
}

// Inserts virtual RoutePoints for every H3 cell between consecutive GPS samples.
// This ensures the hitmap covers the full traversed path, not just measured vertices.
function expandWithGridPath(points: RoutePoint[]): RoutePoint[] {
  const bySession = new Map<string, RoutePoint[]>();
  for (const pt of points) {
    const list = bySession.get(pt.sessionId) ?? [];
    list.push(pt);
    bySession.set(pt.sessionId, list);
  }

  const result: RoutePoint[] = [];
  for (const sessionPoints of bySession.values()) {
    const ordered = [...sessionPoints].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    for (let i = 0; i < ordered.length; i++) {
      result.push(ordered[i]);
      if (i === ordered.length - 1) continue;

      const cur = ordered[i];
      const next = ordered[i + 1];
      const fromKey = pointToCellKey(cur.lat, cur.lon);
      const toKey = pointToCellKey(next.lat, next.lon);
      if (fromKey === toKey) continue;

      try {
        const path = gridPathCells(fromKey, toKey);
        // Intermediate cells only (first = fromKey, last = toKey — already recorded)
        for (let j = 1; j < path.length - 1; j++) {
          const t = j / (path.length - 1);
          const [lat, lon] = cellToLatLng(path[j]);
          result.push({
            sessionId: cur.sessionId,
            recordedAt: cur.recordedAt,
            lat,
            lon,
            accuracy: cur.accuracy,
            altitude:
              cur.altitude !== null && next.altitude !== null
                ? cur.altitude + (next.altitude - cur.altitude) * t
                : cur.altitude,
            sequenceIndex: cur.sequenceIndex + t,
          });
        }
      } catch {
        // gridPathCells fails for very distant cells (different H3 base cells); skip
      }
    }
  }
  return result;
}

// Infer a canonical route from pre-accumulated cells and transitions (e.g. from trail_cells DB table).
// Use inputs.sessionCount for accurate session count when available;
// otherwise falls back to the max sessionCount observed across cells.
export function inferCanonicalRouteFromCells(
  rawCells: TrailCell[],
  rawTransitions: TrailTransition[],
  inputs: RouteQualityInputs = {},
): CanonicalRoute {
  if (rawCells.length === 0) {
    return emptyRoute();
  }

  const supportedCells = new Map(
    rawCells
      .filter((cell) =>
        cell.pointCount >= minCellPointCount &&
        cell.sessionCount >= minCellSessionCount
      )
      .map((cell) => [cell.cellKey, cellToSupport(cell)]),
  );
  const supportedTransitions = rawTransitions
    .filter((transition) =>
      supportedCells.has(transition.fromCellKey) &&
      supportedCells.has(transition.toCellKey) &&
      transition.transitionCount >= minTransitionCount &&
      transition.sessionCount >= minTransitionSessionCount
    )
    .map(transitionToSupport);

  const cells = pruneIsolatedCells(supportedCells, supportedTransitions);
  const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const transitions = supportedTransitions.filter((transition) =>
    cellByKey.has(transition.fromCellKey) && cellByKey.has(transition.toCellKey)
  );

  // Session count: prefer explicit override (from session_route_assignments count),
  // fall back to the max cell session count as a conservative estimate.
  const resolvedSessionCount = inputs.sessionCount ??
    Math.max(0, ...cells.map((c) => c.sessionCount));
  const totalPointCount = sum(cells.map((c) => c.pointCount));
  const latestAt = latestCellAt(rawCells);

  const component = selectBestComponent(cells, transitions);
  if (component === null) {
    return routeFromScores({
      cells: cells.map(publicCell),
      transitions: transitions.map(publicTransition),
      line: [],
      cellKeys: [],
      confidence: 0,
      confidenceLevel: 'none',
      sessionCount: resolvedSessionCount,
      branchAmbiguityScore: 0,
      gpsQualityScore: scoreGpsQuality(cells),
      transitionConsistencyScore: 0,
      rejectedPointRate: rejectedPointRate(totalPointCount, inputs),
      recencyScore: recencyScore(latestAt, inputs.now),
    });
  }

  const selected = selectPath(component);
  const pathCells = selected.cellKeys
    .map((cellKey) => cellByKey.get(cellKey))
    .filter((cell): cell is CellSupport => cell !== undefined)
    .map(publicCell);
  const supportMap = new Map(component.cells.map((cell) => [cell.cellKey, publicCell(cell)]));
  const line = smoothCanonicalLine(pathCells, supportMap);

  if (line.length < 2) {
    return routeFromScores({
      cells: cells.map(publicCell),
      transitions: transitions.map(publicTransition),
      line: [],
      cellKeys: [],
      confidence: 0,
      confidenceLevel: 'none',
      sessionCount: resolvedSessionCount,
      branchAmbiguityScore: 0,
      gpsQualityScore: scoreGpsQuality(cells),
      transitionConsistencyScore: 0,
      rejectedPointRate: rejectedPointRate(totalPointCount, inputs),
      recencyScore: recencyScore(latestAt, inputs.now),
    });
  }

  const branchAmbiguityScore = branchAmbiguity(component.transitions);
  const gpsQualityScore = scoreGpsQuality(component.cells);
  const transitionConsistencyScore = transitionConsistency(
    component.transitions,
    selected.edgeKeys,
  );
  const rejectedRate = rejectedPointRate(totalPointCount, inputs);
  const recency = recencyScore(latestAt, inputs.now);
  const sessionSupportScore = Math.min(1, resolvedSessionCount / recommendedSessionCount);
  const confidence = clamp(
    sessionSupportScore * 0.35 +
      gpsQualityScore * 0.20 +
      transitionConsistencyScore * 0.15 +
      (1 - branchAmbiguityScore) * 0.15 +
      (1 - rejectedRate) * 0.10 +
      recency * 0.05,
  );

  return routeFromScores({
    cells: component.cells.map(publicCell),
    transitions: component.transitions.map(publicTransition),
    line,
    cellKeys: selected.cellKeys,
    confidence,
    confidenceLevel: isRecommended({
      confidence,
      sessionCount: resolvedSessionCount,
      branchAmbiguityScore,
      gpsQualityScore,
      rejectedPointRate: rejectedRate,
      recencyScore: recency,
    })
      ? 'recommended'
      : 'reference',
    sessionCount: resolvedSessionCount,
    branchAmbiguityScore,
    gpsQualityScore,
    transitionConsistencyScore,
    rejectedPointRate: rejectedRate,
    recencyScore: recency,
  });
}

export function lineStringWkt(line: Array<{ lat: number; lon: number }>): string | null {
  if (line.length < 2) {
    return null;
  }
  return `LINESTRING(${line.map((point) => `${point.lon} ${point.lat}`).join(',')})`;
}

export function weightedDiscreteFrechet(
  sessionPath: TrailCell[],
  routePath: TrailCell[],
  supportMap: Map<string, TrailCell> = new Map(),
): RouteMatchMetrics {
  if (sessionPath.length === 0 || routePath.length === 0) {
    return { frechetDistance: Number.POSITIVE_INFINITY, overlapRatio: 0, score: Number.POSITIVE_INFINITY };
  }

  const cache: number[][] = Array.from(
    { length: sessionPath.length },
    () => Array(routePath.length).fill(Number.NaN),
  );

  const distanceAt = (i: number, j: number): number => {
    const routeCell = routePath[j];
    const support = supportStrengthForCell(supportMap.get(routeCell.cellKey) ?? routeCell);
    const supportDiscount = 1 + Math.min(0.35, Math.log1p(support) / 20);
    return haversineMeters(
      sessionPath[i].lat,
      sessionPath[i].lon,
      routeCell.lat,
      routeCell.lon,
    ) / supportDiscount;
  };

  const walk = (i: number, j: number): number => {
    if (Number.isFinite(cache[i][j])) return cache[i][j];
    const current = distanceAt(i, j);
    if (i === 0 && j === 0) {
      cache[i][j] = current;
    } else if (i > 0 && j === 0) {
      cache[i][j] = Math.max(walk(i - 1, 0), current);
    } else if (i === 0 && j > 0) {
      cache[i][j] = Math.max(walk(0, j - 1), current);
    } else {
      cache[i][j] = Math.max(
        Math.min(walk(i - 1, j), walk(i - 1, j - 1), walk(i, j - 1)),
        current,
      );
    }
    return cache[i][j];
  };

  const frechetDistance = walk(sessionPath.length - 1, routePath.length - 1);
  const routeKeys = new Set(routePath.map((cell) => cell.cellKey));
  const overlapCount = sessionPath.filter((cell) => routeKeys.has(cell.cellKey)).length;
  const overlapRatio = overlapCount / Math.max(1, sessionPath.length);

  return {
    frechetDistance,
    overlapRatio,
    score: frechetDistance - overlapRatio * 20,
  };
}

export function splitSessionByRouteFit(
  sessionPath: TrailCell[],
  routePath: TrailCell[],
  pathMatchAccepted: boolean,
  routeDistanceMeters = 45,
): RouteFitSplit {
  const routeKeys = new Set(routePath.map((cell) => cell.cellKey));
  const routeCells: TrailCell[] = [];
  const candidateCells: TrailCell[] = [];

  for (const cell of sessionPath) {
    if (routeKeys.has(cell.cellKey)) {
      routeCells.push(cell);
      continue;
    }
    if (pathMatchAccepted && nearestDistanceMeters(cell, routePath) <= routeDistanceMeters) {
      routeCells.push(cell);
      continue;
    }
    candidateCells.push(cell);
  }

  return { routeCells, candidateCells };
}

export function smoothCanonicalLine(
  cellPath: TrailCell[],
  supportMap: Map<string, TrailCell> = new Map(cellPath.map((cell) => [cell.cellKey, cell])),
): Array<{ lat: number; lon: number }> {
  if (cellPath.length < 2) {
    return cellPath.map((cell) => ({ lat: cell.lat, lon: cell.lon }));
  }

  const weighted = cellPath.map((cell) => {
    let latSum = cell.lat * supportStrengthForCell(cell);
    let lonSum = cell.lon * supportStrengthForCell(cell);
    let weightSum = supportStrengthForCell(cell);

    for (const neighborKey of gridDisk(cell.cellKey, 1)) {
      if (neighborKey === cell.cellKey) continue;
      const neighbor = supportMap.get(neighborKey);
      if (!neighbor) continue;
      const weight = supportStrengthForCell(neighbor) * neighborSupportWeight;
      latSum += neighbor.lat * weight;
      lonSum += neighbor.lon * weight;
      weightSum += weight;
    }

    const target = {
      lat: latSum / Math.max(1, weightSum),
      lon: lonSum / Math.max(1, weightSum),
    };
    return clampPointShift(cell, target, smoothingClampMeters);
  });

  return chaikinOnce(weighted);
}

export function clusterCandidateResiduals(
  cells: TrailCell[],
  transitions: TrailTransition[],
  options: { minClusterSessionCount?: number; minClusterCellCount?: number } = {},
): CandidateResidualCluster[] {
  const minClusterSessionCount = options.minClusterSessionCount ?? 2;
  const minClusterCellCount = options.minClusterCellCount ?? 3;
  if (cells.length === 0) return [];

  const cellMap = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const visited = new Set<string>();
  const clusters: CandidateResidualCluster[] = [];

  for (const cell of cells) {
    if (visited.has(cell.cellKey)) continue;
    const queue = [cell.cellKey];
    const keys = new Set<string>();

    while (queue.length > 0) {
      const key = queue.pop()!;
      if (visited.has(key)) continue;
      visited.add(key);
      keys.add(key);
      for (const neighbor of gridDisk(key, 1)) {
        if (neighbor !== key && cellMap.has(neighbor) && !visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
      for (const transition of transitions) {
        if (transition.fromCellKey === key && cellMap.has(transition.toCellKey) && !visited.has(transition.toCellKey)) {
          queue.push(transition.toCellKey);
        }
        if (transition.toCellKey === key && cellMap.has(transition.fromCellKey) && !visited.has(transition.fromCellKey)) {
          queue.push(transition.fromCellKey);
        }
      }
    }

    const clusterCells = [...keys]
      .map((key) => cellMap.get(key))
      .filter((value): value is TrailCell => value !== undefined);
    const contributingSessions = dedupeStrings(
      clusterCells.flatMap((clusterCell) => (clusterCell as any).contributingSessions ?? []),
    );
    const sessionCount = Math.max(
      contributingSessions.length,
      ...clusterCells.map((clusterCell) => clusterCell.sessionCount),
      0,
    );
    if (clusterCells.length < minClusterCellCount || sessionCount < minClusterSessionCount) {
      continue;
    }

    const clusterTransitions = transitions.filter((transition) =>
      keys.has(transition.fromCellKey) && keys.has(transition.toCellKey)
    );
    const clusterWeight = sum(clusterCells.map((clusterCell) => clusterCell.pointCount)) +
      2 * sessionCount;

    clusters.push({
      cellKeys: keys,
      sessionCount,
      contributingSessions,
      cells: clusterCells,
      transitions: clusterTransitions,
      clusterWeight,
    });
  }

  return clusters;
}

export function pointToCellKey(lat: number, lon: number): string {
  return latLngToCell(lat, lon, H3_RESOLUTION);
}

function buildCells(sessions: Map<string, RoutePoint[]>): Map<string, CellSupport> {
  const cellStats = new Map<string, {
    latSum: number;
    lonSum: number;
    pointCount: number;
    sessions: Set<string>;
    accuracySum: number;
    accuracyCount: number;
    altitudeSum: number;
    altitudeCount: number;
    lastSeenAt: string;
  }>();

  for (const [sessionId, sessionPoints] of sessions) {
    for (const point of sessionPoints) {
      const cellKey = pointToCellKey(point.lat, point.lon);
      const stats = cellStats.get(cellKey) ?? {
        latSum: 0,
        lonSum: 0,
        pointCount: 0,
        sessions: new Set<string>(),
        accuracySum: 0,
        accuracyCount: 0,
        altitudeSum: 0,
        altitudeCount: 0,
        lastSeenAt: point.recordedAt,
      };
      stats.latSum += point.lat;
      stats.lonSum += point.lon;
      stats.pointCount += 1;
      stats.sessions.add(sessionId);
      if (point.accuracy !== null) {
        stats.accuracySum += point.accuracy;
        stats.accuracyCount += 1;
      }
      if (point.altitude !== null) {
        stats.altitudeSum += point.altitude;
        stats.altitudeCount += 1;
      }
      if (Date.parse(point.recordedAt) > Date.parse(stats.lastSeenAt)) {
        stats.lastSeenAt = point.recordedAt;
      }
      cellStats.set(cellKey, stats);
    }
  }

  return new Map([...cellStats.entries()].map(([cellKey, stats]) => {
    const avgAccuracy = stats.accuracyCount === 0
      ? null
      : stats.accuracySum / stats.accuracyCount;
    return [cellKey, {
      cellKey,
      lat: stats.latSum / stats.pointCount,
      lon: stats.lonSum / stats.pointCount,
      pointCount: stats.pointCount,
      sessionCount: stats.sessions.size,
      avgAccuracy,
      avgAltitude: stats.altitudeCount === 0
        ? null
        : stats.altitudeSum / stats.altitudeCount,
      lastSeenAt: stats.lastSeenAt,
      qualityScore: qualityScore(avgAccuracy),
      sessionIds: stats.sessions,
    }];
  }));
}

function buildTransitions(sessions: Map<string, RoutePoint[]>): Map<string, TransitionSupport> {
  const transitionStats = new Map<string, {
    fromCellKey: string;
    toCellKey: string;
    transitionCount: number;
    sessions: Set<string>;
  }>();

  for (const [sessionId, sessionPoints] of sessions) {
    const ordered = [...sessionPoints].sort((left, right) =>
      left.sequenceIndex - right.sequenceIndex
    );
    let previousCell: string | null = null;
    for (const point of ordered) {
      const cellKey = pointToCellKey(point.lat, point.lon);
      if (previousCell !== null && previousCell !== cellKey) {
        const transitionKey = `${previousCell}->${cellKey}`;
        const transition = transitionStats.get(transitionKey) ?? {
          fromCellKey: previousCell,
          toCellKey: cellKey,
          transitionCount: 0,
          sessions: new Set<string>(),
        };
        transition.transitionCount += 1;
        transition.sessions.add(sessionId);
        transitionStats.set(transitionKey, transition);
      }
      previousCell = cellKey;
    }
  }

  return new Map([...transitionStats.entries()].map(([key, transition]) => [
    key,
    {
      fromCellKey: transition.fromCellKey,
      toCellKey: transition.toCellKey,
      transitionCount: transition.transitionCount,
      sessionCount: transition.sessions.size,
      edgeCost: 1 / Math.max(1, transition.transitionCount),
      sessionIds: transition.sessions,
    },
  ]));
}

function groupBySession(points: RoutePoint[]): Map<string, RoutePoint[]> {
  const sessions = new Map<string, RoutePoint[]>();
  for (const point of points) {
    const existing = sessions.get(point.sessionId) ?? [];
    existing.push(point);
    sessions.set(point.sessionId, existing);
  }
  return sessions;
}

function buildOrderedCellPath(
  points: RoutePoint[],
  cellByKey: Map<string, TrailCell>,
): TrailCell[] {
  const ordered = [...points].sort((left, right) =>
    left.sessionId.localeCompare(right.sessionId) ||
    left.sequenceIndex - right.sequenceIndex
  );
  const path: TrailCell[] = [];
  let previousKey: string | null = null;
  for (const point of ordered) {
    const key = pointToCellKey(point.lat, point.lon);
    if (key === previousKey) continue;
    const cell = cellByKey.get(key);
    if (cell) path.push(cell);
    previousKey = key;
  }
  return path;
}

// Adapt a public TrailCell (no sessionIds) to CellSupport for use in the path algorithm.
// Uses a dummy placeholder session ID so selectBestComponent produces a non-zero session count;
// the caller is responsible for using resolvedSessionCount from inputs rather than component.sessionCount.
function cellToSupport(cell: TrailCell): CellSupport {
  return { ...cell, sessionIds: new Set(['__accumulated__']) };
}

function transitionToSupport(transition: TrailTransition): TransitionSupport {
  return { ...transition, sessionIds: new Set(['__accumulated__']) };
}

function latestCellAt(cells: TrailCell[]): string | null {
  return cells
    .map((c) => c.lastSeenAt)
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function pruneIsolatedCells(
  cells: Map<string, CellSupport>,
  transitions: TransitionSupport[],
): CellSupport[] {
  if (transitions.length < 2) {
    return [...cells.values()];
  }

  const usedCellKeys = new Set<string>();
  for (const transition of transitions) {
    usedCellKeys.add(transition.fromCellKey);
    usedCellKeys.add(transition.toCellKey);
  }
  return [...cells.values()].filter((cell) => usedCellKeys.has(cell.cellKey));
}

function selectBestComponent(
  cells: CellSupport[],
  transitions: TransitionSupport[],
): Component | null {
  if (transitions.length === 0) {
    return null;
  }

  const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  const adjacency = new Map<string, Set<string>>();
  for (const transition of transitions) {
    addAdjacent(adjacency, transition.fromCellKey, transition.toCellKey);
    addAdjacent(adjacency, transition.toCellKey, transition.fromCellKey);
  }

  const visited = new Set<string>();
  const components: Component[] = [];
  for (const cellKey of adjacency.keys()) {
    if (visited.has(cellKey)) {
      continue;
    }

    const queue = [cellKey];
    const componentCellKeys = new Set<string>();
    visited.add(cellKey);
    while (queue.length > 0) {
      const current = queue.shift() as string;
      componentCellKeys.add(current);
      for (const next of adjacency.get(current) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }

    const componentCells = [...componentCellKeys]
      .map((key) => cellByKey.get(key))
      .filter((cell): cell is CellSupport => cell !== undefined);
    const componentTransitions = transitions.filter((transition) =>
      componentCellKeys.has(transition.fromCellKey) &&
      componentCellKeys.has(transition.toCellKey)
    );
    const sessions = new Set<string>();
    for (const cell of componentCells) {
      for (const sessionId of cell.sessionIds) {
        sessions.add(sessionId);
      }
    }

    components.push({
      cells: componentCells,
      transitions: componentTransitions,
      sessionCount: sessions.size,
      score:
        sum(componentTransitions.map((transition) => transition.sessionCount)) +
        sum(componentCells.map((cell) => cell.pointCount)) * 0.25 +
        sessions.size * 0.5,
    });
  }

  return components.sort((left, right) =>
    right.score - left.score ||
    right.sessionCount - left.sessionCount ||
    right.cells.length - left.cells.length ||
    firstCellKey(left).localeCompare(firstCellKey(right))
  )[0] ?? null;
}

function selectPath(component: Component): { cellKeys: string[]; edgeKeys: Set<string> } {
  const startEdge = [...component.transitions].sort(compareTransitionStrength)[0];
  if (!startEdge) {
    return { cellKeys: [], edgeKeys: new Set<string>() };
  }

  const path = [startEdge.fromCellKey, startEdge.toCellKey];
  const usedEdges = new Set([edgeKey(startEdge)]);
  extendPathStart(path, usedEdges, component.transitions);
  extendPathEnd(path, usedEdges, component.transitions);

  return { cellKeys: path, edgeKeys: usedEdges };
}

function extendPathStart(
  path: string[],
  usedEdges: Set<string>,
  transitions: TransitionSupport[],
): void {
  while (true) {
    const current = path[0];
    const next = bestUnusedAdjacentEdge(current, usedEdges, transitions);
    if (!next) {
      return;
    }
    usedEdges.add(edgeKey(next));
    path.unshift(next.fromCellKey === current ? next.toCellKey : next.fromCellKey);
  }
}

function extendPathEnd(
  path: string[],
  usedEdges: Set<string>,
  transitions: TransitionSupport[],
): void {
  while (true) {
    const current = path[path.length - 1];
    const next = bestUnusedAdjacentEdge(current, usedEdges, transitions);
    if (!next) {
      return;
    }
    usedEdges.add(edgeKey(next));
    path.push(next.fromCellKey === current ? next.toCellKey : next.fromCellKey);
  }
}

function bestUnusedAdjacentEdge(
  cellKey: string,
  usedEdges: Set<string>,
  transitions: TransitionSupport[],
): TransitionSupport | undefined {
  return transitions
    .filter((transition) =>
      !usedEdges.has(edgeKey(transition)) &&
      (transition.fromCellKey === cellKey || transition.toCellKey === cellKey)
    )
    .sort((left, right) => edgeScore(right) - edgeScore(left))[0];
}

function branchAmbiguity(transitions: TransitionSupport[]): number {
  const outgoing = new Map<string, TransitionSupport[]>();
  for (const transition of transitions) {
    const list = outgoing.get(transition.fromCellKey) ?? [];
    list.push(transition);
    outgoing.set(transition.fromCellKey, list);
  }

  const ratios = [...outgoing.values()]
    .filter((list) => list.length > 1)
    .map((list) => {
      const sorted = [...list].sort(compareTransitionStrength);
      return supportStrength(sorted[1]) / Math.max(1, supportStrength(sorted[0]));
    });
  return ratios.length === 0 ? 0 : clamp(average(ratios));
}

function transitionConsistency(
  transitions: TransitionSupport[],
  selectedEdgeKeys: Set<string>,
): number {
  const allSupport = sum(transitions.map((transition) => transition.sessionCount));
  const selectedSupport = sum(
    transitions
      .filter((transition) => selectedEdgeKeys.has(edgeKey(transition)))
      .map((transition) => transition.sessionCount),
  );
  return clamp(selectedSupport / Math.max(1, allSupport));
}

function scoreGpsQuality(cells: Array<{ qualityScore: number }>): number {
  return cells.length === 0 ? 0 : average(cells.map((cell) => cell.qualityScore));
}

function rejectedPointRate(
  inferredAcceptedCount: number,
  inputs: RouteQualityInputs,
): number {
  const accepted = inputs.acceptedPointCount ?? inferredAcceptedCount;
  const rejected = inputs.rejectedPointCount ?? 0;
  return clamp(rejected / Math.max(1, accepted + rejected));
}

function isRecommended(route: {
  confidence: number;
  sessionCount: number;
  branchAmbiguityScore: number;
  gpsQualityScore: number;
  rejectedPointRate: number;
  recencyScore: number;
}): boolean {
  return route.confidence >= recommendedConfidence &&
    route.sessionCount >= recommendedSessionCount &&
    route.branchAmbiguityScore <= maxRecommendedBranchAmbiguity &&
    route.gpsQualityScore >= minRecommendedGpsQuality &&
    route.rejectedPointRate <= maxRecommendedRejectedPointRate &&
    route.recencyScore >= minRecommendedRecency;
}

function latestEvidenceAt(points: RoutePoint[], inputs: RouteQualityInputs): string | null {
  if (inputs.latestEvidenceAt !== undefined) {
    return inputs.latestEvidenceAt;
  }
  return points
    .map((point) => point.recordedAt)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
}

function recencyScore(latestAt: string | null, now = new Date()): number {
  if (latestAt === null) {
    return 0;
  }
  const ageMs = now.getTime() - Date.parse(latestAt);
  if (!Number.isFinite(ageMs)) {
    return 0;
  }
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  if (ageDays <= 30) {
    return 1;
  }
  if (ageDays <= 90) {
    return 0.5;
  }
  return 0.2;
}

function qualityScore(accuracy: number | null): number {
  if (accuracy === null) {
    return 0.75;
  }
  return clamp(1 - accuracy / 100);
}

function addAdjacent(adjacency: Map<string, Set<string>>, from: string, to: string): void {
  const next = adjacency.get(from) ?? new Set<string>();
  next.add(to);
  adjacency.set(from, next);
}

function publicCell(cell: CellSupport): TrailCell {
  const { sessionIds: _, ...publicValue } = cell;
  return publicValue;
}

function publicTransition(transition: TransitionSupport): TrailTransition {
  const { sessionIds: _, ...publicValue } = transition;
  return publicValue;
}

function routeFromScores(route: CanonicalRoute): CanonicalRoute {
  return route;
}

function compareTransitionStrength(left: TrailTransition, right: TrailTransition): number {
  return (
    supportStrength(right) - supportStrength(left) ||
    left.edgeCost - right.edgeCost ||
    left.fromCellKey.localeCompare(right.fromCellKey) ||
    left.toCellKey.localeCompare(right.toCellKey)
  );
}

function edgeScore(transition: TrailTransition): number {
  return transition.sessionCount * 10 + transition.transitionCount * 3 - transition.edgeCost;
}

function supportStrength(transition: TrailTransition): number {
  return transition.sessionCount * 10 + transition.transitionCount;
}

function supportStrengthForCell(cell: TrailCell): number {
  return Math.max(1, cell.pointCount * Math.max(1, cell.sessionCount));
}

function nearestDistanceMeters(cell: TrailCell, path: TrailCell[]): number {
  return Math.min(
    Number.POSITIVE_INFINITY,
    ...path.map((candidate) =>
      haversineMeters(cell.lat, cell.lon, candidate.lat, candidate.lon)
    ),
  );
}

function clampPointShift(
  origin: { lat: number; lon: number },
  target: { lat: number; lon: number },
  maxMeters: number,
): { lat: number; lon: number } {
  const distance = haversineMeters(origin.lat, origin.lon, target.lat, target.lon);
  if (distance <= maxMeters || distance === 0) return target;
  const ratio = maxMeters / distance;
  return {
    lat: origin.lat + (target.lat - origin.lat) * ratio,
    lon: origin.lon + (target.lon - origin.lon) * ratio,
  };
}

function chaikinOnce(points: Array<{ lat: number; lon: number }>): Array<{ lat: number; lon: number }> {
  if (points.length < 3) return points;
  const smoothed: Array<{ lat: number; lon: number }> = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    smoothed.push({
      lat: current.lat * 0.75 + next.lat * 0.25,
      lon: current.lon * 0.75 + next.lon * 0.25,
    });
    smoothed.push({
      lat: current.lat * 0.25 + next.lat * 0.75,
      lon: current.lon * 0.25 + next.lon * 0.75,
    });
  }
  smoothed.push(points[points.length - 1]);
  return smoothed;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function edgeKey(transition: TrailTransition): string {
  return `${transition.fromCellKey}->${transition.toCellKey}`;
}

function firstCellKey(component: Component): string {
  return component.cells
    .map((cell) => cell.cellKey)
    .sort()[0] ?? '';
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function emptyRoute(): CanonicalRoute {
  return {
    cells: [],
    transitions: [],
    line: [],
    cellKeys: [],
    confidence: 0,
    confidenceLevel: 'none',
    sessionCount: 0,
    branchAmbiguityScore: 0,
    gpsQualityScore: 0,
    transitionConsistencyScore: 0,
    rejectedPointRate: 0,
    recencyScore: 0,
  };
}
