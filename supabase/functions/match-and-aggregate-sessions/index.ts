import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  buildSessionHitmap,
  inferCanonicalRouteFromCells,
  lineStringWkt,
  type RoutePoint,
  type RouteQualityInputs,
  type TrailCell,
  type TrailTransition,
} from '../_shared/route_inference.ts';

const matchRadiusMeters = 75;
const batchSize = 50;

type SupabaseClient = ReturnType<typeof createClient>;

export async function handleMatchAndAggregateSessions(
  request: Request,
): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: sessions, error: sessionsError } = await supabase
    .from('unprocessed_ingested_sessions')
    .select('id, mountain_id, accepted_point_count')
    .limit(batchSize);

  if (sessionsError) {
    return jsonResponse({ success: false, errors: [sessionsError.message] }, 500);
  }

  if (!sessions || sessions.length === 0) {
    return jsonResponse({
      success: true,
      processedSessions: 0,
      affectedRoutes: 0,
      orphanCellsAdded: 0,
      candidateClustersFormed: 0,
    });
  }

  const affectedRouteIds = new Set<string>();
  let orphanCellsAdded = 0;
  let processedCount = 0;

  for (const session of sessions) {
    const result = await processSession(supabase, session.id, session.mountain_id);
    if (result.error) {
      console.error(`Session ${session.id} failed: ${result.error}`);
      continue;
    }
    for (const routeId of result.affectedRouteIds) {
      affectedRouteIds.add(routeId);
    }
    orphanCellsAdded += result.orphanCellsAdded;
    processedCount += 1;
  }

  for (const routeId of affectedRouteIds) {
    await recomputeRouteConfidence(supabase, routeId);
  }

  const { data: clusters } = await supabase
    .from('candidate_cell_clusters')
    .select('mountain_id');

  return jsonResponse({
    success: true,
    processedSessions: processedCount,
    affectedRoutes: affectedRouteIds.size,
    orphanCellsAdded,
    candidateClustersFormed: clusters?.length ?? 0,
  });
}

// ── Session processing ────────────────────────────────────────────────────────

async function processSession(
  supabase: SupabaseClient,
  sessionId: string,
  mountainId: string,
): Promise<{ affectedRouteIds: string[]; orphanCellsAdded: number; error?: string }> {
  const points = await fetchSessionPoints(supabase, sessionId);
  if (points.length === 0) {
    await markSessionProcessed(supabase, sessionId);
    return { affectedRouteIds: [], orphanCellsAdded: 0 };
  }

  const { cells, transitions } = buildSessionHitmap(points);
  if (cells.length === 0) {
    await markSessionProcessed(supabase, sessionId);
    return { affectedRouteIds: [], orphanCellsAdded: 0 };
  }

  const [storedCells, bootstrapInfo] = await Promise.all([
    fetchMountainRouteCells(supabase, mountainId),
    findBootstrapRoute(supabase, mountainId),
  ]);

  const routeGroups = new Map<string, TrailCell[]>();
  const orphanCells: TrailCell[] = [];
  let orphanCellsAdded = 0;

  for (const cell of cells) {
    const matchedRouteId = findNearestRouteCell(cell, storedCells) ??
      (bootstrapInfo !== null && isWithinBbox(cell, bootstrapInfo.bbox)
        ? bootstrapInfo.routeId
        : null);

    if (matchedRouteId !== null) {
      const group = routeGroups.get(matchedRouteId) ?? [];
      group.push(cell);
      routeGroups.set(matchedRouteId, group);
    } else {
      orphanCells.push(cell);
    }
  }

  const cellKeyToRouteId = new Map<string, string>();
  for (const [routeId, routeCells] of routeGroups) {
    for (const cell of routeCells) {
      cellKeyToRouteId.set(cell.cellKey, routeId);
    }
  }

  const classified = classifyTransitions(transitions, cellKeyToRouteId);

  for (const [routeId, routeCells] of routeGroups) {
    const routeTransitions = classified.routeInternal.get(routeId) ?? [];
    const [cellError, transitionError] = await Promise.all([
      accumulateTrailCells(supabase, routeId, sessionId, routeCells),
      accumulateTrailTransitions(supabase, routeId, sessionId, routeTransitions),
    ]);
    if (cellError) return { affectedRouteIds: [], orphanCellsAdded: 0, error: cellError };
    if (transitionError) return { affectedRouteIds: [], orphanCellsAdded: 0, error: transitionError };
    await recordSessionAssignment(supabase, sessionId, routeId, routeCells.length, routeTransitions.length);
  }

  if (orphanCells.length > 0) {
    const added = await saveCandidateCells(supabase, mountainId, sessionId, orphanCells);
    orphanCellsAdded += added;
  }

  if (classified.candidateInternal.length > 0) {
    await saveCandidateTransitions(supabase, mountainId, sessionId, classified.candidateInternal);
  }

  for (const [routeId, crossTransitions] of classified.routeToCandidate) {
    await saveRouteToCandidateTransitions(
      supabase, mountainId, routeId, sessionId, 'route_to_candidate', crossTransitions,
    );
  }
  for (const [routeId, crossTransitions] of classified.candidateToRoute) {
    await saveRouteToCandidateTransitions(
      supabase, mountainId, routeId, sessionId, 'candidate_to_route', crossTransitions,
    );
  }

  if (routeGroups.size === 0) {
    await markSessionProcessed(supabase, sessionId);
  }

  return {
    affectedRouteIds: [...routeGroups.keys()],
    orphanCellsAdded,
  };
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchSessionPoints(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<RoutePoint[]> {
  const { data, error } = await supabase.rpc('session_track_points', {
    p_session_id: sessionId,
  });
  if (error || !data) return [];
  return (data as any[])
    .map((row) => ({
      sessionId: row.session_id,
      recordedAt: row.recorded_at,
      lat: Number(row.lat),
      lon: Number(row.lon),
      accuracy: row.accuracy ?? null,
      altitude: row.altitude ?? null,
      sequenceIndex: row.sequence_index,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
}

type StoredRouteCell = { routeId: string; lat: number; lon: number };

async function fetchMountainRouteCells(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<StoredRouteCell[]> {
  const { data, error } = await supabase.rpc('mountain_route_cells', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    routeId: row.route_id,
    lat: Number(row.lat),
    lon: Number(row.lon),
  }));
}

type BootstrapInfo = { routeId: string; bbox: BoundingBox };
type BoundingBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

async function findBootstrapRoute(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<BootstrapInfo | null> {
  const { data: mountain } = await supabase
    .from('mountains')
    .select('bbox')
    .eq('id', mountainId)
    .maybeSingle();

  const bbox = mountain?.bbox ? parseBbox(mountain.bbox) : null;
  if (!bbox) return null;

  const { data: routes } = await supabase
    .from('routes')
    .select('id')
    .eq('mountain_id', mountainId);

  if (!routes || routes.length === 0) return null;

  for (const route of routes) {
    const { count: cellCount } = await supabase
      .from('trail_cells')
      .select('id', { count: 'exact', head: true })
      .eq('route_id', route.id);

    if ((cellCount ?? 0) === 0) {
      return { routeId: route.id, bbox };
    }
  }

  return null;
}

// ── Route matching ────────────────────────────────────────────────────────────

function findNearestRouteCell(
  sessionCell: TrailCell,
  storedCells: StoredRouteCell[],
): string | null {
  let best: string | null = null;
  let bestDist = matchRadiusMeters;

  for (const stored of storedCells) {
    const dist = haversineMeters(sessionCell.lat, sessionCell.lon, stored.lat, stored.lon);
    if (dist < bestDist) {
      bestDist = dist;
      best = stored.routeId;
    }
  }

  return best;
}

function isWithinBbox(cell: TrailCell, bbox: BoundingBox): boolean {
  return cell.lat >= bbox.minLat && cell.lat <= bbox.maxLat &&
    cell.lon >= bbox.minLon && cell.lon <= bbox.maxLon;
}

function parseBbox(bbox: string): BoundingBox | null {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) return null;
  return { minLon: parts[0], minLat: parts[1], maxLon: parts[2], maxLat: parts[3] };
}

// ── Accumulation ──────────────────────────────────────────────────────────────

async function accumulateTrailCells(
  supabase: SupabaseClient,
  routeId: string,
  sessionId: string,
  cells: TrailCell[],
): Promise<string | null> {
  if (cells.length === 0) return null;
  const { error } = await supabase.rpc('accumulate_trail_cells', {
    p_route_id: routeId,
    p_session_id: sessionId,
    p_cells: cells.map((c) => ({
      cellKey: c.cellKey,
      lat: c.lat,
      lon: c.lon,
      pointCount: c.pointCount,
      avgAccuracy: c.avgAccuracy,
      avgAltitude: c.avgAltitude,
      lastSeenAt: c.lastSeenAt,
      qualityScore: c.qualityScore,
    })),
  });
  return error ? error.message : null;
}

async function accumulateTrailTransitions(
  supabase: SupabaseClient,
  routeId: string,
  sessionId: string,
  transitions: TrailTransition[],
): Promise<string | null> {
  if (transitions.length === 0) return null;
  const { error } = await supabase.rpc('accumulate_trail_transitions', {
    p_route_id: routeId,
    p_session_id: sessionId,
    p_transitions: transitions.map((t) => ({
      fromCellKey: t.fromCellKey,
      toCellKey: t.toCellKey,
      transitionCount: t.transitionCount,
    })),
  });
  return error ? error.message : null;
}

async function saveCandidateTransitions(
  supabase: SupabaseClient,
  mountainId: string,
  sessionId: string,
  transitions: TrailTransition[],
): Promise<void> {
  if (transitions.length === 0) return;
  await supabase.rpc('accumulate_candidate_transitions', {
    p_mountain_id: mountainId,
    p_session_id: sessionId,
    p_transitions: transitions.map((t) => ({
      fromCellKey: t.fromCellKey,
      toCellKey: t.toCellKey,
      transitionCount: t.transitionCount,
    })),
  });
}

async function saveRouteToCandidateTransitions(
  supabase: SupabaseClient,
  mountainId: string,
  routeId: string,
  sessionId: string,
  direction: 'route_to_candidate' | 'candidate_to_route',
  transitions: TrailTransition[],
): Promise<void> {
  if (transitions.length === 0) return;
  await supabase.rpc('accumulate_route_to_candidate_transitions', {
    p_mountain_id: mountainId,
    p_route_id: routeId,
    p_session_id: sessionId,
    p_direction: direction,
    p_transitions: transitions.map((t) => ({
      fromCellKey: t.fromCellKey,
      toCellKey: t.toCellKey,
      transitionCount: t.transitionCount,
    })),
  });
}

async function saveCandidateCells(
  supabase: SupabaseClient,
  mountainId: string,
  sessionId: string,
  cells: TrailCell[],
): Promise<number> {
  const { data, error } = await supabase.rpc('accumulate_candidate_cells', {
    p_mountain_id: mountainId,
    p_session_id: sessionId,
    p_cells: cells.map((c) => ({
      cellKey: c.cellKey,
      lat: c.lat,
      lon: c.lon,
      pointCount: c.pointCount,
      avgAccuracy: c.avgAccuracy,
      avgAltitude: c.avgAltitude,
      lastSeenAt: c.lastSeenAt,
    })),
  });
  if (error) return 0;
  return (data as number) ?? 0;
}

async function recordSessionAssignment(
  supabase: SupabaseClient,
  sessionId: string,
  routeId: string,
  cellCount: number,
  transitionCount: number,
): Promise<void> {
  await supabase.from('session_route_assignments').upsert(
    {
      session_id: sessionId,
      route_id: routeId,
      contributed_cell_count: cellCount,
      contributed_transition_count: transitionCount,
    },
    { onConflict: 'session_id,route_id' },
  );
}

// For fully-orphaned sessions: mark as complete so they don't reappear in the view.
async function markSessionProcessed(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<void> {
  await supabase
    .from('hiking_sessions')
    .update({ status: 'complete' })
    .eq('id', sessionId);
}

// ── Confidence recompute ──────────────────────────────────────────────────────

async function recomputeRouteConfidence(
  supabase: SupabaseClient,
  routeId: string,
): Promise<void> {
  const [cellsResult, transitionsResult, qualityResult, sessionCountResult] = await Promise.all([
    supabase.rpc('route_accumulated_cells', { p_route_id: routeId }),
    supabase
      .from('trail_cell_transitions')
      .select('from_cell_key, to_cell_key, transition_count, session_count, edge_cost')
      .eq('route_id', routeId),
    supabase.rpc('route_quality_inputs', { p_route_id: routeId }),
    supabase
      .from('session_route_assignments')
      .select('session_id', { count: 'exact', head: true })
      .eq('route_id', routeId),
  ]);

  if (cellsResult.error || !cellsResult.data) return;

  const cells: TrailCell[] = (cellsResult.data as any[]).map((row) => ({
    cellKey: row.cell_key,
    lat: Number(row.lat),
    lon: Number(row.lon),
    pointCount: row.point_count,
    sessionCount: row.session_count,
    avgAccuracy: row.avg_accuracy ?? null,
    avgAltitude: row.avg_altitude ?? null,
    lastSeenAt: row.last_seen_at,
    qualityScore: row.quality_score ?? 0,
  }));

  const transitions: TrailTransition[] = ((transitionsResult.data ?? []) as any[]).map((row) => ({
    fromCellKey: row.from_cell_key,
    toCellKey: row.to_cell_key,
    transitionCount: row.transition_count,
    sessionCount: row.session_count,
    edgeCost: row.edge_cost,
  }));

  const qualityRow = (qualityResult.data as any[])?.[0];
  const inputs: RouteQualityInputs = {
    acceptedPointCount: qualityRow?.accepted_point_count,
    rejectedPointCount: qualityRow?.rejected_point_count,
    latestEvidenceAt: qualityRow?.latest_evidence_at ?? null,
    sessionCount: sessionCountResult.count ?? undefined,
  };

  const route = inferCanonicalRouteFromCells(cells, transitions, inputs);

  const { data: previous } = await supabase
    .from('canonical_trails')
    .select('version')
    .eq('route_id', routeId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const newVersion = (previous?.version ?? 0) + 1;

  await supabase.from('canonical_trails').insert({
    route_id: routeId,
    version: newVersion,
    geom: lineStringWkt(route.line),
    confidence: route.confidence,
    confidence_level: route.confidenceLevel,
    session_count: route.sessionCount,
    branch_ambiguity_score: route.branchAmbiguityScore,
    gps_quality_score: route.gpsQualityScore,
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

type ClassifiedTransitions = {
  routeInternal: Map<string, TrailTransition[]>;
  candidateInternal: TrailTransition[];
  routeToCandidate: Map<string, TrailTransition[]>;
  candidateToRoute: Map<string, TrailTransition[]>;
};

function classifyTransitions(
  transitions: TrailTransition[],
  cellKeyToRouteId: Map<string, string>,
): ClassifiedTransitions {
  const routeInternal = new Map<string, TrailTransition[]>();
  const candidateInternal: TrailTransition[] = [];
  const routeToCandidate = new Map<string, TrailTransition[]>();
  const candidateToRoute = new Map<string, TrailTransition[]>();

  for (const t of transitions) {
    const fromRoute = cellKeyToRouteId.get(t.fromCellKey) ?? null;
    const toRoute = cellKeyToRouteId.get(t.toCellKey) ?? null;

    if (fromRoute !== null && toRoute !== null && fromRoute === toRoute) {
      const list = routeInternal.get(fromRoute) ?? [];
      list.push(t);
      routeInternal.set(fromRoute, list);
    } else if (fromRoute === null && toRoute === null) {
      candidateInternal.push(t);
    } else if (fromRoute !== null && toRoute === null) {
      const list = routeToCandidate.get(fromRoute) ?? [];
      list.push(t);
      routeToCandidate.set(fromRoute, list);
    } else if (fromRoute === null && toRoute !== null) {
      const list = candidateToRoute.get(toRoute) ?? [];
      list.push(t);
      candidateToRoute.set(toRoute, list);
    }
    // cross-route transitions (different known routes) are intentionally discarded
  }

  return { routeInternal, candidateInternal, routeToCandidate, candidateToRoute };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

if (import.meta.main) {
  Deno.serve(handleMatchAndAggregateSessions);
}
