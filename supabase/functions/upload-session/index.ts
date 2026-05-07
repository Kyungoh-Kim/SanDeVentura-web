import { createClient } from 'npm:@supabase/supabase-js@2';

import { jsonResponse } from '../_shared/response.ts';
import {
  defaultSprint2DevUserId,
  parseUploadRequest,
  validateUploadPoints,
} from '../_shared/validation.ts';

type SupabaseClientLike = {
  from: (table: string) => any;
};

export async function handleUploadSession(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ success: false, errors: ['method_not_allowed'] }, 405);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ success: false, errors: ['invalid_json'] }, 400);
  }

  let payload;
  try {
    payload = parseUploadRequest(body);
  } catch (error) {
    return jsonResponse(
      { success: false, status: 'rejected', errors: [errorMessage(error)] },
      400,
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { success: false, errors: ['server_not_configured'] },
      500,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const devUserId = Deno.env.get('SPRINT2_DEV_USER_ID') ??
    defaultSprint2DevUserId;

  const existing = await supabase
    .from('hiking_sessions')
    .select('id, status, accepted_point_count, rejected_point_count, retention_review_at')
    .eq('user_id', devUserId)
    .eq('client_session_key', payload.idempotencyKey)
    .maybeSingle();

  if (existing.error) {
    return jsonResponse(
      { success: false, errors: [existing.error.message] },
      500,
    );
  }

  if (existing.data) {
    if (existing.data.status !== 'ingested') {
      return jsonResponse(
        { success: false, status: 'rejected', errors: ['upload_incomplete'] },
        409,
      );
    }

    return jsonResponse({
      success: true,
      sessionId: existing.data.id,
      acceptedPointCount: existing.data.accepted_point_count,
      rejectedPointCount: existing.data.rejected_point_count,
      retentionExpiresAt: existing.data.retention_review_at,
      status: 'duplicate',
      errors: [],
    });
  }

  const validation = validateUploadPoints(payload.points);
  await supabase.from('mountains').upsert({
    id: payload.mountainId,
    display_name: payload.mountainId,
    source: 'internal',
  });

  const insertedSession = await supabase
    .from('hiking_sessions')
    .insert({
      user_id: devUserId,
      mountain_id: payload.mountainId,
      client_session_key: payload.idempotencyKey,
      started_at: payload.startedAt,
      ended_at: payload.endedAt,
      status: 'ingesting',
      upload_consent_version: payload.uploadConsentVersion,
      accepted_point_count: 0,
      rejected_point_count: 0,
      retention_review_at: retentionReviewAt(),
    })
    .select('id, retention_review_at')
    .single();

  if (insertedSession.error) {
    const duplicate = await duplicateResponse(supabase, devUserId, payload.idempotencyKey);
    if (duplicate !== null) {
      return duplicate;
    }

    return jsonResponse(
      { success: false, errors: [insertedSession.error.message] },
      500,
    );
  }

  const sessionId = insertedSession.data.id as string;

  const acceptedInsert = validation.accepted.length === 0
    ? { error: null }
    : await supabase.from('track_points').insert(
      validation.accepted.map((point) => ({
        session_id: sessionId,
        mountain_id: payload.mountainId,
        recorded_at: point.recordedAt,
        geom: `POINT(${point.lon} ${point.lat})`,
        altitude: point.altitude,
        accuracy: point.accuracy,
        speed: point.speed,
        quality_score: point.qualityScore,
        sequence_index: point.sequenceIndex,
      })),
    );

  if (acceptedInsert.error) {
    await cleanupIncompleteSession(supabase, sessionId);
    return jsonResponse(
      { success: false, errors: [acceptedInsert.error.message] },
      500,
    );
  }

  const rejectedInsert = validation.rejected.length === 0
    ? { error: null }
    : await supabase.from('rejected_track_points').insert(
      validation.rejected.map((point) => ({
        session_id: sessionId,
        reason: point.reason,
        recorded_at: point.recordedAt,
        lat: point.lat,
        lon: point.lon,
        altitude: point.altitude,
        accuracy: point.accuracy,
        speed: point.speed,
        point_sequence_index: point.sequenceIndex,
        debug_payload_sample: {
          reason: point.reason,
          sequenceIndex: point.sequenceIndex,
        },
        debug_payload_expires_at: debugExpiresAt(),
      })),
    );

  if (rejectedInsert.error) {
    await cleanupIncompleteSession(supabase, sessionId);
    return jsonResponse(
      { success: false, errors: [rejectedInsert.error.message] },
      500,
    );
  }

  const finalStatus = validation.accepted.length === 0 ? 'rejected' : 'ingested';
  const updatedSession = await supabase
    .from('hiking_sessions')
    .update({
      status: finalStatus,
      accepted_point_count: validation.accepted.length,
      rejected_point_count: validation.rejected.length,
    })
    .eq('id', sessionId);

  if (updatedSession.error) {
    await cleanupIncompleteSession(supabase, sessionId);
    return jsonResponse(
      { success: false, errors: [updatedSession.error.message] },
      500,
    );
  }

  await supabase.from('mvp_events').insert({
    user_id: devUserId,
    mountain_id: payload.mountainId,
    session_id: sessionId,
    event_name: 'session_uploaded',
    event_payload: {
      status: finalStatus,
      acceptedPointCount: validation.accepted.length,
      rejectedPointCount: validation.rejected.length,
    },
  });

  return jsonResponse({
    success: finalStatus === 'ingested',
    sessionId,
    acceptedPointCount: validation.accepted.length,
    rejectedPointCount: validation.rejected.length,
    retentionExpiresAt: insertedSession.data.retention_review_at,
    status: finalStatus,
    errors: finalStatus === 'ingested' ? [] : ['no_accepted_points'],
  }, finalStatus === 'ingested' ? 200 : 400);
}

if (import.meta.main) {
  Deno.serve(handleUploadSession);
}

async function duplicateResponse(
  supabase: SupabaseClientLike,
  devUserId: string,
  idempotencyKey: string,
): Promise<Response | null> {
  const existing = await supabase
    .from('hiking_sessions')
    .select('id, status, accepted_point_count, rejected_point_count, retention_review_at')
    .eq('user_id', devUserId)
    .eq('client_session_key', idempotencyKey)
    .maybeSingle();

  if (!existing.data) {
    return null;
  }

  if (existing.data.status !== 'ingested') {
    return jsonResponse(
      { success: false, status: 'rejected', errors: ['upload_incomplete'] },
      409,
    );
  }

  return jsonResponse({
    success: true,
    sessionId: existing.data.id,
    acceptedPointCount: existing.data.accepted_point_count,
    rejectedPointCount: existing.data.rejected_point_count,
    retentionExpiresAt: existing.data.retention_review_at,
    status: 'duplicate',
    errors: [],
  });
}

async function cleanupIncompleteSession(
  supabase: SupabaseClientLike,
  sessionId: string,
): Promise<void> {
  await supabase.from('rejected_track_points').delete().eq('session_id', sessionId);
  await supabase.from('track_points').delete().eq('session_id', sessionId);
  await supabase.from('hiking_sessions').delete().eq('id', sessionId);
}

function retentionReviewAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 90);
  return date.toISOString();
}

function debugExpiresAt(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}
