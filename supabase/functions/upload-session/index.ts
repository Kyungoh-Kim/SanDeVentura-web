import { jsonResponse } from '../_shared/response.ts';

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  // Sprint 2: authenticate, enforce uploadConsentVersion, validate points,
  // enforce idempotency, and store accepted/rejected point summaries.
  return jsonResponse({ success: false, status: 'not_implemented', errors: [] }, 501);
});

