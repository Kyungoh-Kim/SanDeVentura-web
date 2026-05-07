import {
  parseUploadRequest,
  uploadConsentVersion,
  validateUploadPoints,
} from '../../functions/_shared/validation.ts';

Deno.test('parseUploadRequest accepts the beta consent version', () => {
  const request = parseUploadRequest({
    idempotencyKey: 'session-1',
    uploadConsentVersion,
    mountainId: 'beta-mountain',
    startedAt: '2026-05-07T01:00:00Z',
    endedAt: '2026-05-07T02:00:00Z',
    points: [],
  });

  assertEquals(request.uploadConsentVersion, uploadConsentVersion);
});

Deno.test('parseUploadRequest rejects missing consent', () => {
  assertThrows(() =>
    parseUploadRequest({
      idempotencyKey: 'session-1',
      mountainId: 'beta-mountain',
      startedAt: '2026-05-07T01:00:00Z',
      endedAt: '2026-05-07T02:00:00Z',
      points: [],
    })
  );
});

Deno.test('validateUploadPoints splits accepted and rejected points', () => {
  const result = validateUploadPoints([
    {
      recordedAt: '2026-05-07T01:00:00Z',
      lat: 37.5665,
      lon: 126.9780,
      accuracy: 8,
      speed: 1.2,
      sequenceIndex: 0,
    },
    {
      recordedAt: '2026-05-07T01:01:00Z',
      lat: 91,
      lon: 126.9780,
      sequenceIndex: 1,
    },
    {
      recordedAt: '2026-05-07T01:02:00Z',
      lat: 37.5667,
      lon: 126.9782,
      speed: 16,
      sequenceIndex: 2,
    },
    {
      recordedAt: '2026-05-07T01:03:00Z',
      lat: 37.5668,
      lon: 126.9783,
      accuracy: 101,
      sequenceIndex: 3,
    },
  ]);

  assertEquals(result.accepted.length, 1);
  assertEquals(result.rejected.map((point) => point.reason), [
    'invalid_lat',
    'implausible_speed',
    'low_accuracy',
  ]);
  assertEquals(result.rejected[0].lat, 91);
});

Deno.test('validateUploadPoints rejects duplicate sequence index', () => {
  const result = validateUploadPoints([
    {
      recordedAt: '2026-05-07T01:00:00Z',
      lat: 37.5665,
      lon: 126.9780,
      sequenceIndex: 0,
    },
    {
      recordedAt: '2026-05-07T01:01:00Z',
      lat: 37.5666,
      lon: 126.9781,
      sequenceIndex: 0,
    },
  ]);

  assertEquals(result.accepted.length, 1);
  assertEquals(result.rejected[0].reason, 'duplicate_sequence_index');
});

Deno.test('validateUploadPoints rejects duplicate sequence after rejected point', () => {
  const result = validateUploadPoints([
    {
      recordedAt: '2026-05-07T01:00:00Z',
      lat: 91,
      lon: 126.9780,
      sequenceIndex: 0,
    },
    {
      recordedAt: '2026-05-07T01:01:00Z',
      lat: 37.5666,
      lon: 126.9781,
      sequenceIndex: 0,
    },
  ]);

  assertEquals(result.accepted.length, 0);
  assertEquals(result.rejected.map((point) => point.reason), [
    'invalid_lat',
    'duplicate_sequence_index',
  ]);
});

Deno.test('validateUploadPoints rejects missing timestamp invalid lon and missing sequence', () => {
  const result = validateUploadPoints([
    {
      lat: 37.5665,
      lon: 126.9780,
      sequenceIndex: 0,
    },
    {
      recordedAt: '2026-05-07T01:01:00Z',
      lat: 37.5666,
      lon: 181,
      sequenceIndex: 1,
    },
    {
      recordedAt: '2026-05-07T01:02:00Z',
      lat: 37.5667,
      lon: 126.9782,
    },
  ]);

  assertEquals(result.accepted.length, 0);
  assertEquals(result.rejected.map((point) => point.reason), [
    'missing_recorded_at',
    'missing_sequence_index',
    'invalid_lon',
  ]);
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertThrows(callback: () => void): void {
  let thrown = false;
  try {
    callback();
  } catch (_) {
    thrown = true;
  }

  if (!thrown) {
    throw new Error('Expected callback to throw');
  }
}
