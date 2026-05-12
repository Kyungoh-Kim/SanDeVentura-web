import {
  cellToLatLng,
  gridDisk,
} from 'npm:h3-js';

import {
  buildSessionHitmap,
  clusterCandidateResiduals,
  inferCanonicalRoute,
  inferCanonicalRouteFromCells,
  lineStringWkt,
  mergeTrajectoryLines,
  pointToCellKey,
  refineSessionTrajectory,
  smoothCanonicalLine,
  splitSessionByRouteFit,
  trajectoryLineWkt,
  type RoutePoint,
  type TrailCell,
  weightedDiscreteFrechet,
  weightedDiscreteFrechetTrajectory,
} from '../../functions/_shared/route_inference.ts';
import {
  buildSessionCellAttributionRows,
  findNearestRouteCell,
} from '../../functions/match-and-aggregate-sessions/index.ts';
import { handleGetCanonicalTrail } from '../../functions/get-canonical-trail/index.ts';
import { handleRecomputeCanonicalTrails } from '../../functions/recompute-canonical-trails/index.ts';
import {
  handleSnapPosition,
  judgeDistance,
} from '../../functions/snap-position/index.ts';

Deno.test('inferCanonicalRoute keeps three clean traces as reference', () => {
  const points = repeatedTracePoints(3);
  const route = inferCanonicalRoute(points);

  assertEquals(route.sessionCount, 3);
  assertEquals(route.confidenceLevel, 'reference');
  assert(route.confidence >= 0.70, 'expected high reference confidence');
  assert(route.cells.length >= 3, 'expected route cells');
  assert(route.transitions.length >= 2, 'expected transitions');
  assert(
    lineStringWkt(route.line)?.startsWith('LINESTRING('),
    'expected LineString WKT',
  );
});

Deno.test('inferCanonicalRoute keeps single trace as reference', () => {
  const route = inferCanonicalRoute(repeatedTracePoints(1, { samplesPerCell: 2 }));

  assertEquals(route.sessionCount, 1);
  assertEquals(route.confidenceLevel, 'reference');
  assert(route.confidence >= 0.70, 'single clean trace may have high confidence');
});

Deno.test('inferCanonicalRoute ignores unsupported sparse traces', () => {
  const route = inferCanonicalRoute(repeatedTracePoints(1));

  assertEquals(route.confidenceLevel, 'none');
  assertEquals(route.line.length, 0);
  assertEquals(lineStringWkt(route.line), null);
});

Deno.test('inferCanonicalRoute prunes isolated noisy cells', () => {
  const points = repeatedTracePoints(3);
  points.push({
    sessionId: 'noise',
    recordedAt: new Date(Date.UTC(2026, 4, 8, 1, 30)).toISOString(),
    lat: 37.9,
    lon: 127.9,
    accuracy: 8,
    altitude: 300,
    sequenceIndex: 0,
  });

  const route = inferCanonicalRoute(points);

  assertEquals(route.confidenceLevel, 'reference');
  assert(
    !route.cells.some((cell) => Math.abs(cell.lat - 37.9) < 0.001),
    'isolated noisy cell should be pruned from supported route',
  );
});

Deno.test('inferCanonicalRoute lowers confidence for branch ambiguity', () => {
  const straight = inferCanonicalRoute(repeatedTracePoints(3));
  const branched = inferCanonicalRoute([
    ...repeatedTracePoints(3, { length: 3 }),
    ...branchTracePoints(2),
  ]);

  assert(branched.branchAmbiguityScore > 0, 'expected branch ambiguity');
  assertEquals(branched.confidenceLevel, 'reference');
  assert(
    branched.transitionConsistencyScore < straight.transitionConsistencyScore,
    'branch evidence should reduce transition consistency',
  );
  assert(branched.confidence >= 0.70, 'branch evidence should keep usable confidence');
});

Deno.test('inferCanonicalRoute lowers GPS quality for noisy traces', () => {
  const clean = inferCanonicalRoute(repeatedTracePoints(3));
  const noisy = inferCanonicalRoute(repeatedTracePoints(3, { accuracy: 65 }));

  assertEquals(noisy.confidenceLevel, 'reference');
  assert(noisy.gpsQualityScore < 0.60, 'expected low GPS quality score');
  assert(
    noisy.confidence < clean.confidence,
    'low-accuracy traces should reduce confidence',
  );
});

Deno.test('inferCanonicalRoute scores rejected and stale evidence', () => {
  const now = new Date(Date.UTC(2026, 4, 8, 0, 0));
  const recent = inferCanonicalRoute(repeatedTracePoints(3), {
    acceptedPointCount: 15,
    rejectedPointCount: 0,
    latestEvidenceAt: new Date(Date.UTC(2026, 4, 1, 0, 0)).toISOString(),
    now,
  });
  const staleRejected = inferCanonicalRoute(repeatedTracePoints(3), {
    acceptedPointCount: 15,
    rejectedPointCount: 15,
    latestEvidenceAt: new Date(Date.UTC(2025, 11, 1, 0, 0)).toISOString(),
    now,
  });

  assertEquals(recent.recencyScore, 1);
  assertEquals(staleRejected.recencyScore, 0.2);
  assertEquals(staleRejected.confidenceLevel, 'reference');
  assertEquals(staleRejected.rejectedPointRate, 0.5);
  assert(
    staleRejected.confidence < recent.confidence,
    'stale rejected evidence should lower confidence',
  );
});

Deno.test('get-canonical-trail requires routeId before database access', async () => {
  const response = await handleGetCanonicalTrail(
    new Request('http://localhost/get-canonical-trail'),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    success: false,
    errors: ['routeId is required'],
  });
});

Deno.test('recompute canonical trail uses accumulated cells without raw points', async () => {
  const previousUrl = Deno.env.get('SUPABASE_URL');
  const previousServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
  const operations: string[] = [];
  try {
    const response = await handleRecomputeCanonicalTrails(
      new Request('http://localhost/recompute-canonical-trails', {
        method: 'POST',
        body: JSON.stringify({ routeId: 'beta-mountain-main' }),
      }),
      () => mockSupabaseClient(operations),
    );

    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.success, true);
    assertEquals(body.routeId, 'beta-mountain-main');
    assertEquals(operations, [
      'rpc:route_accumulated_cells',
      'select:trail_cell_transitions',
      'rpc:route_quality_inputs',
      'select:session_route_assignments',
      'insert:canonical_trails',
    ]);
  } finally {
    restoreEnv('SUPABASE_URL', previousUrl);
    restoreEnv('SUPABASE_SERVICE_ROLE_KEY', previousServiceRoleKey);
  }
});

Deno.test('snap-position validates input before database access', async () => {
  const response = await handleSnapPosition(
    new Request('http://localhost/snap-position', {
      method: 'POST',
      body: JSON.stringify({
        routeId: 'beta-mountain-main',
        lat: 91,
        lon: 127,
      }),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    success: false,
    errors: ['invalid_lat'],
  });
});

Deno.test('buildSessionHitmap produces cells and transitions from raw points', () => {
  const points = repeatedTracePoints(1, { length: 5, samplesPerCell: 2 });
  const { cells, transitions } = buildSessionHitmap(points);

  assert(cells.length >= 4, 'expected cells from 5 distinct positions');
  assert(transitions.length >= 4, 'expected transitions between cells');
  assert(
    cells.every((c) => c.pointCount >= 1 && c.sessionCount >= 1),
    'all cells should have positive counts',
  );
  assert(
    transitions.every((t) => t.transitionCount >= 1),
    'all transitions should have positive counts',
  );
});

Deno.test('buildSessionHitmap returns empty result for empty input', () => {
  const { cells, transitions } = buildSessionHitmap([]);
  assertEquals(cells.length, 0);
  assertEquals(transitions.length, 0);
});

Deno.test('refineSessionTrajectory resamples raw points and emits LineString', () => {
  const points = trajectoryPoints([
    [37.6500, 127.0000, 8],
    [37.6505, 127.0005, 9],
    [37.6510, 127.0010, 180],
    [37.6515, 127.0015, 10],
    [37.6520, 127.0020, 11],
  ]);

  const trajectory = refineSessionTrajectory(points);

  assert(trajectory.points.length >= 2, 'expected refined trajectory points');
  assertEquals(trajectory.pointCount, 5);
  assert(
    trajectoryLineWkt(trajectory.points)?.startsWith('LINESTRING('),
    'expected trajectory LineString WKT',
  );
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

Deno.test('buildSessionCellAttributionRows separates route and candidate cells', () => {
  const routeGroups = new Map<string, TrailCell[]>([
    ['route-a', [testCell('route-cell-a', 3), testCell('route-cell-b', 2)]],
  ]);
  const candidateCells = [testCell('candidate-cell-a', 4)];

  const rows = buildSessionCellAttributionRows(
    'attribution-test-mountain',
    routeGroups,
    candidateCells,
  );

  assertEquals(rows, [
    {
      mountainId: 'attribution-test-mountain',
      targetKind: 'route',
      routeId: 'route-a',
      cellKey: 'route-cell-a',
      pointCount: 3,
      avgAccuracy: 9,
      avgAltitude: 800,
      lastSeenAt: '2026-05-08T01:00:00Z',
    },
    {
      mountainId: 'attribution-test-mountain',
      targetKind: 'route',
      routeId: 'route-a',
      cellKey: 'route-cell-b',
      pointCount: 2,
      avgAccuracy: 9,
      avgAltitude: 800,
      lastSeenAt: '2026-05-08T01:00:00Z',
    },
    {
      mountainId: 'attribution-test-mountain',
      targetKind: 'candidate',
      routeId: null,
      cellKey: 'candidate-cell-a',
      pointCount: 4,
      avgAccuracy: 9,
      avgAltitude: 800,
      lastSeenAt: '2026-05-08T01:00:00Z',
    },
  ]);
});

Deno.test('buildSessionCellAttributionRows supports candidate-only sessions', () => {
  const rows = buildSessionCellAttributionRows(
    'attribution-test-mountain',
    new Map(),
    [testCell('candidate-cell-a', 4), testCell('candidate-cell-b', 5)],
  );

  assertEquals(rows.map((row) => row.targetKind), ['candidate', 'candidate']);
  assertEquals(rows.map((row) => row.pointCount), [4, 5]);
  assertEquals(rows.every((row) => row.routeId === null), true);
});

Deno.test('findNearestRouteCell only absorbs exact route cells', () => {
  const stored = [{
    routeId: 'route-a',
    cellKey: 'route-cell-a',
    lat: 37.5,
    lon: 127,
  }];

  assertEquals(
    findNearestRouteCell(
      { ...testCell('route-cell-a', 1), lat: 37.5, lon: 127.0006 },
      stored,
    ),
    'route-a',
  );
  assertEquals(
    findNearestRouteCell(
      { ...testCell('jitter-cell-a', 1), lat: 37.5, lon: 127.0002 },
      stored,
    ),
    null,
  );
  assertEquals(
    findNearestRouteCell(
      { ...testCell('branch-cell-a', 1), lat: 37.5, lon: 127.00055 },
      stored,
    ),
    null,
  );
  assertEquals(
    findNearestRouteCell(
      { ...testCell('branch-cell-b', 1), lat: 37.5, lon: 127.00068 },
      stored,
    ),
    null,
  );
});

Deno.test('weightedDiscreteFrechet scores exact overlap below offset path', () => {
  const routePath = [
    validCell(37.5, 127.0, 4, 3),
    validCell(37.5003, 127.0003, 4, 3),
    validCell(37.5006, 127.0006, 4, 3),
  ];
  const offsetPath = [
    validCell(37.505, 127.005, 4, 2),
    validCell(37.5053, 127.0053, 4, 2),
    validCell(37.5056, 127.0056, 4, 2),
  ];

  const exact = weightedDiscreteFrechet(routePath, routePath);
  const offset = weightedDiscreteFrechet(offsetPath, routePath);

  assertEquals(exact.overlapRatio, 1);
  assert(exact.frechetDistance < offset.frechetDistance, 'exact path should score closer');
});

Deno.test('splitSessionByRouteFit preserves exact overlap and leaves residual candidates', () => {
  const routePath = [
    validCell(37.5, 127.0, 3, 3),
    validCell(37.5003, 127.0003, 3, 3),
  ];
  const residual = validCell(37.505, 127.005, 3, 2);

  const split = splitSessionByRouteFit([...routePath, residual], routePath, false);

  assertEquals(split.routeCells.map((cell) => cell.cellKey), routePath.map((cell) => cell.cellKey));
  assertEquals(split.candidateCells.map((cell) => cell.cellKey), [residual.cellKey]);
});

Deno.test('splitSessionByRouteFit accepts nearby correction only after path match', () => {
  const routePath = [
    validCell(37.5, 127.0, 3, 3),
    validCell(37.5003, 127.0003, 3, 3),
  ];
  const nearRouteKey = gridDisk(routePath[1].cellKey, 1)
    .find((key) => !routePath.some((cell) => cell.cellKey === key));
  if (!nearRouteKey) throw new Error('expected nearby non-overlap cell');
  const nearRoute = cellFromKey(nearRouteKey, 3, 2);

  const rejected = splitSessionByRouteFit([nearRoute], routePath, false, 75);
  const accepted = splitSessionByRouteFit([nearRoute], routePath, true, 75);

  assertEquals(rejected.candidateCells.map((cell) => cell.cellKey), [nearRoute.cellKey]);
  assertEquals(accepted.routeCells.map((cell) => cell.cellKey), [nearRoute.cellKey]);
});

Deno.test('smoothCanonicalLine limits neighbor support movement', () => {
  const center = validCell(37.5, 127.0, 2, 1);
  const next = validCell(37.5003, 127.0003, 2, 1);
  const neighborKey = gridDisk(center.cellKey, 1).find((key) => key !== center.cellKey);
  if (!neighborKey) throw new Error('expected H3 neighbor');
  const [neighborLat, neighborLon] = cellToLatLng(neighborKey);
  const neighbor = {
    ...center,
    cellKey: neighborKey,
    lat: neighborLat,
    lon: neighborLon,
    pointCount: 100,
    sessionCount: 100,
  };

  const line = smoothCanonicalLine(
    [center, next],
    new Map([
      [center.cellKey, center],
      [next.cellKey, next],
      [neighbor.cellKey, neighbor],
    ]),
  );

  assert(line.length >= 2, 'expected smoothed line');
  assert(
    distanceMeters(center, line[0]) <= 45,
    'smoothed point should remain close to the original cell corridor',
  );
});

Deno.test('clusterCandidateResiduals separates supported cluster from singleton noise', () => {
  const seed = validCell(37.5, 127.0, 4, 2);
  const neighborKeys = gridDisk(seed.cellKey, 1).filter((key) => key !== seed.cellKey);
  const clusterCells = [seed, ...neighborKeys.slice(0, 2).map((key, index) =>
    cellFromKey(key, 4 + index, 2, ['session-a', 'session-b'])
  )];
  const noise = validCell(37.52, 127.02, 9, 5, ['noise-session']);

  const clusters = clusterCandidateResiduals([...clusterCells, noise], [], {
    minClusterCellCount: 3,
    minClusterSessionCount: 2,
  });

  assertEquals(clusters.length, 1);
  assertEquals(clusters[0].cells.length, 3);
  assertEquals(clusters[0].sessionCount, 2);
});

Deno.test('inferCanonicalRouteFromCells produces same confidence level as inferCanonicalRoute', () => {
  const points = repeatedTracePoints(3);
  const fromPoints = inferCanonicalRoute(points);
  const { cells, transitions } = buildSessionHitmap(points);
  const fromCells = inferCanonicalRouteFromCells(cells, transitions, {
    sessionCount: 3,
    latestEvidenceAt: new Date(Date.UTC(2026, 4, 8, 1, 4)).toISOString(),
    now: new Date(Date.UTC(2026, 4, 8, 0, 0)),
  });

  assertEquals(fromPoints.confidenceLevel, fromCells.confidenceLevel);
  assert(
    Math.abs(fromPoints.confidence - fromCells.confidence) < 0.05,
    `confidence should be close: ${fromPoints.confidence} vs ${fromCells.confidence}`,
  );
});

Deno.test('inferCanonicalRouteFromCells returns none for empty cells', () => {
  const result = inferCanonicalRouteFromCells([], [], {});
  assertEquals(result.confidenceLevel, 'none');
  assertEquals(result.confidence, 0);
  assertEquals(result.line.length, 0);
});

Deno.test('inferCanonicalRouteFromCells uses inputs.sessionCount for confidence', () => {
  const points = repeatedTracePoints(1, { samplesPerCell: 3 });
  const { cells, transitions } = buildSessionHitmap(points);

  const with1Session = inferCanonicalRouteFromCells(cells, transitions, { sessionCount: 1 });
  const with3Sessions = inferCanonicalRouteFromCells(cells, transitions, { sessionCount: 3 });

  assert(
    with3Sessions.confidence >= with1Session.confidence,
    'more sessions should yield equal or higher confidence',
  );
  assertEquals(with1Session.sessionCount, 1);
  assertEquals(with3Sessions.sessionCount, 3);
});

Deno.test('judgeDistance applies MVP thresholds exactly', () => {
  assertEquals(judgeDistance(25), 'on_route');
  assertEquals(judgeDistance(25.1), 'caution');
  assertEquals(judgeDistance(50), 'caution');
  assertEquals(judgeDistance(50.1), 'away_from_route');
});

type RepeatedTraceOptions = {
  length?: number;
  samplesPerCell?: number;
  accuracy?: number;
};

function repeatedTracePoints(
  sessionCount: number,
  options: RepeatedTraceOptions = {},
): RoutePoint[] {
  const length = options.length ?? 5;
  const samplesPerCell = options.samplesPerCell ?? 1;
  const accuracy = options.accuracy ?? 10;
  const points: RoutePoint[] = [];
  for (let session = 0; session < sessionCount; session += 1) {
    let sequenceIndex = 0;
    for (let index = 0; index < length; index += 1) {
      for (let sample = 0; sample < samplesPerCell; sample += 1) {
        points.push({
          sessionId: `session-${session}`,
          recordedAt: new Date(Date.UTC(2026, 4, 8, 1, index, sample)).toISOString(),
          lat: 37.5 + index * 0.0003 + session * 0.00001,
          lon: 127.0 + index * 0.0003 + session * 0.00001,
          accuracy,
          altitude: 300 + index,
          sequenceIndex,
        });
        sequenceIndex += 1;
      }
    }
  }
  return points;
}

function trajectoryPoints(points: Array<[number, number, number]>): RoutePoint[] {
  return points.map(([lat, lon, accuracy], index) => ({
    sessionId: 'trajectory-test',
    recordedAt: new Date(Date.UTC(2026, 4, 8, 1, 0, index)).toISOString(),
    lat,
    lon,
    accuracy,
    altitude: 300 + index,
    sequenceIndex: index,
  }));
}

function testCell(cellKey: string, pointCount: number): TrailCell {
  return {
    cellKey,
    lat: 37.5,
    lon: 127,
    pointCount,
    sessionCount: 1,
    avgAccuracy: 9,
    avgAltitude: 800,
    lastSeenAt: '2026-05-08T01:00:00Z',
    qualityScore: 0.91,
  };
}

function validCell(
  lat: number,
  lon: number,
  pointCount: number,
  sessionCount: number,
  contributingSessions: string[] = [],
): TrailCell {
  return cellFromKey(pointToCellKey(lat, lon), pointCount, sessionCount, contributingSessions);
}

function cellFromKey(
  cellKey: string,
  pointCount: number,
  sessionCount: number,
  contributingSessions: string[] = [],
): TrailCell {
  const [lat, lon] = cellToLatLng(cellKey);
  return {
    cellKey,
    lat,
    lon,
    pointCount,
    sessionCount,
    avgAccuracy: 9,
    avgAltitude: 800,
    lastSeenAt: '2026-05-08T01:00:00Z',
    qualityScore: 0.91,
    ...(contributingSessions.length > 0 ? { contributingSessions } : {}),
  } as TrailCell;
}

function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const radius = 6_371_000;
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function branchTracePoints(sessionCount: number): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let session = 0; session < sessionCount; session += 1) {
    const sessionId = `branch-${session}`;
    const recordedAt = (index: number) =>
      new Date(Date.UTC(2026, 4, 8, 2, index)).toISOString();
    points.push(
      {
        sessionId,
        recordedAt: recordedAt(0),
        lat: 37.5 + session * 0.00001,
        lon: 127.0 + session * 0.00001,
        accuracy: 10,
        altitude: 300,
        sequenceIndex: 0,
      },
      {
        sessionId,
        recordedAt: recordedAt(1),
        lat: 37.5003 + session * 0.00001,
        lon: 127.0003 + session * 0.00001,
        accuracy: 10,
        altitude: 301,
        sequenceIndex: 1,
      },
      {
        sessionId,
        recordedAt: recordedAt(2),
        lat: 37.5003 + session * 0.00001,
        lon: 127.0012 + session * 0.00001,
        accuracy: 10,
        altitude: 302,
        sequenceIndex: 2,
      },
    );
  }
  return points;
}

function mockSupabaseClient(operations: string[]): any {
  return {
    rpc(name: string) {
      operations.push(`rpc:${name}`);
      if (name === 'route_accumulated_cells') {
        const { cells } = buildSessionHitmap(repeatedTracePoints(3));
        return Promise.resolve({
          data: cells.map((cell) => ({
            cell_key: cell.cellKey,
            lat: cell.lat,
            lon: cell.lon,
            point_count: cell.pointCount,
            session_count: cell.sessionCount,
            avg_accuracy: cell.avgAccuracy,
            avg_altitude: cell.avgAltitude,
            last_seen_at: cell.lastSeenAt,
            quality_score: cell.qualityScore,
          })),
          error: null,
        });
      }
      return Promise.resolve({
        data: [{
          accepted_point_count: 15,
          rejected_point_count: 0,
          latest_evidence_at: new Date(Date.UTC(2026, 4, 8, 1, 4)).toISOString(),
        }],
        error: null,
      });
    },
    from(table: string) {
      if (table === 'canonical_trails') {
        return {
          select() {
            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return {
                          maybeSingle() {
                            return Promise.resolve({ data: { version: 7 }, error: null });
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
          insert() {
            operations.push('insert:canonical_trails');
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === 'trail_cell_transitions') {
        return {
          select() {
            return {
              eq() {
                operations.push('select:trail_cell_transitions');
                const { transitions } = buildSessionHitmap(repeatedTracePoints(3));
                return Promise.resolve({
                  data: transitions.map((transition) => ({
                    from_cell_key: transition.fromCellKey,
                    to_cell_key: transition.toCellKey,
                    transition_count: transition.transitionCount,
                    session_count: transition.sessionCount,
                    edge_cost: transition.edgeCost,
                  })),
                  error: null,
                });
              },
            };
          },
        };
      }
      if (table === 'session_route_assignments') {
        return {
          select() {
            return {
              eq() {
                operations.push('select:session_route_assignments');
                return Promise.resolve({ count: 3, error: null });
              },
            };
          },
        };
      }
      return {
        delete() {
          return {
            eq() {
              operations.push(`delete:${table}`);
              return Promise.resolve({
                error: table === 'trail_cells'
                  ? { message: 'debug delete failed' }
                  : null,
              });
            },
          };
        },
        insert() {
          operations.push(`insert:${table}`);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
}

function assert(value: unknown, message: string): void {
  if (!value) {
    throw new Error(message);
  }
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
