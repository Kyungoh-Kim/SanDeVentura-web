import {
  inferCanonicalRoute,
  lineStringWkt,
  type RoutePoint,
} from '../../functions/_shared/route_inference.ts';
import { handleGetCanonicalTrail } from '../../functions/get-canonical-trail/index.ts';
import {
  handleSnapPosition,
  judgeDistance,
} from '../../functions/snap-position/index.ts';

Deno.test('inferCanonicalRoute labels repeated clean traces as recommended', () => {
  const points = repeatedTracePoints(3);
  const route = inferCanonicalRoute(points);

  assertEquals(route.sessionCount, 3);
  assertEquals(route.confidenceLevel, 'recommended');
  assert(route.confidence >= 0.70, 'expected recommended confidence');
  assert(route.cells.length >= 3, 'expected route cells');
  assert(route.transitions.length >= 2, 'expected transitions');
  assert(
    lineStringWkt(route.line)?.startsWith('LINESTRING('),
    'expected LineString WKT',
  );
});

Deno.test('inferCanonicalRoute keeps single trace as reference', () => {
  const route = inferCanonicalRoute(repeatedTracePoints(1));

  assertEquals(route.sessionCount, 1);
  assertEquals(route.confidenceLevel, 'reference');
  assert(route.confidence < 0.70, 'single trace should not be recommended');
});

Deno.test('get-canonical-trail requires mountainId before database access', async () => {
  const response = await handleGetCanonicalTrail(
    new Request('http://localhost/get-canonical-trail'),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    success: false,
    errors: ['mountainId is required'],
  });
});

Deno.test('snap-position validates input before database access', async () => {
  const response = await handleSnapPosition(
    new Request('http://localhost/snap-position', {
      method: 'POST',
      body: JSON.stringify({
        mountainId: 'beta-mountain',
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

Deno.test('judgeDistance applies MVP thresholds exactly', () => {
  assertEquals(judgeDistance(25), 'on_route');
  assertEquals(judgeDistance(25.1), 'caution');
  assertEquals(judgeDistance(50), 'caution');
  assertEquals(judgeDistance(50.1), 'away_from_route');
});

function repeatedTracePoints(sessionCount: number): RoutePoint[] {
  const points: RoutePoint[] = [];
  for (let session = 0; session < sessionCount; session += 1) {
    for (let index = 0; index < 5; index += 1) {
      points.push({
        sessionId: `session-${session}`,
        recordedAt: new Date(Date.UTC(2026, 4, 8, 1, index)).toISOString(),
        lat: 37.5 + index * 0.0003 + session * 0.00001,
        lon: 127.0 + index * 0.0003 + session * 0.00001,
        accuracy: 10,
        altitude: 300 + index,
        sequenceIndex: index,
      });
    }
  }
  return points;
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
