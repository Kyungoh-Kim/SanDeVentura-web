import { jsonResponse } from '../_shared/response.ts';

Deno.serve(() => {
  // Sprint 3: return routeState, version, confidence, trailGeoJson, and metrics.
  return jsonResponse({ success: false, status: 'not_implemented' }, 501);
});

