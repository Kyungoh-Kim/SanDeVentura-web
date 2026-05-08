import { createClient } from 'npm:@supabase/supabase-js@2';
import { gridDisk } from 'npm:h3-js';

import { jsonResponse } from '../_shared/response.ts';
import {
  inferCanonicalRouteFromCells,
  lineStringWkt,
  type TrailCell,
  type TrailTransition,
} from '../_shared/route_inference.ts';

type SupabaseClient = ReturnType<typeof createClient>;

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
  try { body = await request.json(); } catch {
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

  // ── 1. Fetch candidate cells with lat/lon ─────────────────────────────────

  const { data: rawCells, error: cellsError } = await supabase
    .rpc('candidate_cells_for_mountain', { p_mountain_id: mountainId });

  if (cellsError) {
    return jsonResponse({ success: false, errors: [cellsError.message] }, 500);
  }
  if (!rawCells || rawCells.length < 3) {
    return jsonResponse(
      { success: false, errors: ['insufficient_candidate_cells'] },
      400,
    );
  }

  // ── 2. Build route ID ─────────────────────────────────────────────────────

  let slug = displayName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = Date.now().toString(36);
  const routeId = `${mountainId}-${slug}`;

  const { data: existing } = await supabase
    .from('routes').select('id').eq('id', routeId).maybeSingle();
  if (existing) {
    return jsonResponse({ success: false, errors: ['route_id_conflict'] }, 409);
  }

  // ── 3. INSERT route ───────────────────────────────────────────────────────

  const { error: routeError } = await supabase.from('routes').insert({
    id: routeId,
    mountain_id: mountainId,
    display_name: displayName.trim(),
  });
  if (routeError) {
    return jsonResponse({ success: false, errors: [routeError.message] }, 500);
  }

  // ── 4. Build TrailCell rows ───────────────────────────────────────────────

  const cells: TrailCell[] = (rawCells as any[]).map((row) => ({
    cellKey: row.cell_key,
    lat: Number(row.lat),
    lon: Number(row.lon),
    pointCount: row.point_count,
    sessionCount: row.session_count,
    avgAccuracy: row.avg_accuracy ?? null,
    avgAltitude: row.avg_altitude ?? null,
    lastSeenAt: row.last_seen_at,
    qualityScore: 0.7,
  }));

  // ── 5. Build transitions from H3 grid adjacency ───────────────────────────

  const cellKeySet = new Set(cells.map((c) => c.cellKey));
  const transitionMap = new Map<string, TrailTransition>();
  const sessionCountByCell = new Map(cells.map((c) => [c.cellKey, c.sessionCount]));

  for (const cell of cells) {
    const neighbors = gridDisk(cell.cellKey, 1).filter(
      (n: string) => n !== cell.cellKey && cellKeySet.has(n),
    );
    for (const neighbor of neighbors) {
      const pairKey = [cell.cellKey, neighbor].sort().join('|');
      if (!transitionMap.has(pairKey)) {
        const sc = Math.min(
          sessionCountByCell.get(cell.cellKey) ?? 1,
          sessionCountByCell.get(neighbor) ?? 1,
        );
        transitionMap.set(pairKey, {
          fromCellKey: cell.cellKey,
          toCellKey: neighbor,
          transitionCount: sc,
          sessionCount: sc,
          edgeCost: 0.1,
        });
      }
    }
  }
  const transitions: TrailTransition[] = [...transitionMap.values()];

  // ── 6. INSERT trail_cells ─────────────────────────────────────────────────

  const { error: trailCellError } = await supabase.from('trail_cells').insert(
    cells.map((c) => ({
      route_id: routeId,
      cell_key: c.cellKey,
      geom: `POINT(${c.lon} ${c.lat})`,
      point_count: c.pointCount,
      session_count: c.sessionCount,
      avg_accuracy: c.avgAccuracy,
      avg_altitude: c.avgAltitude,
      last_seen_at: c.lastSeenAt,
      quality_score: c.qualityScore,
    })),
  );
  if (trailCellError) {
    return jsonResponse({ success: false, errors: [trailCellError.message] }, 500);
  }

  // ── 7. INSERT trail_cell_transitions ─────────────────────────────────────

  if (transitions.length > 0) {
    await supabase.from('trail_cell_transitions').insert(
      transitions.map((t) => ({
        route_id: routeId,
        from_cell_key: t.fromCellKey,
        to_cell_key: t.toCellKey,
        transition_count: t.transitionCount,
        session_count: t.sessionCount,
        edge_cost: t.edgeCost,
      })),
    );
  }

  // ── 8. Infer canonical trail ──────────────────────────────────────────────

  const maxSessionCount = Math.max(...cells.map((c) => c.sessionCount), 1);
  const route = inferCanonicalRouteFromCells(cells, transitions, {
    sessionCount: maxSessionCount,
    latestEvidenceAt: cells[0]?.lastSeenAt ?? null,
  });

  const { error: canonicalError } = await supabase.from('canonical_trails').insert({
    route_id: routeId,
    version: 1,
    geom: lineStringWkt(route.line),
    confidence: route.confidence,
    confidence_level: route.confidenceLevel,
    session_count: route.sessionCount,
    branch_ambiguity_score: route.branchAmbiguityScore,
    gps_quality_score: route.gpsQualityScore,
  });
  if (canonicalError) {
    return jsonResponse({ success: false, errors: [canonicalError.message] }, 500);
  }

  // ── 9. Reset contributing sessions for re-attribution ────────────────────

  const contributingSessions: string[] = (rawCells as any[]).flatMap(
    (row) => (row.contributing_sessions as string[] | null) ?? [],
  );
  const uniqueSessions = [...new Set(contributingSessions)];

  if (uniqueSessions.length > 0) {
    await supabase
      .from('hiking_sessions')
      .update({ status: 'ingested' })
      .in('id', uniqueSessions)
      .eq('status', 'complete');
  }

  // ── 10. Clear promoted candidate cells ───────────────────────────────────

  await supabase
    .from('candidate_cells')
    .delete()
    .eq('mountain_id', mountainId);

  return jsonResponse({
    success: true,
    routeId,
    confidenceLevel: route.confidenceLevel,
    confidence: route.confidence,
    cellCount: cells.length,
    transitionCount: transitions.length,
    sessionCount: maxSessionCount,
    sessionsReset: uniqueSessions.length,
  });
}

if (import.meta.main) {
  Deno.serve(handlePromoteCandidateCluster);
}
