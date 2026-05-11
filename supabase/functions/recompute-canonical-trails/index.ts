import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  inferCanonicalRouteFromCells,
  lineStringWkt,
  type RouteQualityInputs,
  type TrailCell,
  type TrailTransition,
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
  const cellRows = await supabase.rpc('route_accumulated_cells', {
    p_route_id: routeId,
  });

  if (cellRows.error) {
    return jsonResponse({ success: false, errors: [cellRows.error.message] }, 500);
  }

  const [transitionRows, qualityRows, sessionCountRows] = await Promise.all([
    supabase
      .from('trail_cell_transitions')
      .select('from_cell_key, to_cell_key, transition_count, session_count, edge_cost')
      .eq('route_id', routeId),
    supabase.rpc('route_quality_inputs', {
      p_route_id: routeId,
    }),
    supabase
      .from('session_route_assignments')
      .select('session_id', { count: 'exact', head: true })
      .eq('route_id', routeId),
  ]);

  if (transitionRows.error) {
    return jsonResponse({ success: false, errors: [transitionRows.error.message] }, 500);
  }
  if (qualityRows.error) {
    return jsonResponse({ success: false, errors: [qualityRows.error.message] }, 500);
  }
  if (sessionCountRows.error) {
    return jsonResponse({ success: false, errors: [sessionCountRows.error.message] }, 500);
  }

  const cells: TrailCell[] = (cellRows.data ?? []).map((row: any) => ({
    cellKey: row.cell_key,
    lat: Number(row.lat),
    lon: Number(row.lon),
    pointCount: row.point_count,
    sessionCount: row.session_count,
    avgAccuracy: row.avg_accuracy ?? null,
    avgAltitude: row.avg_altitude ?? null,
    lastSeenAt: row.last_seen_at,
    qualityScore: row.quality_score ?? 0,
  })).filter((cell: TrailCell) =>
    Number.isFinite(cell.lat) && Number.isFinite(cell.lon)
  );

  const transitions: TrailTransition[] = (transitionRows.data ?? []).map((row: any) => ({
    fromCellKey: row.from_cell_key,
    toCellKey: row.to_cell_key,
    transitionCount: row.transition_count,
    sessionCount: row.session_count,
    edgeCost: row.edge_cost,
  }));

  const qualityInputRow = Array.isArray(qualityRows.data)
    ? qualityRows.data[0]
    : qualityRows.data;
  const qualityInputs: RouteQualityInputs = {
    acceptedPointCount: qualityInputRow?.accepted_point_count,
    rejectedPointCount: qualityInputRow?.rejected_point_count,
    latestEvidenceAt: qualityInputRow?.latest_evidence_at ?? null,
    sessionCount: sessionCountRows.count ?? undefined,
  };

  const route = inferCanonicalRouteFromCells(cells, transitions, qualityInputs);
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
