import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  inferCanonicalRoute,
  lineStringWkt,
  type RoutePoint,
  type RouteQualityInputs,
} from '../_shared/route_inference.ts';

type SupabaseClientFactory = (supabaseUrl: string, serviceRoleKey: string) => any;

export async function handleRecomputeCanonicalTrails(
  request: Request,
  supabaseClientFactory: SupabaseClientFactory = createClient,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ success: false, errors: ['invalid_json'] }, 400);
  }

  if (!isRecord(body) || typeof body.routeId !== 'string') {
    return jsonResponse({ success: false, errors: ['routeId is required'] }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const routeId = body.routeId;
  const supabase = supabaseClientFactory(supabaseUrl, serviceRoleKey);
  const pointRows = await supabase.rpc('accepted_route_points', {
    p_route_id: routeId,
  });

  if (pointRows.error) {
    return jsonResponse({ success: false, errors: [pointRows.error.message] }, 500);
  }

  const qualityRows = await supabase.rpc('route_quality_inputs', {
    p_route_id: routeId,
  });

  if (qualityRows.error) {
    return jsonResponse({ success: false, errors: [qualityRows.error.message] }, 500);
  }

  const points = (pointRows.data ?? []).map((row: any) => ({
    sessionId: row.session_id,
    recordedAt: row.recorded_at,
    lat: Number(row.lat),
    lon: Number(row.lon),
    accuracy: row.accuracy,
    altitude: row.altitude,
    sequenceIndex: row.sequence_index,
  })).filter((point: RoutePoint) =>
    Number.isFinite(point.lat) && Number.isFinite(point.lon)
  );

  const qualityInputRow = Array.isArray(qualityRows.data)
    ? qualityRows.data[0]
    : qualityRows.data;
  const qualityInputs: RouteQualityInputs = {
    acceptedPointCount: qualityInputRow?.accepted_point_count,
    rejectedPointCount: qualityInputRow?.rejected_point_count,
    latestEvidenceAt: qualityInputRow?.latest_evidence_at ?? null,
  };

  const route = inferCanonicalRoute(points, qualityInputs);
  const previous = await supabase
    .from('canonical_trails')
    .select('version')
    .eq('route_id', routeId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (previous.error) {
    return jsonResponse({ success: false, errors: [previous.error.message] }, 500);
  }

  const previousVersion = previous.data?.version ?? 0;
  const newVersion = previousVersion + 1;

  const insertedTrail = await supabase.from('canonical_trails').insert({
    route_id: routeId,
    version: newVersion,
    geom: lineStringWkt(route.line),
    confidence: route.confidence,
    confidence_level: route.confidenceLevel,
    session_count: route.sessionCount,
    branch_ambiguity_score: route.branchAmbiguityScore,
    gps_quality_score: route.gpsQualityScore,
  });

  if (insertedTrail.error) {
    return jsonResponse({ success: false, errors: [insertedTrail.error.message] }, 500);
  }

  const deletedCells = await supabase
    .from('trail_cells')
    .delete()
    .eq('route_id', routeId);
  if (deletedCells.error) {
    return jsonResponse({ success: false, errors: [deletedCells.error.message] }, 500);
  }

  const deletedTransitions = await supabase
    .from('trail_cell_transitions')
    .delete()
    .eq('route_id', routeId);
  if (deletedTransitions.error) {
    return jsonResponse({ success: false, errors: [deletedTransitions.error.message] }, 500);
  }

  if (route.cells.length > 0) {
    const insertedCells = await supabase.from('trail_cells').insert(route.cells.map((cell) => ({
      route_id: routeId,
      cell_key: cell.cellKey,
      geom: `POINT(${cell.lon} ${cell.lat})`,
      point_count: cell.pointCount,
      session_count: cell.sessionCount,
      avg_accuracy: cell.avgAccuracy,
      avg_altitude: cell.avgAltitude,
      last_seen_at: cell.lastSeenAt,
      quality_score: cell.qualityScore,
    })));
    if (insertedCells.error) {
      return jsonResponse({ success: false, errors: [insertedCells.error.message] }, 500);
    }
  }

  if (route.transitions.length > 0) {
    const insertedTransitions = await supabase.from('trail_cell_transitions').insert(
      route.transitions.map((transition) => ({
        route_id: routeId,
        from_cell_key: transition.fromCellKey,
        to_cell_key: transition.toCellKey,
        transition_count: transition.transitionCount,
        session_count: transition.sessionCount,
        edge_cost: transition.edgeCost,
      })),
    );
    if (insertedTransitions.error) {
      return jsonResponse({ success: false, errors: [insertedTransitions.error.message] }, 500);
    }
  }

  return jsonResponse({
    success: true,
    routeId,
    previousVersion,
    newVersion,
    confidence: route.confidence,
    routeState: route.confidenceLevel,
    cellCount: route.cells.length,
    edgeCount: route.transitions.length,
  });
}

if (import.meta.main) {
  Deno.serve((request) => handleRecomputeCanonicalTrails(request));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
