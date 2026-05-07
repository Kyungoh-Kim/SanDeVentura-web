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

export type CanonicalRoute = {
  cells: TrailCell[];
  transitions: TrailTransition[];
  line: Array<{ lat: number; lon: number }>;
  confidence: number;
  confidenceLevel: 'none' | 'reference' | 'recommended';
  sessionCount: number;
  branchAmbiguityScore: number;
  gpsQualityScore: number;
};

const cellSizeDegrees = 0.00025;

export function inferCanonicalRoute(points: RoutePoint[]): CanonicalRoute {
  if (points.length === 0) {
    return emptyRoute();
  }

  const sessions = groupBySession(points);
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

  const cells = [...cellStats.entries()].map(([cellKey, stats]) => {
    const avgAccuracy = stats.accuracyCount === 0
      ? null
      : stats.accuracySum / stats.accuracyCount;
    return {
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
    };
  });

  const transitions = [...transitionStats.values()].map((transition) => ({
    fromCellKey: transition.fromCellKey,
    toCellKey: transition.toCellKey,
    transitionCount: transition.transitionCount,
    sessionCount: transition.sessions.size,
    edgeCost: 1 / Math.max(1, transition.transitionCount),
  }));

  const sessionCount = sessions.size;
  const line = strongestLine(cells, transitions);
  const branchAmbiguityScore = branchAmbiguity(transitions);
  const gpsQualityScore = cells.length === 0
    ? 0
    : average(cells.map((cell) => cell.qualityScore));
  const supportScore = Math.min(1, sessionCount / 3);
  const lengthScore = Math.min(1, line.length / 5);
  const confidence = clamp(
    supportScore * 0.45 +
      gpsQualityScore * 0.35 +
      (1 - branchAmbiguityScore) * 0.15 +
      lengthScore * 0.05,
  );

  return {
    cells,
    transitions,
    line,
    confidence,
    confidenceLevel: confidence >= 0.70 ? 'recommended' : 'reference',
    sessionCount,
    branchAmbiguityScore,
    gpsQualityScore,
  };
}

export function lineStringWkt(line: Array<{ lat: number; lon: number }>): string | null {
  if (line.length < 2) {
    return null;
  }
  return `LINESTRING(${line.map((point) => `${point.lon} ${point.lat}`).join(',')})`;
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

function pointToCellKey(lat: number, lon: number): string {
  return `${Math.round(lat / cellSizeDegrees)}:${Math.round(lon / cellSizeDegrees)}`;
}

function strongestLine(cells: TrailCell[], transitions: TrailTransition[]): Array<{ lat: number; lon: number }> {
  const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
  if (transitions.length === 0) {
    return cells
      .sort((left, right) => right.pointCount - left.pointCount)
      .slice(0, 1)
      .map((cell) => ({ lat: cell.lat, lon: cell.lon }));
  }

  const outgoing = new Map<string, TrailTransition[]>();
  const incoming = new Set<string>();
  for (const transition of transitions) {
    const list = outgoing.get(transition.fromCellKey) ?? [];
    list.push(transition);
    outgoing.set(transition.fromCellKey, list);
    incoming.add(transition.toCellKey);
  }

  const starts = [...outgoing.keys()].filter((cellKey) => !incoming.has(cellKey));
  const start = (starts[0] ?? [...outgoing.keys()][0]) as string;
  const visited = new Set<string>();
  const line: Array<{ lat: number; lon: number }> = [];
  let current: string | undefined = start;

  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const cell = cellByKey.get(current);
    if (cell) {
      line.push({ lat: cell.lat, lon: cell.lon });
    }
    const next: TrailTransition | undefined = (outgoing.get(current) ?? [])
      .sort((left, right) =>
        right.sessionCount - left.sessionCount ||
        right.transitionCount - left.transitionCount
      )[0];
    current = next?.toCellKey;
  }

  if (current !== undefined) {
    const cell = cellByKey.get(current);
    if (cell) {
      line.push({ lat: cell.lat, lon: cell.lon });
    }
  }
  return line;
}

function branchAmbiguity(transitions: TrailTransition[]): number {
  const outgoing = new Map<string, TrailTransition[]>();
  for (const transition of transitions) {
    const list = outgoing.get(transition.fromCellKey) ?? [];
    list.push(transition);
    outgoing.set(transition.fromCellKey, list);
  }

  const ambiguous = [...outgoing.values()].filter((list) => list.length > 1);
  if (outgoing.size === 0) {
    return 0;
  }
  return clamp(ambiguous.length / outgoing.size);
}

function qualityScore(accuracy: number | null): number {
  if (accuracy === null) {
    return 0.75;
  }
  return clamp(1 - accuracy / 100);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  };
}
