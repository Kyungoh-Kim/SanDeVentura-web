import { handleUploadSession } from '../../functions/upload-session/index.ts';
import { uploadConsentVersion } from '../../functions/_shared/validation.ts';

Deno.test('handleUploadSession rejects non-POST requests', async () => {
  const response = await handleUploadSession(
    new Request('http://localhost/upload-session', { method: 'GET' }),
  );

  assertEquals(response.status, 405);
  assertEquals(await response.json(), {
    success: false,
    errors: ['method_not_allowed'],
  });
});

Deno.test('handleUploadSession rejects invalid JSON', async () => {
  const response = await handleUploadSession(
    new Request('http://localhost/upload-session', {
      method: 'POST',
      body: '{',
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    success: false,
    errors: ['invalid_json'],
  });
});

Deno.test('handleUploadSession validates consent before database access', async () => {
  const response = await handleUploadSession(
    new Request('http://localhost/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: 'session-1',
        uploadConsentVersion: 'old-consent',
        mountainId: 'beta-mountain',
        startedAt: '2026-05-07T01:00:00Z',
        endedAt: '2026-05-07T02:00:00Z',
        points: [],
      }),
    }),
  );

  assertEquals(response.status, 400);
  assertEquals(await response.json(), {
    success: false,
    status: 'rejected',
    errors: ['unsupported_upload_consent_version'],
  });
});

Deno.test('handleUploadSession reports missing server configuration', async () => {
  const response = await handleUploadSession(
    new Request('http://localhost/upload-session', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: 'session-1',
        uploadConsentVersion,
        mountainId: 'beta-mountain',
        startedAt: '2026-05-07T01:00:00Z',
        endedAt: '2026-05-07T02:00:00Z',
        points: [],
      }),
    }),
  );

  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    success: false,
    errors: ['server_not_configured'],
  });
});

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
