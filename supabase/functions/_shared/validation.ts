export const uploadConsentVersion = 'beta-upload-consent-v1';
export const defaultSprint2DevUserId = '00000000-0000-4000-8000-000000000001';

export type UploadPoint = {
  recordedAt?: unknown;
  lat?: unknown;
  lon?: unknown;
  altitude?: unknown;
  accuracy?: unknown;
  speed?: unknown;
  sequenceIndex?: unknown;
};

export type UploadRequest = {
  idempotencyKey: string;
  uploadConsentVersion: string;
  mountainId: string;
  startedAt: string;
  endedAt: string;
  points: UploadPoint[];
};

export type AcceptedPoint = {
  recordedAt: string;
  lat: number;
  lon: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  sequenceIndex: number;
  qualityScore: number;
};

export type RejectedPoint = {
  reason: string;
  recordedAt: string | null;
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  sequenceIndex: number | null;
};

export type PointValidationResult = {
  accepted: AcceptedPoint[];
  rejected: RejectedPoint[];
};

export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

export function parseUploadRequest(value: unknown): UploadRequest {
  if (!isRecord(value)) {
    throw new Error('request_body must be an object');
  }

  const idempotencyKey = requireString(value.idempotencyKey, 'idempotencyKey');
  const consentVersion = requireString(
    value.uploadConsentVersion,
    'uploadConsentVersion',
  );
  const mountainId = requireString(value.mountainId, 'mountainId');
  const startedAt = requireIsoDate(value.startedAt, 'startedAt');
  const endedAt = requireIsoDate(value.endedAt, 'endedAt');

  if (consentVersion !== uploadConsentVersion) {
    throw new Error('unsupported_upload_consent_version');
  }

  if (!Array.isArray(value.points)) {
    throw new Error('points is required');
  }

  return {
    idempotencyKey,
    uploadConsentVersion: consentVersion,
    mountainId,
    startedAt,
    endedAt,
    points: value.points as UploadPoint[],
  };
}

export function validateUploadPoints(points: UploadPoint[]): PointValidationResult {
  const accepted: AcceptedPoint[] = [];
  const rejected: RejectedPoint[] = [];
  const seenSequences = new Set<number>();

  for (const point of points) {
    const normalized = normalizePoint(point);
    const duplicateSequence = normalized.sequenceIndex !== null &&
      seenSequences.has(normalized.sequenceIndex);
    if (normalized.sequenceIndex !== null) {
      seenSequences.add(normalized.sequenceIndex);
    }
    const reason = rejectionReason(normalized, duplicateSequence);

    if (reason !== null) {
      rejected.push({ ...normalized, reason });
      continue;
    }

    accepted.push({
      recordedAt: normalized.recordedAt as string,
      lat: normalized.lat as number,
      lon: normalized.lon as number,
      altitude: normalized.altitude,
      accuracy: normalized.accuracy,
      speed: normalized.speed,
      sequenceIndex: normalized.sequenceIndex as number,
      qualityScore: qualityScore(normalized.accuracy),
    });
  }

  accepted.sort((left, right) => left.sequenceIndex - right.sequenceIndex);
  rejected.sort((left, right) => (left.sequenceIndex ?? 0) - (right.sequenceIndex ?? 0));

  return { accepted, rejected };
}

function normalizePoint(point: UploadPoint): Omit<RejectedPoint, 'reason'> {
  const record = isRecord(point) ? point : {};
  return {
    recordedAt: optionalIsoDate(record.recordedAt),
    lat: optionalNumber(record.lat),
    lon: optionalNumber(record.lon),
    altitude: optionalNumber(record.altitude),
    accuracy: optionalNumber(record.accuracy),
    speed: optionalNumber(record.speed),
    sequenceIndex: optionalInteger(record.sequenceIndex),
  };
}

function rejectionReason(
  point: Omit<RejectedPoint, 'reason'>,
  duplicateSequence: boolean,
): string | null {
  if (point.recordedAt === null) {
    return 'missing_recorded_at';
  }
  if (point.lat === null || point.lat < -90 || point.lat > 90) {
    return 'invalid_lat';
  }
  if (point.lon === null || point.lon < -180 || point.lon > 180) {
    return 'invalid_lon';
  }
  if (point.sequenceIndex === null) {
    return 'missing_sequence_index';
  }
  if (duplicateSequence) {
    return 'duplicate_sequence_index';
  }
  if (point.speed !== null && point.speed > 15) {
    return 'implausible_speed';
  }
  if (point.accuracy !== null && point.accuracy > 100) {
    return 'low_accuracy';
  }
  return null;
}

function qualityScore(accuracy: number | null): number {
  if (accuracy === null) {
    return 0.75;
  }
  return Math.max(0, Math.min(1, 1 - accuracy / 100));
}

function requireIsoDate(value: unknown, fieldName: string): string {
  const parsed = optionalIsoDate(value);
  if (parsed === null) {
    throw new Error(`${fieldName} is required`);
  }
  return parsed;
}

function optionalIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return new Date(value).toISOString();
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function optionalInteger(value: unknown): number | null {
  return Number.isInteger(value) ? value as number : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
