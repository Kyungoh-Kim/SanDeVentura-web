import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';

const onRouteMeters = 25;
const awayFromRouteMeters = 50;

export async function handleSnapPosition(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ success: false, errors: ['invalid_json'] }, 400);
  }

  if (!isRecord(body)) {
    return jsonResponse({ success: false, errors: ['request_body must be an object'] }, 400);
  }

  const mountainId = requiredString(body.mountainId, 'mountainId');
  const lat = requiredCoordinate(body.lat, 'lat', -90, 90);
  const lon = requiredCoordinate(body.lon, 'lon', -180, 180);
  const accuracy = typeof body.accuracy === 'number' && Number.isFinite(body.accuracy)
    ? body.accuracy
    : null;

  if (mountainId instanceof Response) return mountainId;
  if (lat instanceof Response) return lat;
  if (lon instanceof Response) return lon;

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, errors: ['server_not_configured'] }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const result = await supabase.rpc('snap_position_to_trail', {
    p_mountain_id: mountainId,
    p_lat: lat,
    p_lon: lon,
  });

  if (result.error) {
    return jsonResponse({ success: false, errors: [result.error.message] }, 500);
  }

  const row = result.data?.[0];
  if (!row) {
    return jsonResponse({
      success: false,
      status: 'no_canonical_trail',
      errors: ['no_canonical_trail'],
    }, 404);
  }

  const distanceMeters = row.distance_meters as number;
  const routeJudgment = judgeDistance(distanceMeters);
  await supabase.from('mvp_events').insert({
    mountain_id: mountainId,
    event_name: 'snap_requested',
    event_payload: {
      routeJudgment,
      distanceBucket: distanceBucket(distanceMeters),
      trailVersion: row.trail_version,
    },
  });

  return jsonResponse({
    success: true,
    input: { mountainId, lat, lon, accuracy },
    snapped: {
      lat: row.snapped_lat,
      lon: row.snapped_lon,
    },
    distanceMeters,
    routeJudgment,
    onTrail: routeJudgment === 'on_route',
    thresholds: {
      onRouteMeters,
      awayFromRouteMeters,
    },
    trailVersion: row.trail_version,
    routeState: row.route_state,
  });
}

if (import.meta.main) {
  Deno.serve(handleSnapPosition);
}

function requiredString(value: unknown, fieldName: string): string | Response {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return jsonResponse({ success: false, errors: [`${fieldName} is required`] }, 400);
  }
  return value;
}

function requiredCoordinate(
  value: unknown,
  fieldName: string,
  minimum: number,
  maximum: number,
): number | Response {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    return jsonResponse({ success: false, errors: [`invalid_${fieldName}`] }, 400);
  }
  return value;
}

export function judgeDistance(distanceMeters: number): 'on_route' | 'caution' | 'away_from_route' {
  if (distanceMeters <= onRouteMeters) {
    return 'on_route';
  }
  if (distanceMeters <= awayFromRouteMeters) {
    return 'caution';
  }
  return 'away_from_route';
}

function distanceBucket(distanceMeters: number): string {
  if (distanceMeters <= onRouteMeters) {
    return '0-25m';
  }
  if (distanceMeters <= awayFromRouteMeters) {
    return '26-50m';
  }
  return '>50m';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
