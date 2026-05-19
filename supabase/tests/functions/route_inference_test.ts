import {
  buildTrajectorySegmentMetrics,
  matchTrajectoryToTrailGraph,
  mergeTrajectoryLines,
  refineSessionTrajectory,
  trajectorySupportMatch,
  trajectoryLineWkt,
  weightedDiscreteFrechetTrajectory,
  type RoutePoint,
} from '../../functions/_shared/route_inference.ts';

Deno.test('refineSessionTrajectory resamples raw points and emits LineString', () => {
  const trajectory = refineSessionTrajectory([
    routePoint(0, 37.6500, 127.0000, 300, '2026-05-08T01:00:00Z'),
    routePoint(1, 37.6505, 127.0005, 301, '2026-05-08T01:01:00Z'),
    routePoint(2, 37.6510, 127.0010, 302, '2026-05-08T01:02:00Z'),
    routePoint(3, 37.6515, 127.0015, 303, '2026-05-08T01:03:00Z'),
  ]);

  assert(trajectory.points.length >= 2, 'expected refined trajectory points');
  assertEquals(trajectory.pointCount, 4);
  assert(
    trajectoryLineWkt(trajectory.points)?.startsWith('LINESTRING('),
    'expected trajectory LineString WKT',
  );
});

Deno.test('weightedDiscreteFrechetTrajectory scores aligned path below offset path', () => {
  const route = [
    { lat: 37.6500, lon: 127.0000 },
    { lat: 37.6510, lon: 127.0010 },
    { lat: 37.6520, lon: 127.0020 },
  ];
  const offset = route.map((point) => ({ lat: point.lat + 0.001, lon: point.lon + 0.001 }));

  const aligned = weightedDiscreteFrechetTrajectory(route, route);
  const shifted = weightedDiscreteFrechetTrajectory(offset, route);

  assert(aligned.frechetDistance < shifted.frechetDistance, 'expected aligned path to score better');
});

Deno.test('mergeTrajectoryLines handles different sample counts', () => {
  const shortLine = [
    { lat: 37.6500, lon: 127.0000 },
    { lat: 37.6510, lon: 127.0010 },
  ];
  const longLine = [
    { lat: 37.6501, lon: 127.0001 },
    { lat: 37.6504, lon: 127.0004 },
    { lat: 37.6507, lon: 127.0007 },
    { lat: 37.6511, lon: 127.0011 },
  ];

  const merged = mergeTrajectoryLines(shortLine, longLine, 2, 1);

  assert(merged.length >= 2, 'expected merged trajectory points');
  assert(
    Number.isFinite(weightedDiscreteFrechetTrajectory(merged, longLine).frechetDistance),
    'expected finite trajectory match score',
  );
});

Deno.test('trajectorySupportMatch treats matching candidate geometries as full support', () => {
  const first = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0000, 127.0030],
  ]);
  const second = line([
    [37.00001, 127.0000],
    [37.00001, 127.0010],
    [37.00001, 127.0020],
    [37.00001, 127.0030],
  ]);

  const support = trajectorySupportMatch(second, first);

  assertEquals(support.supportKind, 'full');
  assert(support.incomingOverlapRatio >= 0.99, 'expected incoming path to overlap existing candidate');
  assert(support.targetOverlapRatio >= 0.99, 'expected existing candidate to overlap incoming path');
});

Deno.test('trajectorySupportMatch allows sub-interval evidence for longer candidate', () => {
  const candidate = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0000, 127.0030],
    [37.0000, 127.0040],
    [37.0000, 127.0050],
    [37.0000, 127.0060],
  ]);
  const subInterval = line([
    [37.00001, 127.0020],
    [37.00001, 127.0030],
    [37.00001, 127.0040],
  ]);

  const support = trajectorySupportMatch(subInterval, candidate);

  assertEquals(support.supportKind, 'partial');
  assert(support.incomingOverlapRatio >= 0.99, 'expected sub-interval to be fully supported');
  assert(support.targetOverlapRatio >= 0.25, 'expected meaningful support for the longer candidate');
});

Deno.test('trajectorySupportMatch rejects simple crossing geometry', () => {
  const candidate = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0000, 127.0030],
    [37.0000, 127.0040],
  ]);
  const crossing = line([
    [36.9990, 127.0020],
    [37.0000, 127.0020],
    [37.0010, 127.0020],
  ]);

  const support = trajectorySupportMatch(crossing, candidate);

  assertEquals(support.supportKind, 'none');
});

Deno.test('buildTrajectorySegmentMetrics preserves timing and flags altitude jumps', () => {
  const metrics = buildTrajectorySegmentMetrics([
    { lat: 37.6500, lon: 127.0000, altitude: 300, recordedAt: '2026-05-08T01:00:00Z' },
    { lat: 37.6500, lon: 127.0002, altitude: 310, recordedAt: '2026-05-08T01:01:00Z' },
    { lat: 37.6500, lon: 127.0004, altitude: 360, recordedAt: '2026-05-08T01:02:00Z' },
  ], 100);

  assert(metrics.length >= 1, 'expected segment metrics');
  assert(
    metrics.some((metric) => (metric.durationSeconds ?? 0) > 0),
    'expected duration to be aggregated from timestamps',
  );
  assert(
    metrics.some((metric) => metric.abruptAltitudeChangeCount > 0),
    'expected abrupt altitude jump to be flagged',
  );
  assert(
    metrics.some((metric) => metric.elevationGainMeters > 0),
    'expected non-abrupt elevation gain to remain usable',
  );
});

Deno.test('buildTrajectorySegmentMetrics separates reverse direction on reference path', () => {
  const reference = [
    { lat: 37.6500, lon: 127.0000 },
    { lat: 37.6500, lon: 127.0020 },
  ];
  const metrics = buildTrajectorySegmentMetrics([
    { lat: 37.6500, lon: 127.0020, altitude: 320, recordedAt: '2026-05-08T01:00:00Z' },
    { lat: 37.6500, lon: 127.0010, altitude: 310, recordedAt: '2026-05-08T01:02:00Z' },
    { lat: 37.6500, lon: 127.0000, altitude: 300, recordedAt: '2026-05-08T01:04:00Z' },
  ], 100, reference);

  assertEquals([...new Set(metrics.map((metric) => metric.direction))], ['reverse']);
  assert(metrics.every((metric) => metric.durationSeconds !== null), 'expected reverse timing metrics');
});

Deno.test('matchTrajectoryToTrailGraph splits branch-out residual after shared edge', () => {
  const route = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0000, 127.0030],
    [37.0000, 127.0040],
  ]);
  const session = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0010, 127.0020],
    [37.0020, 127.0020],
  ]);

  const result = matchTrajectoryToTrailGraph(session, [{ id: 'edge-main', path: route }]);

  assertEquals(result.intervals.map((interval) => interval.kind), ['matched_edge', 'candidate_edge']);
  const residual = result.intervals[1];
  assert(residual.kind === 'candidate_edge' && residual.residualKind === 'branch_out', 'expected branch_out residual');
});

Deno.test('matchTrajectoryToTrailGraph splits branch-in residual before common edge', () => {
  const route = line([
    [37.0000, 127.0020],
    [37.0000, 127.0030],
    [37.0000, 127.0040],
  ]);
  const session = line([
    [37.0020, 127.0020],
    [37.0010, 127.0020],
    [37.0000, 127.0020],
    [37.0000, 127.0030],
    [37.0000, 127.0040],
  ]);

  const result = matchTrajectoryToTrailGraph(session, [{ id: 'edge-common', path: route }]);

  assertEquals(result.intervals.map((interval) => interval.kind), ['candidate_edge', 'matched_edge']);
  const residual = result.intervals[0];
  assert(residual.kind === 'candidate_edge' && residual.residualKind === 'branch_in', 'expected branch_in residual');
});

Deno.test('matchTrajectoryToTrailGraph allows candidate matched candidate sequence', () => {
  const route = line([
    [37.0000, 127.0010],
    [37.0000, 127.0015],
    [37.0000, 127.0020],
  ]);
  const session = line([
    [37.0010, 127.0000],
    [37.0005, 127.0005],
    [37.0000, 127.0010],
    [37.0000, 127.0015],
    [37.0000, 127.0020],
    [37.0005, 127.0025],
    [37.0010, 127.0030],
  ]);

  const result = matchTrajectoryToTrailGraph(session, [{ id: 'edge-middle', path: route }]);

  assertEquals(result.intervals.map((interval) => interval.kind), [
    'candidate_edge',
    'matched_edge',
    'candidate_edge',
  ]);
});

Deno.test('matchTrajectoryToTrailGraph treats non-reference edges as non-attachable', () => {
  const route = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0000, 127.0030],
  ]);
  const session = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0010, 127.0010],
    [37.0020, 127.0010],
  ]);

  const result = matchTrajectoryToTrailGraph(session, [{ id: 'edge-candidate', path: route, status: 'candidate' }]);

  assertEquals(result.intervals.length, 1);
  const residual = result.intervals[0];
  assert(residual.kind === 'candidate_edge' && residual.residualKind === 'standalone', 'expected standalone residual');
});

Deno.test('matchTrajectoryToTrailGraph requires directional separation before branch attach', () => {
  const route = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0000, 127.0030],
    [37.0000, 127.0040],
  ]);
  const session = line([
    [37.0000, 127.0000],
    [37.0000, 127.0010],
    [37.0000, 127.0020],
    [37.0003, 127.0025],
    [37.0003, 127.0030],
    [37.0003, 127.0035],
  ]);

  const result = matchTrajectoryToTrailGraph(session, [{ id: 'edge-main', path: route }], {
    maxDistanceMeters: 20,
    minMatchedLengthMeters: 40,
    minResidualLengthMeters: 40,
    minIntervalPoints: 2,
    backtrackToleranceMeters: 35,
    minAttachMatchedLengthMeters: 40,
    minDivergenceAngleDegrees: 100,
    minSeparationRatio: 0.6,
    directionSampleMeters: 60,
  });

  assertEquals(result.intervals.map((interval) => interval.kind), ['matched_edge', 'candidate_edge']);
  const residual = result.intervals[1];
  assert(residual.kind === 'candidate_edge' && residual.residualKind === 'standalone', 'expected no branch without directional separation');
});

function routePoint(
  sequenceIndex: number,
  lat: number,
  lon: number,
  altitude: number | null,
  recordedAt: string,
): RoutePoint {
  return {
    sessionId: 'trajectory-test',
    recordedAt,
    lat,
    lon,
    accuracy: 8,
    altitude,
    sequenceIndex,
  };
}

function line(points: Array<[number, number]>) {
  return points.map(([lat, lon]) => ({ lat, lon }));
}

function assert(value: unknown, message: string): void {
  if (!value) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
