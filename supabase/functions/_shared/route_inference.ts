import { latLngToCell } from 'npm:h3-js';

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

export const H3_RESOLUTION = 11;
const minCellPointCount = 2;
const minCellSessionCount = 1;
const minTransitionCount = 1;
const minTransitionSessionCount = 1;
const recommendedConfidence = 0.70;
const recommendedSessionCount = 3;
const maxRecommendedBranchAmbiguity = 0.30;
const maxRecommendedRejectedPointRate = 0.30;
const minRecommendedGpsQuality = 0.70;
const minRecommendedRecency = 0.50;

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
  const line = selected.cellKeys
    .map((cellKey) => cellByKey.get(cellKey))
    .filter((cell): cell is CellSupport => cell !== undefined)
    .map((cell) => ({ lat: cell.lat, lon: cell.lon }));

  if (line.length < 2) {
    return routeFromScores({
      cells,
      transitions,
      line: [],
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
export function buildSessionHitmap(
  points: RoutePoint[],
): { cells: TrailCell[]; transitions: TrailTransition[] } {
  if (points.length === 0) {
    return { cells: [], transitions: [] };
  }
  const sessions = groupBySession(points);
  const rawCells = buildCells(sessions);
  const rawTransitions = buildTransitions(sessions);
  return {
    cells: [...rawCells.values()].map(publicCell),
    transitions: [...rawTransitions.values()].map(publicTransition),
  };
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
  const line = selected.cellKeys
    .map((cellKey) => cellByKey.get(cellKey))
    .filter((cell): cell is CellSupport => cell !== undefined)
    .map((cell) => ({ lat: cell.lat, lon: cell.lon }));

  if (line.length < 2) {
    return routeFromScores({
      cells: cells.map(publicCell),
      transitions: transitions.map(publicTransition),
      line: [],
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

function edgeKey(transition: TrailTransition): string {
  return `${transition.fromCellKey}->${transition.toCellKey}`;
}

function firstCellKey(component: Component): string {
  return component.cells
    .map((cell) => cell.cellKey)
    .sort()[0] ?? '';
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
