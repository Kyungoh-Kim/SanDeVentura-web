import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  inferCanonicalRouteFromCells,
  lineStringWkt,
  mergeTrajectoryLines,
  refineSessionTrajectory,
  splitSessionByRouteFit,
  trajectoryLengthMeters,
  trajectoryLineWkt,
  trajectoryOverlapRatio,
  weightedDiscreteFrechet,
  weightedDiscreteFrechetTrajectory,
  type RefinedTrajectory,
  type RouteQualityInputs,
  type TrajectoryMatchMetrics,
  type TrajectoryPoint,
  type RoutePoint,
  type TrailCell,
  type TrailTransition,
} from '../_shared/route_inference.ts';

const batchSize = 50;
const routeFrechetThresholdMeters = 45;
const routeOverlapThreshold = 0.35;
const routeScoreMarginThresholdMeters = 15;
const candidateFrechetThresholdMeters = 65;
const algorithmVersion = 'trajectory-v1';

type SupabaseClient = any;

export type SessionCellAttributionRow = {
  mountainId: string;
  targetKind: 'route' | 'candidate';
  routeId: string | null;
  cellKey: string;
  pointCount: number;
  avgAccuracy: number | null;
  avgAltitude: number | null;
  lastSeenAt: string | null;
};

type RouteMatchMethod = 'exact_overlap' | 'frechet_match' | 'candidate_residual' | 'trajectory_match';

type RouteMatchDecision = {
  routeId: string | null;
  accepted: boolean;
  method: RouteMatchMethod;
  metrics: TrajectoryMatchMetrics | null;
  scoreMargin: number | null;
};

export type SessionTrajectoryAttributionRow = {
  mountainId: string;
  targetKind: 'route' | 'candidate';
  routeId: string | null;
  candidateTrajectoryId: string | null;
  pointCount: number;
  avgAccuracy: number | null;
  avgAltitude: number | null;
  matchedLengthMeters: number | null;
  residualLengthMeters: number | null;
  frechetDistance: number | null;
  overlapRatio: number | null;
  algorithmVersion: string;
};

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
    .select('id, mountain_id, route_id, accepted_point_count')
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
      purgedTrackPointCount: 0,
      purgedRejectedPointCount: 0,
    });
  }

  const affectedRouteIds = new Set<string>();
  let orphanCellsAdded = 0;
  let processedCount = 0;
  let purgedTrackPointCount = 0;
  let purgedRejectedPointCount = 0;

  for (const session of sessions) {
    const result = await processSession(supabase, session.id, session.mountain_id, session.route_id ?? null);
    if (result.error) {
      console.error(`Session ${session.id} failed: ${result.error}`);
      continue;
    }
    for (const routeId of result.affectedRouteIds) {
      affectedRouteIds.add(routeId);
    }
    orphanCellsAdded += result.orphanCellsAdded;
    purgedTrackPointCount += result.purgedTrackPointCount;
    purgedRejectedPointCount += result.purgedRejectedPointCount;
    processedCount += 1;
  }

  const { data: clusters } = await supabase
    .from('operator_candidate_trajectory_clusters')
    .select('mountain_id');

  return jsonResponse({
    success: true,
    processedSessions: processedCount,
    affectedRoutes: affectedRouteIds.size,
    orphanCellsAdded,
    candidateClustersFormed: clusters?.length ?? 0,
    purgedTrackPointCount,
    purgedRejectedPointCount,
  });
}

// ── Session processing ────────────────────────────────────────────────────────

async function processSession(
  supabase: SupabaseClient,
  sessionId: string,
  mountainId: string,
  seedRouteId: string | null,
): Promise<{
  affectedRouteIds: string[];
  orphanCellsAdded: number;
  purgedTrackPointCount: number;
  purgedRejectedPointCount: number;
  error?: string;
}> {
  const points = await fetchSessionPoints(supabase, sessionId);
  if (points.length === 0) {
    await markSessionProcessed(supabase, sessionId);
    const purgeResult = await purgeSessionRawPoints(supabase, sessionId);
    if (purgeResult.error) {
      return emptySessionResult(purgeResult.error);
    }
    return {
      affectedRouteIds: [],
      orphanCellsAdded: 0,
      purgedTrackPointCount: purgeResult.trackPointCount,
      purgedRejectedPointCount: purgeResult.rejectedPointCount,
    };
  }

  const trajectory = refineSessionTrajectory(points);
  if (trajectory.points.length < 2) {
    await markSessionProcessed(supabase, sessionId);
    const purgeResult = await purgeSessionRawPoints(supabase, sessionId);
    if (purgeResult.error) {
      return emptySessionResult(purgeResult.error);
    }
    return {
      affectedRouteIds: [],
      orphanCellsAdded: 0,
      purgedTrackPointCount: purgeResult.trackPointCount,
      purgedRejectedPointCount: purgeResult.rejectedPointCount,
    };
  }

  const routePaths = await fetchMountainRouteTrajectories(supabase, mountainId);
  const trajectoryRows: SessionTrajectoryAttributionRow[] = [];
  let orphanCellsAdded = 0;

  const decision = seedRouteId !== null
    ? supervisedRouteDecision(seedRouteId, routePaths, trajectory)
    : chooseRouteForTrajectory(trajectory.points, routePaths);

  if (decision.routeId !== null && decision.accepted) {
    const routePath = routePaths.find((routePath) => routePath.routeId === decision.routeId) ?? null;
    const canonicalError = await appendRouteTrajectoryEvidence(
      supabase,
      decision.routeId,
      trajectory,
      routePath,
    );
    if (canonicalError) return emptySessionResult(canonicalError);

    await recordSessionAssignment(
      supabase,
      sessionId,
      decision.routeId,
      trajectory.points.length,
      0,
      decision,
      trajectory.pointCount,
      trajectory.lengthMeters,
      0,
    );
    trajectoryRows.push(trajectoryAttributionRow(
      mountainId,
      'route',
      decision.routeId,
      null,
      trajectory,
      trajectory.lengthMeters,
      0,
      decision.metrics,
    ));
  } else {
    const candidateId = await saveCandidateTrajectory(supabase, mountainId, sessionId, trajectory);
    if (candidateId === null) {
      return emptySessionResult('candidate_trajectory_save_failed');
    }
    orphanCellsAdded += trajectory.pointCount;
    trajectoryRows.push(trajectoryAttributionRow(
      mountainId,
      'candidate',
      null,
      candidateId,
      trajectory,
      0,
      trajectory.lengthMeters,
      decision.metrics,
    ));
  }

  const attributionError = await saveSessionTrajectoryAttributions(
    supabase,
    sessionId,
    trajectoryRows,
  );
  if (attributionError) return emptySessionResult(attributionError);

  await markSessionProcessed(supabase, sessionId);

  const purgeResult = await purgeSessionRawPoints(supabase, sessionId);
  if (purgeResult.error) {
    return emptySessionResult(purgeResult.error);
  }

  return {
    affectedRouteIds: decision.routeId !== null && decision.accepted ? [decision.routeId] : [],
    orphanCellsAdded,
    purgedTrackPointCount: purgeResult.trackPointCount,
    purgedRejectedPointCount: purgeResult.rejectedPointCount,
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

type RawPurgeResult = {
  trackPointCount: number;
  rejectedPointCount: number;
  error?: string;
};

type StoredRouteTrajectory = {
  routeId: string;
  routeDisplayName: string | null;
  path: TrajectoryPoint[];
  version: number;
  sessionCount: number;
};

type StoredCandidateTrajectory = {
  id: string;
  mountainId: string;
  path: TrajectoryPoint[];
  pointCount: number;
  sessionCount: number;
  contributingSessions: string[];
  avgAccuracy: number | null;
  avgAltitude: number | null;
  latestEvidenceAt: string | null;
  confidence: number | null;
};

async function fetchMountainRouteTrajectories(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<StoredRouteTrajectory[]> {
  const { data, error } = await supabase.rpc('route_trajectories_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    routeId: row.route_id,
    routeDisplayName: row.route_display_name ?? null,
    path: parseGeoJsonLine(row.trail_geojson),
    version: row.version ?? 0,
    sessionCount: row.session_count ?? 0,
  }));
}

async function fetchCandidateTrajectories(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<StoredCandidateTrajectory[]> {
  const { data, error } = await supabase.rpc('candidate_trajectories_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];
  return (data as any[]).map((row) => ({
    id: row.id,
    mountainId: row.mountain_id,
    path: parseGeoJsonLine(row.trail_geojson),
    pointCount: row.point_count ?? 0,
    sessionCount: row.session_count ?? 0,
    contributingSessions: row.contributing_sessions ?? [],
    avgAccuracy: row.avg_accuracy ?? null,
    avgAltitude: row.avg_altitude ?? null,
    latestEvidenceAt: row.latest_evidence_at ?? null,
    confidence: row.confidence ?? null,
  }));
}

function parseGeoJsonLine(value: unknown): TrajectoryPoint[] {
  if (!value || typeof value !== 'object' || !('coordinates' in value)) return [];
  const coordinates = (value as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates)) return [];
  return coordinates
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
      const lon = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    })
    .filter((point): point is TrajectoryPoint => point !== null);
}

async function purgeSessionRawPoints(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<RawPurgeResult> {
  const { data, error } = await supabase.rpc('purge_session_raw_points', {
    p_session_id: sessionId,
  });

  if (error) {
    return { trackPointCount: 0, rejectedPointCount: 0, error: error.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    trackPointCount: row?.deleted_track_point_count ?? 0,
    rejectedPointCount: row?.deleted_rejected_point_count ?? 0,
  };
}

function emptySessionResult(error: string): {
  affectedRouteIds: string[];
  orphanCellsAdded: number;
  purgedTrackPointCount: number;
  purgedRejectedPointCount: number;
  error: string;
} {
  return {
    affectedRouteIds: [],
    orphanCellsAdded: 0,
    purgedTrackPointCount: 0,
    purgedRejectedPointCount: 0,
    error,
  };
}

export type StoredRouteCell = { routeId: string; cellKey: string; lat: number; lon: number };
type StoredRoutePath = {
  routeId: string;
  path: TrailCell[];
  supportMap: Map<string, TrailCell>;
};

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
    cellKey: row.cell_key,
    lat: Number(row.lat),
    lon: Number(row.lon),
  }));
}

async function fetchMountainRoutePaths(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<StoredRoutePath[]> {
  const { data: routes, error } = await supabase
    .from('routes')
    .select('id')
    .eq('mountain_id', mountainId);
  if (error || !routes) return [];

  const paths = await Promise.all(
    (routes as Array<{ id: string }>).map(async (route) => {
      const [cellsResult, transitionsResult] = await Promise.all([
        supabase.rpc('route_accumulated_cells', { p_route_id: route.id }),
        supabase
          .from('trail_cell_transitions')
          .select('from_cell_key, to_cell_key, transition_count, session_count, edge_cost')
          .eq('route_id', route.id),
      ]);

      if (cellsResult.error || transitionsResult.error) return null;

      const cells: TrailCell[] = ((cellsResult.data ?? []) as any[]).map((row) => ({
        cellKey: row.cell_key,
        lat: Number(row.lat),
        lon: Number(row.lon),
        pointCount: row.point_count,
        sessionCount: row.session_count,
        avgAccuracy: row.avg_accuracy ?? null,
        avgAltitude: row.avg_altitude ?? null,
        lastSeenAt: row.last_seen_at,
        qualityScore: row.quality_score ?? 0,
      })).filter((cell) => Number.isFinite(cell.lat) && Number.isFinite(cell.lon));

      if (cells.length === 0) return null;

      const transitions: TrailTransition[] = ((transitionsResult.data ?? []) as any[]).map((row) => ({
        fromCellKey: row.from_cell_key,
        toCellKey: row.to_cell_key,
        transitionCount: row.transition_count,
        sessionCount: row.session_count,
        edgeCost: row.edge_cost,
      }));

      const inferred = inferCanonicalRouteFromCells(cells, transitions);
      const cellByKey = new Map(cells.map((cell) => [cell.cellKey, cell]));
      const path = inferred.cellKeys
        .map((cellKey) => cellByKey.get(cellKey))
        .filter((cell): cell is TrailCell => cell !== undefined);
      return {
        routeId: route.id,
        path: path.length > 0 ? path : cells,
        supportMap: cellByKey,
      };
    }),
  );

  return paths.filter((path): path is StoredRoutePath => path !== null);
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

function supervisedRouteDecision(
  routeId: string,
  routePaths: StoredRouteTrajectory[],
  trajectory: RefinedTrajectory,
): RouteMatchDecision {
  const routePath = routePaths.find((route) => route.routeId === routeId);
  const metrics = routePath && routePath.path.length > 0
    ? weightedDiscreteFrechetTrajectory(trajectory.points, routePath.path)
    : null;
  return {
    routeId,
    accepted: true,
    method: metrics === null ? 'trajectory_match' : 'frechet_match',
    metrics,
    scoreMargin: null,
  };
}

function chooseRouteForTrajectory(
  sessionPath: TrajectoryPoint[],
  routePaths: StoredRouteTrajectory[],
): RouteMatchDecision {
  if (sessionPath.length < 2 || routePaths.length === 0) {
    return candidateResidualDecision();
  }

  const scored = routePaths
    .filter((routePath) => routePath.path.length >= 2)
    .map((routePath) => ({
      routeId: routePath.routeId,
      metrics: weightedDiscreteFrechetTrajectory(sessionPath, routePath.path),
    }))
    .sort((left, right) => left.metrics.score - right.metrics.score);

  const best = scored[0];
  if (!best) return candidateResidualDecision();

  const next = scored[1] ?? null;
  const scoreMargin = next === null
    ? Number.POSITIVE_INFINITY
    : next.metrics.score - best.metrics.score;
  const accepted =
    best.metrics.frechetDistance <= routeFrechetThresholdMeters &&
    best.metrics.overlapRatio >= routeOverlapThreshold &&
    scoreMargin >= routeScoreMarginThresholdMeters;

  return {
    routeId: accepted ? best.routeId : null,
    accepted,
    method: accepted ? 'trajectory_match' : 'candidate_residual',
    metrics: best.metrics,
    scoreMargin,
  };
}

export function findNearestRouteCell(
  sessionCell: TrailCell,
  storedCells: StoredRouteCell[],
): string | null {
  const exactCell = storedCells.find((stored) => stored.cellKey === sessionCell.cellKey);
  return exactCell?.routeId ?? null;
}

function chooseRouteForSessionPath(
  sessionPath: TrailCell[],
  routePaths: StoredRoutePath[],
): RouteMatchDecision {
  if (sessionPath.length === 0 || routePaths.length === 0) {
    return candidateResidualDecision();
  }

  const scored = routePaths
    .filter((routePath) => routePath.path.length > 0)
    .map((routePath) => ({
      routeId: routePath.routeId,
      metrics: weightedDiscreteFrechet(sessionPath, routePath.path, routePath.supportMap),
    }))
    .sort((left, right) => left.metrics.score - right.metrics.score);

  const best = scored[0];
  if (!best) return candidateResidualDecision();

  const next = scored[1] ?? null;
  const scoreMargin = next === null
    ? Number.POSITIVE_INFINITY
    : next.metrics.score - best.metrics.score;
  const exactOverlap = best.metrics.overlapRatio > 0;
  const frechetAccepted =
    best.metrics.frechetDistance <= routeFrechetThresholdMeters &&
    best.metrics.overlapRatio >= routeOverlapThreshold &&
    scoreMargin >= routeScoreMarginThresholdMeters;

  if (!exactOverlap && !frechetAccepted) {
    return {
      routeId: null,
      accepted: false,
      method: 'candidate_residual',
      metrics: best.metrics,
      scoreMargin,
    };
  }

  return {
    routeId: best.routeId,
    accepted: frechetAccepted,
    method: frechetAccepted && !exactOverlap ? 'frechet_match' : 'exact_overlap',
    metrics: best.metrics,
    scoreMargin,
  };
}

function candidateResidualDecision(): RouteMatchDecision {
  return {
    routeId: null,
    accepted: false,
    method: 'candidate_residual',
    metrics: null,
    scoreMargin: null,
  };
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

async function appendRouteTrajectoryEvidence(
  supabase: SupabaseClient,
  routeId: string,
  trajectory: RefinedTrajectory,
  existingRoute: StoredRouteTrajectory | null,
): Promise<string | null> {
  const existingWeight = Math.max(0, existingRoute?.sessionCount ?? 0);
  const line = existingRoute && existingRoute.path.length >= 2
    ? mergeTrajectoryLines(existingRoute.path, trajectory.points, Math.max(1, existingWeight), 1)
    : trajectory.points;
  const version = (existingRoute?.version ?? 0) + 1;
  const sessionCount = existingWeight + 1;
  const gpsQualityScore = qualityScore(trajectory.avgAccuracy);
  const confidence = routeConfidence(sessionCount, gpsQualityScore);

  const { error } = await supabase.from('canonical_trails').insert({
    route_id: routeId,
    version,
    geom: trajectoryLineWkt(line),
    confidence,
    confidence_level: confidence >= 0.70 && sessionCount >= 5 ? 'recommended' : 'reference',
    session_count: sessionCount,
    branch_ambiguity_score: 0,
    gps_quality_score: gpsQualityScore,
    algorithm_version: algorithmVersion,
    source_kind: 'trajectory_aggregate',
  });

  return error ? error.message : null;
}

async function saveCandidateTrajectory(
  supabase: SupabaseClient,
  mountainId: string,
  sessionId: string,
  trajectory: RefinedTrajectory,
): Promise<string | null> {
  const candidates = await fetchCandidateTrajectories(supabase, mountainId);
  const scored = candidates
    .filter((candidate) => candidate.path.length >= 2)
    .map((candidate) => ({
      candidate,
      metrics: weightedDiscreteFrechetTrajectory(trajectory.points, candidate.path),
    }))
    .sort((left, right) => left.metrics.score - right.metrics.score);
  const best = scored[0] ?? null;

  if (
    best &&
    best.metrics.frechetDistance <= candidateFrechetThresholdMeters &&
    best.metrics.overlapRatio >= routeOverlapThreshold
  ) {
    const alreadyContributed = best.candidate.contributingSessions.includes(sessionId);
    const sessionCount = best.candidate.sessionCount + (alreadyContributed ? 0 : 1);
    const pointCount = best.candidate.pointCount + trajectory.pointCount;
    const merged = mergeTrajectoryLines(
      best.candidate.path,
      trajectory.points,
      Math.max(1, best.candidate.sessionCount),
      1,
    );
    const { error } = await supabase
      .from('candidate_trajectories')
      .update({
        geom: trajectoryLineWkt(merged),
        point_count: pointCount,
        session_count: sessionCount,
        contributing_sessions: alreadyContributed
          ? best.candidate.contributingSessions
          : [...best.candidate.contributingSessions, sessionId],
        avg_accuracy: weightedNullableAverage(
          best.candidate.avgAccuracy,
          best.candidate.pointCount,
          trajectory.avgAccuracy,
          trajectory.pointCount,
        ),
        avg_altitude: weightedNullableAverage(
          best.candidate.avgAltitude,
          best.candidate.pointCount,
          trajectory.avgAltitude,
          trajectory.pointCount,
        ),
        length_m: trajectoryLengthMeters(merged),
        confidence: routeConfidence(sessionCount, qualityScore(trajectory.avgAccuracy)),
        latest_evidence_at: latestIso(best.candidate.latestEvidenceAt, trajectory.latestEvidenceAt),
        algorithm_version: algorithmVersion,
        updated_at: new Date().toISOString(),
      })
      .eq('id', best.candidate.id);
    return error ? null : best.candidate.id;
  }

  const { data, error } = await supabase
    .from('candidate_trajectories')
    .insert({
      mountain_id: mountainId,
      geom: trajectoryLineWkt(trajectory),
      point_count: trajectory.pointCount,
      session_count: 1,
      contributing_sessions: [sessionId],
      avg_accuracy: trajectory.avgAccuracy,
      avg_altitude: trajectory.avgAltitude,
      length_m: trajectory.lengthMeters,
      confidence: routeConfidence(1, qualityScore(trajectory.avgAccuracy)),
      latest_evidence_at: trajectory.latestEvidenceAt,
      algorithm_version: algorithmVersion,
    })
    .select('id')
    .single();
  if (error || !data) return null;
  return data.id;
}

async function saveSessionTrajectoryAttributions(
  supabase: SupabaseClient,
  sessionId: string,
  rows: SessionTrajectoryAttributionRow[],
): Promise<string | null> {
  const { error } = await supabase.rpc('replace_session_trajectory_attributions', {
    p_session_id: sessionId,
    p_rows: rows,
  });
  return error ? error.message : null;
}

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

async function saveSessionCellAttributions(
  supabase: SupabaseClient,
  sessionId: string,
  rows: SessionCellAttributionRow[],
): Promise<string | null> {
  const { error } = await supabase.rpc('replace_session_cell_attributions', {
    p_session_id: sessionId,
    p_rows: rows,
  });
  return error ? error.message : null;
}

async function recordSessionAssignment(
  supabase: SupabaseClient,
  sessionId: string,
  routeId: string,
  cellCount: number,
  transitionCount: number,
  diagnostics: RouteMatchDecision | null,
  matchedPointCount: number | null = null,
  matchedLengthMeters: number | null = null,
  residualLengthMeters: number | null = null,
): Promise<void> {
  await supabase.from('session_route_assignments').upsert(
    {
      session_id: sessionId,
      route_id: routeId,
      contributed_cell_count: cellCount,
      contributed_transition_count: transitionCount,
      match_method: diagnostics?.method ?? 'exact_overlap',
      frechet_distance: diagnostics?.metrics?.frechetDistance ?? null,
      overlap_ratio: diagnostics?.metrics?.overlapRatio ?? null,
      score_margin: diagnostics?.scoreMargin === Number.POSITIVE_INFINITY
        ? null
        : diagnostics?.scoreMargin ?? null,
      matched_point_count: matchedPointCount,
      matched_length_m: matchedLengthMeters,
      residual_length_m: residualLengthMeters,
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

export function buildSessionCellAttributionRows(
  mountainId: string,
  routeGroups: Map<string, TrailCell[]>,
  candidateCells: TrailCell[],
): SessionCellAttributionRow[] {
  const rows: SessionCellAttributionRow[] = [];

  for (const [routeId, routeCells] of routeGroups) {
    for (const cell of routeCells) {
      rows.push(cellAttributionRow(mountainId, 'route', routeId, cell));
    }
  }

  for (const cell of candidateCells) {
    rows.push(cellAttributionRow(mountainId, 'candidate', null, cell));
  }

  return rows;
}

function cellAttributionRow(
  mountainId: string,
  targetKind: 'route' | 'candidate',
  routeId: string | null,
  cell: TrailCell,
): SessionCellAttributionRow {
  return {
    mountainId,
    targetKind,
    routeId,
    cellKey: cell.cellKey,
    pointCount: cell.pointCount,
    avgAccuracy: cell.avgAccuracy,
    avgAltitude: cell.avgAltitude,
    lastSeenAt: cell.lastSeenAt,
  };
}

function trajectoryAttributionRow(
  mountainId: string,
  targetKind: 'route' | 'candidate',
  routeId: string | null,
  candidateTrajectoryId: string | null,
  trajectory: RefinedTrajectory,
  matchedLengthMeters: number,
  residualLengthMeters: number,
  metrics: TrajectoryMatchMetrics | null,
): SessionTrajectoryAttributionRow {
  return {
    mountainId,
    targetKind,
    routeId,
    candidateTrajectoryId,
    pointCount: trajectory.pointCount,
    avgAccuracy: trajectory.avgAccuracy,
    avgAltitude: trajectory.avgAltitude,
    matchedLengthMeters,
    residualLengthMeters,
    frechetDistance: metrics?.frechetDistance ?? null,
    overlapRatio: metrics?.overlapRatio ?? null,
    algorithmVersion,
  };
}

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

if (import.meta.main) {
  Deno.serve(handleMatchAndAggregateSessions);
}

function qualityScore(accuracy: number | null): number {
  if (accuracy === null) return 0.75;
  return Math.max(0, Math.min(1, 1 - accuracy / 100));
}

function routeConfidence(sessionCount: number, gpsQualityScore: number): number {
  const sessionSupportScore = Math.min(1, sessionCount / 5);
  return Math.max(0, Math.min(1,
    sessionSupportScore * 0.35 +
      gpsQualityScore * 0.20 +
      0.15 +
      0.15 +
      0.10 +
      0.05
  ));
}

function weightedNullableAverage(
  left: number | null,
  leftWeight: number,
  right: number | null,
  rightWeight: number,
): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return (left * leftWeight + right * rightWeight) / Math.max(1, leftWeight + rightWeight);
}

function latestIso(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(left) >= Date.parse(right) ? left : right;
}
