import { jsonResponse } from '../_shared/response.ts';

Deno.serve(() => {
  // Sprint 3/P1: aggregate cells, build transition graph, and store canonical route.
  return jsonResponse({ success: false, status: 'not_implemented' }, 501);
});

