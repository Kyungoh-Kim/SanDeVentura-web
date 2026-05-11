import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  computeSplitPlan,
  detectBranchCandidates,
  type CrossTransitionRow,
  type MountainCtx,
  type SplitPlan,
} from '../_shared/route_split_detection.ts';
import {
  inferCanonicalRouteFromCells,
  lineStringWkt,
  type TrailCell,
  type TrailTransition,
} from '../_shared/route_inference.ts';

type SupabaseClient = ReturnType<typeof createClient>;

export async function handleEvaluateRouteSplits(
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

  let body: unknown;
  try { body = await request.json(); } catch { body = {}; }

  const mountainId = (body as any)?.mountainId as string | undefined;
  const dryRun: boolean = (body as any)?.dryRun !== false;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const mountainIds = mountainId
    ? [mountainId]
    : await fetchAllMountainIdsWithCandidates(supabase);

  const allPlans: SplitPlan[] = [];
  const errors: string[] = [];

  for (const mId of mountainIds) {
    try {
      const ctx = await buildMountainCtx(supabase, mId);
      const candidates = detectBranchCandidates(ctx);

      for (const candidate of candidates) {
        const routeCells = ctx.routeCells.get(candidate.originalRouteId) ?? [];
        const routeTransitions = ctx.routeTransitions.get(candidate.originalRouteId) ?? [];
        const branchCells = [...candidate.clusterCellKeys]
          .map((k) => ctx.candidateCells.find((c) => c.cellKey === k))
          .filter((c): c is TrailCell => c !== undefined);
        const branchTransitions = ctx.candidateTransitions.filter(
          (t) =>
            candidate.clusterCellKeys.has(t.fromCellKey) &&
            candidate.clusterCellKeys.has(t.toCellKey),
        );

        const plan = computeSplitPlan(
          mId,
          candidate.originalRouteId,
          routeCells,
          routeTransitions,
          candidate.branchPointCellKey,
          branchCells,
          branchTransitions,
          candidate.cfgConfidence,
          candidate.crossBranchRatio,
          candidate.contributingSessions,
        );

        await recordAudit(supabase, plan, dryRun);

        if (!dryRun && plan.valid) {
          const execError = await executeSplit(supabase, plan, ctx);
          if (execError) {
            errors.push(`${mId}/${candidate.originalRouteId}: ${execError}`);
          } else {
            await recomputeAffectedRoutes(supabase, plan);
          }
        }

        allPlans.push(plan);
      }
    } catch (e) {
      errors.push(`${mId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return jsonResponse({
    success: errors.length === 0,
    dryRun,
    plansEvaluated: allPlans.length,
    plansValid: allPlans.filter((p) => p.valid).length,
    plans: allPlans,
    errors,
  });
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchAllMountainIdsWithCandidates(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from('candidate_cell_clusters')
    .select('mountain_id');
  return (data ?? []).map((r: any) => r.mountain_id as string);
}

async function buildMountainCtx(
  supabase: SupabaseClient,
  mountainId: string,
): Promise<MountainCtx> {
  const [
    candidateCellsResult,
    candidateTransitionsResult,
    crossTransitionsResult,
  ] = await Promise.all([
    supabase.rpc('candidate_cells_for_mountain', { p_mountain_id: mountainId }),
    supabase.rpc('candidate_cell_transitions_for_mountain', { p_mountain_id: mountainId }),
    supabase.rpc('route_to_candidate_transitions_for_mountain', { p_mountain_id: mountainId }),
  ]);

  const candidateCells: TrailCell[] = ((candidateCellsResult.data ?? []) as any[]).map((row) => ({
    cellKey: row.cell_key,
    lat: Number(row.lat),
    lon: Number(row.lon),
    pointCount: row.point_count,
    sessionCount: row.session_count,
    avgAccuracy: row.avg_accuracy ?? null,
    avgAltitude: row.avg_altitude ?? null,
    lastSeenAt: row.last_seen_at,
    qualityScore: 0.7,
    contributingSessions: row.contributing_sessions ?? [],
  }));

  const candidateTransitions: TrailTransition[] = ((candidateTransitionsResult.data ?? []) as any[]).map((row) => ({
    fromCellKey: row.from_cell_key,
    toCellKey: row.to_cell_key,
    transitionCount: row.transition_count,
    sessionCount: row.session_count,
    edgeCost: 1.0 / Math.max(1, row.transition_count),
  }));

  const crossTransitions: CrossTransitionRow[] = ((crossTransitionsResult.data ?? []) as any[]).map((row) => ({
    routeId: row.route_id,
    fromCellKey: row.from_cell_key,
    toCellKey: row.to_cell_key,
    direction: row.direction as 'route_to_candidate' | 'candidate_to_route',
    sessionCount: row.session_count,
    transitionCount: row.transition_count,
    contributingSessions: row.contributing_sessions ?? [],
  }));

  // Collect unique route IDs that appear in cross transitions
  const involvedRouteIds = new Set(crossTransitions.map((t) => t.routeId));
  const routeCells = new Map<string, TrailCell[]>();
  const routeTransitions = new Map<string, TrailTransition[]>();

  await Promise.all(
    [...involvedRouteIds].map(async (routeId) => {
      const [cellsResult, transitionsResult] = await Promise.all([
        supabase.rpc('route_accumulated_cells', { p_route_id: routeId }),
        supabase
          .from('trail_cell_transitions')
          .select('from_cell_key, to_cell_key, transition_count, session_count, edge_cost')
          .eq('route_id', routeId),
      ]);

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
      }));

      const transitions: TrailTransition[] = ((transitionsResult.data ?? []) as any[]).map((row) => ({
        fromCellKey: row.from_cell_key,
        toCellKey: row.to_cell_key,
        transitionCount: row.transition_count,
        sessionCount: row.session_count,
        edgeCost: row.edge_cost,
      }));

      routeCells.set(routeId, cells);
      routeTransitions.set(routeId, transitions);
    }),
  );

  return { mountainId, candidateCells, candidateTransitions, crossTransitions, routeCells, routeTransitions };
}

// ── Audit recording ───────────────────────────────────────────────────────────

async function recordAudit(
  supabase: SupabaseClient,
  plan: SplitPlan,
  dryRun: boolean,
): Promise<void> {
  await supabase.from('route_split_audit').insert({
    mountain_id: plan.mountainId,
    original_route_id: plan.originalRouteId,
    branch_point_cell_key: plan.branchPointCellKey,
    segment_a_route_id: plan.valid ? plan.originalRouteId : null,
    segment_b_route_id: plan.valid ? plan.newSegmentBRouteId : null,
    branch_route_id: plan.valid ? plan.newBranchRouteId : null,
    cfg_confidence: plan.cfgConfidence,
    cross_branch_ratio: plan.crossBranchRatio,
    affected_session_count: plan.affectedSessions.length,
    dry_run: dryRun,
  });
}

// ── Split execution (Phase 4 — stub until split_route_atomic RPC is ready) ───

async function executeSplit(
  supabase: SupabaseClient,
  plan: SplitPlan,
  ctx: MountainCtx,
): Promise<string | null> {
  const { error } = await supabase.rpc('split_route_atomic', {
    p_mountain_id: plan.mountainId,
    p_original_route_id: plan.originalRouteId,
    p_branch_point_cell_key: plan.branchPointCellKey,
    p_segment_b_route_id: plan.newSegmentBRouteId,
    p_segment_b_cell_keys: plan.segmentBCellKeys,
    p_branch_route_id: plan.newBranchRouteId,
    p_branch_cell_keys: plan.branchCellKeys,
  });

  if (!error) {
    const attributionSync = await supabase.rpc('sync_session_cell_attributions_after_split', {
      p_mountain_id: plan.mountainId,
      p_original_route_id: plan.originalRouteId,
      p_branch_point_cell_key: plan.branchPointCellKey,
      p_segment_b_route_id: plan.newSegmentBRouteId,
      p_segment_b_cell_keys: plan.segmentBCellKeys,
      p_branch_route_id: plan.newBranchRouteId,
      p_branch_cell_keys: plan.branchCellKeys,
    });
    if (attributionSync.error) return attributionSync.error.message;
  }

  void ctx;
  return error ? error.message : null;
}

// ── Post-split confidence recompute ───────────────────────────────────────────

async function recomputeAffectedRoutes(
  supabase: SupabaseClient,
  plan: SplitPlan,
): Promise<void> {
  const routeIds = [plan.originalRouteId, plan.newSegmentBRouteId, plan.newBranchRouteId];

  await Promise.all(routeIds.map((routeId) => recomputeRouteConfidence(supabase, routeId)));
}

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
  const route = inferCanonicalRouteFromCells(cells, transitions, {
    acceptedPointCount: qualityRow?.accepted_point_count,
    rejectedPointCount: qualityRow?.rejected_point_count,
    latestEvidenceAt: qualityRow?.latest_evidence_at ?? null,
    sessionCount: sessionCountResult.count ?? undefined,
  });

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

if (import.meta.main) {
  Deno.serve(handleEvaluateRouteSplits);
}
