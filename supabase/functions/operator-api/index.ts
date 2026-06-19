import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type SupabaseClient = any;

type OperatorRequest = {
  action?: string;
  mountainId?: string;
  routeId?: string;
  sessionId?: string;
  targetKind?: 'edge' | 'candidate';
  targetId?: string;
  bbox?: string | null;
  displayName?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function validateBboxOrNull(bbox: string | null | undefined): void {
  if (bbox == null) return;
  if (typeof bbox !== 'string') throw new Error('invalid_bbox');
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) throw new Error('invalid_bbox_format');
  const [minLon, minLat, maxLon, maxLat] = parts;
  // longitude must be within [-180, 180], latitude within [-90, 90]
  if (
    minLon < -180 || minLon > 180 || maxLon < -180 || maxLon > 180 ||
    minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90
  ) {
    throw new Error('invalid_bbox_range');
  }
  // min must be strictly less than max
  if (minLon >= maxLon || minLat >= maxLat) throw new Error('invalid_bbox_order');
}

export async function handleOperatorApi(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  let body: OperatorRequest;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, errors: ['invalid_json'] }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const data = await handleAction(supabase, body);
    return jsonResponse({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown_error';
    // Map well-known error suffixes to HTTP status codes:
    // - _required and invalid_* -> 400 (bad request)
    // - _conflict -> 409 (conflict, e.g. duplicate id)
    // otherwise -> 500
    let status = 500;
    if (message === 'unknown_action' || message.endsWith('_required') || message.startsWith('invalid_')) status = 400;
    if (message.endsWith('_conflict')) status = 409;
    return jsonResponse({ success: false, errors: [message] }, status);
  }
}

async function handleAction(supabase: SupabaseClient, body: OperatorRequest): Promise<unknown> {
  switch (body.action) {
    case 'operatorSummary':
      return maybeSingle(await supabase
        .from('operator_quality_summary')
        .select('upload_success_rate, queued_uploads, route_coverage, snap_requests, trail_served')
        .limit(1)
        .maybeSingle());

    case 'routeCoverage':
      return rows(await supabase
        .from('operator_route_coverage')
        .select('route_id, mountain_id, mountain_display_name, route_display_name, route_state, confidence, version, session_count, branch_ambiguity_score, gps_quality_score, updated_at')
        .order('mountain_id'));

    case 'routeQualityDetails':
      return rows(await supabase
        .from('operator_route_quality_detail')
        .select('route_id, mountain_id, mountain_display_name, route_display_name, route_state, confidence, version, session_count, branch_ambiguity_score, gps_quality_score, accepted_point_count, rejected_point_count, latest_evidence_at, updated_at')
        .order('mountain_id'));

    case 'routeDetail':
      requireParam(body.routeId, 'routeId');
      return routeDetail(supabase, body.routeId);

    case 'sessionIngestion':
      return rows(await supabase
        .from('operator_session_ingestion')
        .select('session_id, mountain_id, mountain_display_name, route_id, started_at, ended_at, created_at, pipeline_state, upload_state, consent_version, accepted_point_count, rejected_point_count, last_error, matched_route_count, matched_route_cell_count, matched_route_point_count, candidate_cell_count, candidate_point_count, attribution_precision, processed_algorithm_version, raw_retention_state, recomputable')
        .order('started_at', { ascending: false })
        .order('created_at', { ascending: false }));

    case 'sessionRouteAttribution':
      requireParam(body.sessionId, 'sessionId');
      return rows(await supabase
        .from('operator_session_route_attribution')
        .select('session_id, route_id, route_display_name, cell_count, point_count, transition_count, match_method, frechet_distance, overlap_ratio, score_margin, attribution_precision')
        .eq('session_id', body.sessionId)
        .order('route_id'));

    case 'sessionEdgeAttribution':
      requireParam(body.sessionId, 'sessionId');
      return rows(await supabase
        .from('operator_session_edge_attribution')
        .select('session_id, mountain_id, interval_index, target_kind, edge_id, route_id, route_display_name, candidate_edge_id, residual_kind, direction, session_start_measure_m, session_end_measure_m, edge_start_measure_m, edge_end_measure_m, attach_start_edge_id, attach_start_measure_m, attach_end_edge_id, attach_end_measure_m, point_count, avg_accuracy, avg_altitude, matched_length_m, algorithm_version, matched_at, raw_retention_state, recomputable')
        .eq('session_id', body.sessionId)
        .order('interval_index'));

    case 'trajectorySegmentMetrics':
      requireParam(body.targetKind, 'targetKind');
      requireParam(body.targetId, 'targetId');
      return rows(await supabase
        .from('operator_trail_edge_segment_metrics')
        .select('mountain_id, target_kind, target_id, edge_id, candidate_edge_id, direction, segment_index, start_measure_m, end_measure_m, session_count, sample_count, duration_seconds_avg, duration_seconds_sum, duration_observation_count, speed_mps_avg, elevation_gain_m, elevation_loss_m, abrupt_altitude_change_count, max_abs_altitude_delta_m, latest_evidence_at, algorithm_version, updated_at')
        .eq('target_kind', body.targetKind)
        .eq('target_id', body.targetId)
        .order('segment_index'));

    case 'candidateEdgeRows':
      return rows(await supabase
        .from('operator_candidate_edges')
        .select('id, mountain_id, mountain_display_name, trail_geojson, attach_start_edge_id, attach_start_measure_m, attach_end_edge_id, attach_end_measure_m, residual_kind, point_count, session_count, length_m, confidence, confidence_level, promotion_ready, validation_failure_reason, latest_evidence_at, algorithm_version, updated_at')
        .order('mountain_id')
        .order('promotion_ready', { ascending: false })
        .order('latest_evidence_at', { ascending: false }));

    case 'candidateEdgesForMountain':
      requireParam(body.mountainId, 'mountainId');
      return rows(await supabase.rpc('candidate_edges_for_mountain', {
        p_mountain_id: body.mountainId,
      }));

    case 'trailEdgesForMountain':
      requireParam(body.mountainId, 'mountainId');
      return rows(await supabase.rpc('trail_edges_for_mountain', {
        p_mountain_id: body.mountainId,
      }));

    case 'mountains':
      return rows(await supabase
        .from('mountains')
        .select('id, display_name, bbox')
        .order('display_name'));

    case 'updateMountainBbox':
      requireParam(body.mountainId, 'mountainId');
          validateBboxOrNull(body.bbox);
          return mutate(await supabase
            .from('mountains')
            .update({ bbox: body.bbox ?? null })
            .eq('id', body.mountainId));

    case 'updateMountain':
      requireParam(body.mountainId, 'mountainId');
      requireParam(body.displayName, 'displayName');
      // validate optional bbox string before attempting update
      validateBboxOrNull(body.bbox);
      return mutate(await supabase
        .from('mountains')
        .update({ display_name: body.displayName, bbox: body.bbox ?? null })
        .eq('id', body.mountainId));

    case 'createMountain':
      requireParam(body.mountainId, 'mountainId');
      requireParam(body.displayName, 'displayName');
      // validate optional bbox string before attempting insert
      validateBboxOrNull(body.bbox);
      // perform insert and translate unique-constraint errors to a clear code
      const result = await supabase
        .from('mountains')
        .insert({ id: body.mountainId, display_name: body.displayName, bbox: body.bbox ?? null });
      if (result.error) {
        const msg = String(result.error.message ?? 'database_error');
        const lower = msg.toLowerCase();
        if (lower.includes('duplicate') || lower.includes('unique') || lower.includes('already exists')) {
          throw new Error('mountain_id_conflict');
        }
        throw new Error(msg);
      }
      return null;

    case 'renameRoute':
      requireParam(body.routeId, 'routeId');
      requireParam(body.displayName, 'displayName');
      return mutate(await supabase
        .from('routes')
        .update({ display_name: body.displayName })
        .eq('id', body.routeId));

    default:
      throw new Error('unknown_action');
  }
}

async function routeDetail(supabase: SupabaseClient, routeId: string): Promise<unknown> {
  const result = await supabase.rpc('latest_canonical_trail', {
    p_route_id: routeId,
  });
  const data = rows(result);
  if (data[0]) return data[0];

  const routeLookup = maybeSingle(await supabase
    .from('routes')
    .select('mountain_id')
    .eq('id', routeId)
    .maybeSingle()) as { mountain_id: string } | null;

  return routeLookup
    ? {
      route_id: routeId,
      mountain_id: routeLookup.mountain_id,
      mountain_name: null,
      route_name: null,
      route_state: 'none',
      version: null,
      confidence: null,
      updated_at: null,
      trail_geojson: null,
      session_count: 0,
      branch_ambiguity_score: null,
      gps_quality_score: null,
    }
    : null;
}

function requireParam(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name}_required`);
  }
}

function rows(result: { data: unknown[] | null; error: { message: string } | null }): unknown[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

function maybeSingle(result: { data: unknown | null; error: { message: string } | null }): unknown | null {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? null;
}

function mutate(result: { error: { message: string } | null }): null {
  if (result.error) throw new Error(result.error.message);
  return null;
}

if (import.meta.main) {
  Deno.serve(handleOperatorApi);
}
