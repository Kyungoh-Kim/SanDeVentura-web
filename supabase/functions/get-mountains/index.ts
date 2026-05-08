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
  const { data, error } = await supabase
    .from('mountains')
    .select('id, display_name')
    .order('display_name');

  if (error) {
    return jsonResponse({ success: false, errors: [error.message] }, 500);
  }

  return jsonResponse({
    success: true,
    mountains: (data ?? []).map((row: { id: string; display_name: string }) => ({
      id: row.id,
      displayName: row.display_name,
    })),
  });
}

if (import.meta.main) {
  Deno.serve(handleGetMountains);
}
