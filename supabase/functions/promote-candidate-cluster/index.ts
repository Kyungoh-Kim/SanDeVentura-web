import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';

type SupabaseClient = any;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function handlePromoteCandidateCluster(
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, errors: ['invalid_json'] }, 400);
  }

  if (
    !isRecord(body) ||
    typeof body.mountainId !== 'string' ||
    typeof body.displayName !== 'string' ||
    body.displayName.trim() === ''
  ) {
    return jsonResponse(
      { success: false, errors: ['mountainId and displayName are required'] },
      400,
    );
  }

  const { mountainId, displayName } = body as { mountainId: string; displayName: string };

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  return promoteTrajectoryCandidate(supabase, mountainId, displayName.trim());
}

async function promoteTrajectoryCandidate(
  supabase: SupabaseClient,
  mountainId: string,
  displayName: string,
): Promise<Response> {
  const { data: rawCandidates, error: candidatesError } = await supabase
    .rpc('candidate_trajectories_for_mountain', { p_mountain_id: mountainId });

  if (candidatesError) {
    return jsonResponse({ success: false, errors: [candidatesError.message] }, 500);
  }
  if (!rawCandidates || rawCandidates.length === 0) {
    return jsonResponse(
      { success: false, errors: ['insufficient_candidate_trajectories'] },
      400,
    );
  }

  const candidate = [...rawCandidates].sort((left: any, right: any) =>
    (right.point_count ?? 0) - (left.point_count ?? 0)
  )[0] as any;
  const lineWkt = lineStringWktFromGeoJson(candidate.trail_geojson);
  if (lineWkt === null) {
    return jsonResponse({ success: false, errors: ['candidate_has_no_geometry'] }, 400);
  }

  let slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = Date.now().toString(36);
  const routeId = `${mountainId}-${slug}`;

  const { data: existing } = await supabase
    .from('routes')
    .select('id')
    .eq('id', routeId)
    .maybeSingle();
  if (existing) {
    return jsonResponse({ success: false, errors: ['route_id_conflict'] }, 409);
  }

  const { error: routeError } = await supabase.from('routes').insert({
    id: routeId,
    mountain_id: mountainId,
    display_name: displayName,
  });
  if (routeError) {
    return jsonResponse({ success: false, errors: [routeError.message] }, 500);
  }

  const sessionCount = Math.max(candidate.session_count ?? 1, 1);
  const confidence = Math.max(0, Math.min(1, Math.min(1, sessionCount / 5) * 0.35 + 0.65));
  const confidenceLevel = confidence >= 0.70 && sessionCount >= 5 ? 'recommended' : 'reference';

  const { error: canonicalError } = await supabase.from('canonical_trails').insert({
    route_id: routeId,
    version: 1,
    geom: lineWkt,
    confidence,
    confidence_level: confidenceLevel,
    session_count: sessionCount,
    branch_ambiguity_score: 0,
    gps_quality_score: 0.75,
    algorithm_version: candidate.algorithm_version ?? 'trajectory-v1',
    source_kind: 'trajectory_candidate_promotion',
  });
  if (canonicalError) {
    return jsonResponse({ success: false, errors: [canonicalError.message] }, 500);
  }

  const uniqueSessions = [...new Set((candidate.contributing_sessions ?? []) as string[])];
  if (uniqueSessions.length > 0) {
    await supabase
      .from('session_trajectory_attributions')
      .update({
        target_kind: 'route',
        route_id: routeId,
        candidate_trajectory_id: null,
        matched_at: new Date().toISOString(),
      })
      .eq('target_kind', 'candidate')
      .eq('candidate_trajectory_id', candidate.id);

    await supabase.from('session_route_assignments').upsert(
      uniqueSessions.map((sessionId) => ({
        session_id: sessionId,
        route_id: routeId,
        contributed_cell_count: 0,
        contributed_transition_count: 0,
        match_method: 'trajectory_match',
        matched_point_count: null,
        matched_length_m: candidate.length_m ?? null,
        residual_length_m: 0,
      })),
      { onConflict: 'session_id,route_id' },
    );
  }

  await supabase
    .from('candidate_trajectories')
    .update({ status: 'promoted', updated_at: new Date().toISOString() })
    .eq('id', candidate.id);

  return jsonResponse({
    success: true,
    routeId,
    confidenceLevel,
    confidence,
    cellCount: 0,
    transitionCount: 0,
    sessionCount,
    sessionsReset: uniqueSessions.length,
  });
}

function lineStringWktFromGeoJson(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.coordinates)) return null;
  const pairs = value.coordinates.map((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const lon = Number(coordinate[0]);
    const lat = Number(coordinate[1]);
    return Number.isFinite(lon) && Number.isFinite(lat) ? `${lon} ${lat}` : null;
  }).filter((pair): pair is string => pair !== null);
  return pairs.length >= 2 ? `LINESTRING(${pairs.join(',')})` : null;
}

if (import.meta.main) {
  Deno.serve(handlePromoteCandidateCluster);
}
