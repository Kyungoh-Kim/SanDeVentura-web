import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';

export async function handleGetMountains(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const [mountainsResult, routesResult] = await Promise.all([
    supabase.from('mountains').select('id, display_name').order('display_name'),
    supabase.from('routes').select('id, mountain_id').order('id'),
  ]);

  if (mountainsResult.error) {
    return jsonResponse({ success: false, errors: [mountainsResult.error.message] }, 500);
  }

  const routesByMountain = new Map<string, string[]>();
  for (const r of routesResult.data ?? []) {
    const existing = routesByMountain.get(r.mountain_id) ?? [];
    existing.push(r.id);
    routesByMountain.set(r.mountain_id, existing);
  }

  return jsonResponse({
    success: true,
    mountains: (mountainsResult.data ?? []).map((row: { id: string; display_name: string }) => ({
      id: row.id,
      displayName: row.display_name,
      routeIds: routesByMountain.get(row.id) ?? [],
    })),
  });
}

if (import.meta.main) {
  Deno.serve(handleGetMountains);
}
