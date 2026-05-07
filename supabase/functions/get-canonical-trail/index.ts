import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';

export async function handleGetCanonicalTrail(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  const mountainId = new URL(request.url).searchParams.get('mountainId');
  if (mountainId === null || mountainId.trim().length === 0) {
    return jsonResponse({ success: false, errors: ['mountainId is required'] }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const result = await supabase.rpc('latest_canonical_trail', {
    p_mountain_id: mountainId,
  });

  if (result.error) {
    return jsonResponse({ success: false, errors: [result.error.message] }, 500);
  }

  const row = result.data?.[0];
  if (!row) {
    return jsonResponse({
      success: true,
      mountainId,
      routeState: 'none',
      version: null,
      confidence: null,
      updatedAt: null,
      trailGeoJson: null,
      metrics: {
        sessionCount: 0,
        branchAmbiguityScore: null,
        gpsQualityScore: null,
      },
    });
  }

  await supabase.from('mvp_events').insert({
    mountain_id: mountainId,
    event_name: 'trail_served',
    event_payload: {
      routeState: row.route_state,
      version: row.version,
      confidence: row.confidence,
    },
  });

  return jsonResponse({
    success: true,
    mountainId,
    routeState: row.route_state,
    version: row.version,
    confidence: row.confidence,
    updatedAt: row.updated_at,
    trailGeoJson: row.trail_geojson,
    metrics: {
      sessionCount: row.session_count,
      branchAmbiguityScore: row.branch_ambiguity_score,
      gpsQualityScore: row.gps_quality_score,
    },
  });
}

if (import.meta.main) {
  Deno.serve(handleGetCanonicalTrail);
}
