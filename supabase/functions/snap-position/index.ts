import { jsonResponse } from '../_shared/response.ts';

Deno.serve(() => {
  // Sprint 3: compute nearest point and apply 25m/50m MVP thresholds.
  return jsonResponse({ success: false, status: 'not_implemented' }, 501);
});

