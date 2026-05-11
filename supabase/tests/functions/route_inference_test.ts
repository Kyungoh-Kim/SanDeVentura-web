import {
  buildSessionHitmap,
  inferCanonicalRoute,
  inferCanonicalRouteFromCells,
  lineStringWkt,
  type RoutePoint,
  type TrailCell,
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
