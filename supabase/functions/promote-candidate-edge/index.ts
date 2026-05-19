import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  trajectoryLengthMeters,
  trajectoryLineWkt,
  type TrajectoryPoint,
} from '../_shared/route_inference.ts';

type SupabaseClient = any;

const algorithmVersion = 'trail-graph-v1';

type CandidateEdge = {
  id: string;
  mountainId: string;
  path: TrajectoryPoint[];
  attachStartEdgeId: string | null;
  attachStartMeasureMeters: number | null;
  attachEndEdgeId: string | null;
  attachEndMeasureMeters: number | null;
  confidence: number | null;
  promotionReady: boolean;
  validationFailureReason: string | null;
};

type TrailEdge = {
  id: string;
  mountainId: string;
  routeId: string | null;
  fromNodeId: string | null;
  toNodeId: string | null;
  path: TrajectoryPoint[];
  sessionCount: number;
  pointCount: number;
  confidence: number | null;
  status: string;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export async function handlePromoteCandidateEdge(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ success: false, errors: ['invalid_json'] }, 400);
  }

  if (!isRecord(body) || typeof body.candidateEdgeId !== 'string') {
    return jsonResponse({ success: false, errors: ['candidateEdgeId is required'] }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  return promoteCandidateEdge(
    supabase,
    body.candidateEdgeId,
    typeof body.displayName === 'string' ? body.displayName.trim() : null,
  );
}

async function promoteCandidateEdge(
  supabase: SupabaseClient,
  candidateEdgeId: string,
  displayName: string | null,
): Promise<Response> {
  const candidate = await fetchCandidateEdge(supabase, candidateEdgeId);
  if (candidate === null) {
    return jsonResponse({ success: false, errors: ['candidate_edge_not_found'] }, 404);
  }
  if (!candidate.promotionReady) {
    return jsonResponse({
      success: false,
      errors: [candidate.validationFailureReason ?? 'candidate_edge_not_ready'],
    }, 400);
  }

  const edges = await fetchTrailEdges(supabase, candidate.mountainId);
  const createdNodeIds: string[] = [];
  const splitEdgeIds: string[] = [];
  const retiredEdgeIds: string[] = [];

  const start = await resolveAttachNode(
    supabase,
    candidate.mountainId,
    candidate.path[0],
    candidate.attachStartEdgeId,
    candidate.attachStartMeasureMeters,
    edges,
  );
  createdNodeIds.push(...start.createdNodeIds);
  splitEdgeIds.push(...start.splitEdgeIds);
  retiredEdgeIds.push(...start.retiredEdgeIds);

  const refreshedEdges = start.splitEdgeIds.length > 0 ? await fetchTrailEdges(supabase, candidate.mountainId) : edges;
  const end = await resolveAttachNode(
    supabase,
    candidate.mountainId,
    candidate.path[candidate.path.length - 1],
    candidate.attachEndEdgeId,
    candidate.attachEndMeasureMeters,
    refreshedEdges,
  );
  createdNodeIds.push(...end.createdNodeIds);
  splitEdgeIds.push(...end.splitEdgeIds);
  retiredEdgeIds.push(...end.retiredEdgeIds);

  const routeId = displayName ? await createRoute(supabase, candidate.mountainId, displayName) : null;
  const { data: promoted, error: edgeError } = await supabase
    .from('trail_edges')
    .insert({
      mountain_id: candidate.mountainId,
      route_id: routeId,
      from_node_id: start.nodeId,
      to_node_id: end.nodeId,
      geom: trajectoryLineWkt(candidate.path),
      length_m: trajectoryLengthMeters(candidate.path),
      session_count: 0,
      point_count: 0,
      confidence: candidate.confidence,
      status: 'recommended',
      algorithm_version: algorithmVersion,
    })
    .select('id')
    .single();
  if (edgeError || !promoted) {
    return jsonResponse({ success: false, errors: [edgeError?.message ?? 'edge_insert_failed'] }, 500);
  }

  await supabase
    .from('session_edge_attributions')
    .update({
      target_kind: 'edge',
      edge_id: promoted.id,
      candidate_edge_id: null,
      residual_kind: null,
      matched_at: new Date().toISOString(),
    })
    .eq('target_kind', 'candidate')
    .eq('candidate_edge_id', candidate.id);

  await supabase
    .from('session_edge_metric_slices')
    .update({
      target_kind: 'edge',
      edge_id: promoted.id,
      candidate_edge_id: null,
    })
    .eq('target_kind', 'candidate')
    .eq('candidate_edge_id', candidate.id);

  const { data: support } = await supabase
    .from('session_edge_attributions')
    .select('session_id, point_count')
    .eq('edge_id', promoted.id);
  const sessionCount = new Set((support ?? []).map((row: any) => row.session_id)).size;
  const pointCount = (support ?? []).reduce((total: number, row: any) => total + (row.point_count ?? 0), 0);
  await supabase
    .from('trail_edges')
    .update({
      session_count: sessionCount,
      point_count: pointCount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', promoted.id);

  await supabase
    .from('candidate_edges')
    .update({ status: 'promoted', updated_at: new Date().toISOString() })
    .eq('id', candidate.id);

  await supabase.rpc('rebuild_trail_edge_segment_metrics');

  if (routeId !== null) {
    await supabase.from('canonical_trails').insert({
      route_id: routeId,
      version: 1,
      geom: trajectoryLineWkt(candidate.path),
      confidence: candidate.confidence,
      confidence_level: 'recommended',
      session_count: sessionCount,
      branch_ambiguity_score: 0,
      gps_quality_score: 0.75,
      algorithm_version: algorithmVersion,
      source_kind: 'trail_graph_candidate_promotion',
    });
  }

  return jsonResponse({
    success: true,
    candidateEdgeId: candidate.id,
    promotedEdgeId: promoted.id,
    createdNodeIds,
    splitEdgeIds,
    retiredEdgeIds,
    confidence: candidate.confidence,
    status: 'promoted',
  });
}

async function fetchCandidateEdge(
  supabase: SupabaseClient,
  candidateEdgeId: string,
): Promise<CandidateEdge | null> {
  const { data, error } = await supabase
    .from('operator_candidate_edges')
    .select('id, mountain_id, trail_geojson, attach_start_edge_id, attach_start_measure_m, attach_end_edge_id, attach_end_measure_m, confidence, promotion_ready, validation_failure_reason')
    .eq('id', candidateEdgeId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    id: data.id,
    mountainId: data.mountain_id,
    path: parseGeoJsonLine(data.trail_geojson),
    attachStartEdgeId: data.attach_start_edge_id ?? null,
    attachStartMeasureMeters: data.attach_start_measure_m ?? null,
    attachEndEdgeId: data.attach_end_edge_id ?? null,
    attachEndMeasureMeters: data.attach_end_measure_m ?? null,
    confidence: data.confidence ?? null,
    promotionReady: data.promotion_ready === true,
    validationFailureReason: data.validation_failure_reason ?? null,
  };
}

async function fetchTrailEdges(supabase: SupabaseClient, mountainId: string): Promise<TrailEdge[]> {
  const { data, error } = await supabase.rpc('trail_edges_for_mountain', {
    p_mountain_id: mountainId,
  });
  if (error || !data) return [];
  return (data as any[])
    .map((row) => ({
      id: row.id,
      mountainId: row.mountain_id,
      routeId: row.route_id ?? null,
      fromNodeId: row.from_node_id ?? null,
      toNodeId: row.to_node_id ?? null,
      path: parseGeoJsonLine(row.trail_geojson),
      sessionCount: row.session_count ?? 0,
      pointCount: row.point_count ?? 0,
      confidence: row.confidence ?? null,
      status: row.status ?? 'reference',
    }))
    .filter((edge) => edge.path.length >= 2);
}

async function resolveAttachNode(
  supabase: SupabaseClient,
  mountainId: string,
  fallbackPoint: TrajectoryPoint,
  edgeId: string | null,
  measureMeters: number | null,
  edges: TrailEdge[],
): Promise<{ nodeId: string | null; createdNodeIds: string[]; splitEdgeIds: string[]; retiredEdgeIds: string[] }> {
  if (edgeId === null || measureMeters === null) {
    const nodeId = await createNode(supabase, mountainId, 'endpoint', fallbackPoint);
    return { nodeId, createdNodeIds: nodeId ? [nodeId] : [], splitEdgeIds: [], retiredEdgeIds: [] };
  }

  const edge = edges.find((item) => item.id === edgeId);
  if (!edge) {
    const nodeId = await createNode(supabase, mountainId, 'endpoint', fallbackPoint);
    return { nodeId, createdNodeIds: nodeId ? [nodeId] : [], splitEdgeIds: [], retiredEdgeIds: [] };
  }

  const lengthMeters = trajectoryLengthMeters(edge.path);
  if (measureMeters <= 25) {
    return { nodeId: edge.fromNodeId, createdNodeIds: [], splitEdgeIds: [], retiredEdgeIds: [] };
  }
  if (lengthMeters - measureMeters <= 25) {
    return { nodeId: edge.toNodeId, createdNodeIds: [], splitEdgeIds: [], retiredEdgeIds: [] };
  }

  const point = interpolateAtMeasure(edge.path, measureMeters);
  const nodeId = await createNode(supabase, mountainId, 'junction', point);
  if (nodeId === null) {
    return { nodeId: null, createdNodeIds: [], splitEdgeIds: [], retiredEdgeIds: [] };
  }

  const split = splitPathAtMeasure(edge.path, measureMeters);
  const first = await createSplitEdge(supabase, edge, edge.fromNodeId, nodeId, split.left);
  const second = await createSplitEdge(supabase, edge, nodeId, edge.toNodeId, split.right);
  await supabase.from('trail_edges').update({ status: 'retired' }).eq('id', edge.id);

  const splitEdgeIds = [first, second].filter((id): id is string => id !== null);
  await reassignSplitEvidence(supabase, edge.id, first, second, measureMeters);

  return {
    nodeId,
    createdNodeIds: [nodeId],
    splitEdgeIds,
    retiredEdgeIds: [edge.id],
  };
}

async function createRoute(
  supabase: SupabaseClient,
  mountainId: string,
  displayName: string,
): Promise<string | null> {
  let slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) slug = Date.now().toString(36);
  let routeId = `${mountainId}-${slug}`;
  const { data: existing } = await supabase.from('routes').select('id').eq('id', routeId).maybeSingle();
  if (existing) routeId = `${routeId}-${Date.now().toString(36)}`;
  const { error } = await supabase.from('routes').insert({
    id: routeId,
    mountain_id: mountainId,
    display_name: displayName,
  });
  return error ? null : routeId;
}

async function createNode(
  supabase: SupabaseClient,
  mountainId: string,
  kind: 'endpoint' | 'junction' | 'synthetic',
  point: TrajectoryPoint,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('trail_nodes')
    .insert({
      mountain_id: mountainId,
      kind,
      geom: `POINT(${point.lon} ${point.lat})`,
      support_count: 1,
      confidence: 0.75,
      algorithm_version: algorithmVersion,
    })
    .select('id')
    .single();
  return error || !data ? null : data.id;
}

async function createSplitEdge(
  supabase: SupabaseClient,
  source: TrailEdge,
  fromNodeId: string | null,
  toNodeId: string | null,
  path: TrajectoryPoint[],
): Promise<string | null> {
  if (path.length < 2) return null;
  const { data, error } = await supabase
    .from('trail_edges')
    .insert({
      mountain_id: source.mountainId,
      route_id: source.routeId,
      from_node_id: fromNodeId,
      to_node_id: toNodeId,
      geom: trajectoryLineWkt(path),
      length_m: trajectoryLengthMeters(path),
      session_count: source.sessionCount,
      point_count: Math.floor(source.pointCount / 2),
      confidence: source.confidence,
      status: source.status === 'retired' ? 'reference' : source.status,
      algorithm_version: algorithmVersion,
    })
    .select('id')
    .single();
  return error || !data ? null : data.id;
}

async function reassignSplitEvidence(
  supabase: SupabaseClient,
  retiredEdgeId: string,
  firstEdgeId: string | null,
  secondEdgeId: string | null,
  splitMeasureMeters: number,
): Promise<void> {
  if (firstEdgeId) {
    await supabase
      .from('session_edge_attributions')
      .update({ edge_id: firstEdgeId })
      .eq('edge_id', retiredEdgeId)
      .lte('edge_end_measure_m', splitMeasureMeters);
    await supabase
      .from('session_edge_metric_slices')
      .update({ edge_id: firstEdgeId })
      .eq('edge_id', retiredEdgeId)
      .lte('end_measure_m', splitMeasureMeters);
  }
  if (secondEdgeId) {
    await supabase
      .from('session_edge_attributions')
      .update({ edge_id: secondEdgeId })
      .eq('edge_id', retiredEdgeId)
      .gt('edge_start_measure_m', splitMeasureMeters);
    await supabase
      .from('session_edge_metric_slices')
      .update({ edge_id: secondEdgeId })
      .eq('edge_id', retiredEdgeId)
      .gt('start_measure_m', splitMeasureMeters);
  }
}

function splitPathAtMeasure(path: TrajectoryPoint[], measureMeters: number): { left: TrajectoryPoint[]; right: TrajectoryPoint[] } {
  const point = interpolateAtMeasure(path, measureMeters);
  const left: TrajectoryPoint[] = [];
  const right: TrajectoryPoint[] = [point];
  let consumed = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const segmentLength = haversineMeters(previous, current);
    if (consumed + segmentLength < measureMeters) {
      left.push(previous);
    } else if (consumed <= measureMeters && consumed + segmentLength >= measureMeters) {
      left.push(previous, point);
      right.push(current);
    } else {
      right.push(current);
    }
    consumed += segmentLength;
  }
  return {
    left: dedupeLine(left),
    right: dedupeLine(right),
  };
}

function interpolateAtMeasure(path: TrajectoryPoint[], measureMeters: number): TrajectoryPoint {
  let consumed = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const segmentLength = haversineMeters(previous, current);
    if (consumed + segmentLength >= measureMeters) {
      const ratio = segmentLength === 0 ? 0 : (measureMeters - consumed) / segmentLength;
      return {
        lat: previous.lat + (current.lat - previous.lat) * ratio,
        lon: previous.lon + (current.lon - previous.lon) * ratio,
      };
    }
    consumed += segmentLength;
  }
  return path[path.length - 1];
}

function dedupeLine(path: TrajectoryPoint[]): TrajectoryPoint[] {
  return path.filter((point, index) =>
    index === 0 || point.lat !== path[index - 1].lat || point.lon !== path[index - 1].lon
  );
}

function parseGeoJsonLine(value: unknown): TrajectoryPoint[] {
  const geometry = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!isRecord(geometry) || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
    return [];
  }

  return geometry.coordinates
    .map((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
      const lon = Number(coordinate[0]);
      const lat = Number(coordinate[1]);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    })
    .filter((point): point is TrajectoryPoint => point !== null);
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function haversineMeters(left: TrajectoryPoint, right: TrajectoryPoint): number {
  const R = 6_371_000;
  const dLat = (right.lat - left.lat) * Math.PI / 180;
  const dLon = (right.lon - left.lon) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(left.lat * Math.PI / 180) * Math.cos(right.lat * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

if (import.meta.main) {
  Deno.serve(handlePromoteCandidateEdge);
}
