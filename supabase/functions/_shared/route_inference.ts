export type RoutePoint = {
  sessionId: string;
  recordedAt: string;
  lat: number;
  lon: number;
  accuracy: number | null;
  altitude: number | null;
  sequenceIndex: number;
};

export type TrajectoryPoint = {
  lat: number;
  lon: number;
  recordedAt?: string;
  accuracy?: number | null;
  altitude?: number | null;
};

export type RefinedTrajectory = {
  points: TrajectoryPoint[];
  pointCount: number;
  avgAccuracy: number | null;
  avgAltitude: number | null;
  latestEvidenceAt: string | null;
  lengthMeters: number;
};

export type TrajectoryMatchMetrics = {
  frechetDistance: number;
  overlapRatio: number;
  score: number;
};

export type TrajectorySupportMatch = {
  frechetDistance: number;
  incomingOverlapRatio: number;
  targetOverlapRatio: number;
  supportKind: 'full' | 'partial' | 'none';
  score: number;
};

export type TrajectorySegmentMetric = {
  direction: 'forward' | 'reverse';
  segmentIndex: number;
  startMeasureMeters: number;
  endMeasureMeters: number;
  sampleCount: number;
  durationSeconds: number | null;
  durationObservationCount: number;
  speedMetersPerSecond: number | null;
  elevationGainMeters: number;
  elevationLossMeters: number;
  abruptAltitudeChangeCount: number;
  maxAbsAltitudeDeltaMeters: number | null;
  latestEvidenceAt: string | null;
};

export type TrailGraphEdgeInput = {
  id: string;
  path: TrajectoryPoint[];
  status?: string;
};

export type TrailGraphMatchedInterval = {
  kind: 'matched_edge';
  edgeId: string;
  sessionStartIndex: number;
  sessionEndIndex: number;
  sessionStartMeasureMeters: number;
  sessionEndMeasureMeters: number;
  edgeStartMeasureMeters: number;
  edgeEndMeasureMeters: number;
  direction: 'forward' | 'reverse';
  lengthMeters: number;
  pointCount: number;
};

export type TrailGraphResidualKind = 'branch_out' | 'branch_in' | 'connector' | 'standalone';

export type TrailGraphResidualInterval = {
  kind: 'candidate_edge';
  sessionStartIndex: number;
  sessionEndIndex: number;
  sessionStartMeasureMeters: number;
  sessionEndMeasureMeters: number;
  attachStartEdgeId: string | null;
  attachStartMeasureMeters: number | null;
  attachEndEdgeId: string | null;
  attachEndMeasureMeters: number | null;
  residualKind: TrailGraphResidualKind;
  lengthMeters: number;
  pointCount: number;
};

export type TrailGraphTransition = {
  fromEdgeId: string | null;
  toEdgeId: string | null;
  nodeMeasureMeters: number | null;
  direction: 'forward' | 'reverse' | 'unknown';
};

export type TrailGraphInterval =
  | TrailGraphMatchedInterval
  | TrailGraphResidualInterval;

export type TrailGraphMatchResult = {
  intervals: TrailGraphInterval[];
  transitions: TrailGraphTransition[];
};

export type TrailGraphMatchConfig = {
  maxDistanceMeters: number;
  minMatchedLengthMeters: number;
  minResidualLengthMeters: number;
  minIntervalPoints: number;
  backtrackToleranceMeters: number;
  minAttachMatchedLengthMeters: number;
  minDivergenceAngleDegrees: number;
  minSeparationRatio: number;
  directionSampleMeters: number;
};

export const defaultTrailGraphMatchConfig: TrailGraphMatchConfig = {
  maxDistanceMeters: 35,
  minMatchedLengthMeters: 40,
  minResidualLengthMeters: 40,
  minIntervalPoints: 3,
  backtrackToleranceMeters: 35,
  minAttachMatchedLengthMeters: 40,
  minDivergenceAngleDegrees: 25,
  minSeparationRatio: 0.6,
  directionSampleMeters: 60,
};

export function refineSessionTrajectory(points: RoutePoint[]): RefinedTrajectory {
  const ordered = [...points]
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon))
    .sort((left, right) => left.sequenceIndex - right.sequenceIndex);

  if (ordered.length === 0) return emptyTrajectory();

  const deduped: RoutePoint[] = [];
  for (const point of ordered) {
    const previous = deduped[deduped.length - 1];
    if (!previous || haversineMeters(previous.lat, previous.lon, point.lat, point.lon) >= 5) {
      deduped.push(point);
    } else if (point.sequenceIndex === ordered[ordered.length - 1].sequenceIndex) {
      deduped.push(point);
    }
  }

  const simplified = simplifyPolyline(deduped, 8);
  const resampled = resampleLine(simplified, 20);
  const sourceForStats = deduped.length > 0 ? deduped : ordered;

  return {
    points: resampled.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      recordedAt: point.recordedAt,
      accuracy: point.accuracy,
      altitude: point.altitude,
    })),
    pointCount: ordered.length,
    avgAccuracy: averageNullable(sourceForStats.map((point) => point.accuracy)),
    avgAltitude: averageNullable(sourceForStats.map((point) => point.altitude)),
    latestEvidenceAt: sourceForStats
      .map((point) => point.recordedAt)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null,
    lengthMeters: trajectoryLengthMeters(resampled),
  };
}

export function lineStringWkt(line: Array<{ lat: number; lon: number }>): string | null {
  if (line.length < 2) return null;
  return `LINESTRING(${line.map((point) => `${point.lon} ${point.lat}`).join(',')})`;
}

export function trajectoryLineWkt(trajectory: RefinedTrajectory | TrajectoryPoint[]): string | null {
  const points = Array.isArray(trajectory) ? trajectory : trajectory.points;
  return lineStringWkt(points);
}

export function weightedDiscreteFrechetTrajectory(
  sessionPath: TrajectoryPoint[],
  routePath: TrajectoryPoint[],
): TrajectoryMatchMetrics {
  if (sessionPath.length === 0 || routePath.length === 0) {
    return { frechetDistance: Number.POSITIVE_INFINITY, overlapRatio: 0, score: Number.POSITIVE_INFINITY };
  }

  const cache: number[][] = Array.from(
    { length: sessionPath.length },
    () => Array(routePath.length).fill(Number.NaN),
  );

  const distanceAt = (i: number, j: number): number =>
    haversineMeters(sessionPath[i].lat, sessionPath[i].lon, routePath[j].lat, routePath[j].lon);

  const walk = (i: number, j: number): number => {
    if (Number.isFinite(cache[i][j])) return cache[i][j];
    const current = distanceAt(i, j);
    if (i === 0 && j === 0) {
      cache[i][j] = current;
    } else if (i > 0 && j === 0) {
      cache[i][j] = Math.max(walk(i - 1, 0), current);
    } else if (i === 0 && j > 0) {
      cache[i][j] = Math.max(walk(0, j - 1), current);
    } else {
      cache[i][j] = Math.max(
        Math.min(walk(i - 1, j), walk(i - 1, j - 1), walk(i, j - 1)),
        current,
      );
    }
    return cache[i][j];
  };

  const frechetDistance = walk(sessionPath.length - 1, routePath.length - 1);
  const overlapRatio = trajectoryOverlapRatio(sessionPath, routePath, 45);
  return {
    frechetDistance,
    overlapRatio,
    score: frechetDistance - overlapRatio * 20,
  };
}

export function trajectorySupportMatch(
  incomingPath: TrajectoryPoint[],
  targetPath: TrajectoryPoint[],
  thresholdMeters = 45,
): TrajectorySupportMatch {
  if (incomingPath.length === 0 || targetPath.length === 0) {
    return {
      frechetDistance: Number.POSITIVE_INFINITY,
      incomingOverlapRatio: 0,
      targetOverlapRatio: 0,
      supportKind: 'none',
      score: Number.POSITIVE_INFINITY,
    };
  }

  const forward = weightedDiscreteFrechetTrajectory(incomingPath, targetPath);
  const reverse = weightedDiscreteFrechetTrajectory(incomingPath, [...targetPath].reverse());
  const frechetDistance = Math.min(forward.frechetDistance, reverse.frechetDistance);
  const incomingOverlapRatio = trajectoryOverlapRatio(incomingPath, targetPath, thresholdMeters);
  const targetOverlapRatio = trajectoryOverlapRatio(targetPath, incomingPath, thresholdMeters);
  const fullSupport = frechetDistance <= thresholdMeters &&
    incomingOverlapRatio >= 0.45 &&
    targetOverlapRatio >= 0.45;
  const partialSupport = !fullSupport && (
    incomingOverlapRatio >= 0.80 && targetOverlapRatio >= 0.25 ||
    targetOverlapRatio >= 0.80 && incomingOverlapRatio >= 0.25
  );
  const supportKind = fullSupport ? 'full' : partialSupport ? 'partial' : 'none';

  return {
    frechetDistance,
    incomingOverlapRatio,
    targetOverlapRatio,
    supportKind,
    score: frechetDistance - (incomingOverlapRatio + targetOverlapRatio) * 20 +
      (supportKind === 'full' ? 0 : supportKind === 'partial' ? 100 : 1000),
  };
}

export function mergeTrajectoryLines(
  existing: TrajectoryPoint[],
  incoming: TrajectoryPoint[],
  existingWeight: number,
  incomingWeight = 1,
): TrajectoryPoint[] {
  if (existing.length < 2) return incoming;
  if (incoming.length < 2) return existing;

  const sampleCount = Math.max(2, Math.min(120, Math.max(existing.length, incoming.length)));
  const existingSamples = resampleLine(existing, null, sampleCount);
  const incomingSamples = resampleLine(incoming, null, sampleCount);
  const mergedSampleCount = Math.min(existingSamples.length, incomingSamples.length);
  const totalWeight = Math.max(1, existingWeight + incomingWeight);

  const merged = Array.from({ length: mergedSampleCount }, (_, index) => {
    const point = existingSamples[index];
    const incomingPoint = incomingSamples[index];
    return {
      lat: (point.lat * existingWeight + incomingPoint.lat * incomingWeight) / totalWeight,
      lon: (point.lon * existingWeight + incomingPoint.lon * incomingWeight) / totalWeight,
    };
  });

  return chaikinOnce(merged);
}

export function trajectoryLengthMeters(points: Array<{ lat: number; lon: number }>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return total;
}

export function trajectoryOverlapRatio(
  sessionPath: TrajectoryPoint[],
  routePath: TrajectoryPoint[],
  thresholdMeters: number,
): number {
  if (sessionPath.length === 0 || routePath.length < 2) return 0;
  const matched = sessionPath.filter((point) =>
    distanceToPolylineMeters(point, routePath) <= thresholdMeters
  ).length;
  return matched / sessionPath.length;
}

export function buildTrajectorySegmentMetrics(
  trajectory: RefinedTrajectory | TrajectoryPoint[],
  bucketMeters = 100,
  referencePath?: TrajectoryPoint[],
): TrajectorySegmentMetric[] {
  const points = Array.isArray(trajectory) ? trajectory : trajectory.points;
  if (points.length < 2 || bucketMeters <= 0) return [];
  const reference = referencePath && referencePath.length >= 2 ? referencePath : points;

  const buckets = new Map<string, {
    direction: 'forward' | 'reverse';
    segmentIndex: number;
    startMeasureMeters: number;
    endMeasureMeters: number;
    sampleCount: number;
    distanceMeters: number;
    durationSeconds: number;
    elevationGainMeters: number;
    elevationLossMeters: number;
    abruptAltitudeChangeCount: number;
    maxAbsAltitudeDeltaMeters: number | null;
    latestEvidenceAt: string | null;
  }>();

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const segmentDistance = haversineMeters(previous.lat, previous.lon, current.lat, current.lon);
    if (segmentDistance <= 0) continue;

    const previousMeasure = projectMeasureOnLine(previous, reference);
    const currentMeasure = projectMeasureOnLine(current, reference);
    const measureDelta = currentMeasure - previousMeasure;
    if (!Number.isFinite(measureDelta) || Math.abs(measureDelta) < 1) continue;

    const direction: 'forward' | 'reverse' = measureDelta >= 0 ? 'forward' : 'reverse';
    const measureStart = Math.min(previousMeasure, currentMeasure);
    const measureDistance = Math.abs(measureDelta);
    const startTime = parseOptionalTime(previous.recordedAt);
    const endTime = parseOptionalTime(current.recordedAt);
    const segmentDuration = startTime !== null && endTime !== null && endTime >= startTime
      ? (endTime - startTime) / 1000
      : null;
    const altitudeDelta = previous.altitude !== null && previous.altitude !== undefined &&
        current.altitude !== null && current.altitude !== undefined
      ? current.altitude - previous.altitude
      : null;
    const absAltitudeDelta = altitudeDelta === null ? null : Math.abs(altitudeDelta);
    const abruptAltitudeChange = absAltitudeDelta !== null &&
      absAltitudeDelta >= 25 &&
      absAltitudeDelta / Math.max(1, segmentDistance) >= 0.75;

    let consumedMeasure = 0;
    while (consumedMeasure < measureDistance) {
      const absoluteStart = measureStart + consumedMeasure;
      const bucketIndex = Math.floor(absoluteStart / bucketMeters);
      const bucketEnd = (bucketIndex + 1) * bucketMeters;
      const sliceMeasure = Math.min(measureDistance - consumedMeasure, bucketEnd - absoluteStart);
      const sliceRatio = sliceMeasure / measureDistance;
      const sliceDistance = segmentDistance * sliceRatio;
      const bucketKey = `${direction}:${bucketIndex}`;
      const bucket = buckets.get(bucketKey) ?? {
        direction,
        segmentIndex: bucketIndex,
        startMeasureMeters: bucketIndex * bucketMeters,
        endMeasureMeters: (bucketIndex + 1) * bucketMeters,
        sampleCount: 0,
        distanceMeters: 0,
        durationSeconds: 0,
        elevationGainMeters: 0,
        elevationLossMeters: 0,
        abruptAltitudeChangeCount: 0,
        maxAbsAltitudeDeltaMeters: null,
        latestEvidenceAt: null,
      };

      bucket.sampleCount += 1;
      bucket.distanceMeters += sliceDistance;
      if (segmentDuration !== null) {
        bucket.durationSeconds += segmentDuration * sliceRatio;
      }

      if (altitudeDelta !== null) {
        if (abruptAltitudeChange) {
          bucket.abruptAltitudeChangeCount += 1;
        } else if (altitudeDelta > 0) {
          bucket.elevationGainMeters += altitudeDelta * sliceRatio;
        } else {
          bucket.elevationLossMeters += Math.abs(altitudeDelta) * sliceRatio;
        }
      }

      if (absAltitudeDelta !== null) {
        bucket.maxAbsAltitudeDeltaMeters = Math.max(bucket.maxAbsAltitudeDeltaMeters ?? 0, absAltitudeDelta);
      }
      bucket.latestEvidenceAt = latestIsoString(bucket.latestEvidenceAt, current.recordedAt ?? null);

      buckets.set(bucketKey, bucket);
      consumedMeasure += sliceMeasure;
    }
  }

  return [...buckets.values()]
    .sort((left, right) =>
      left.segmentIndex - right.segmentIndex || left.direction.localeCompare(right.direction)
    )
    .map((bucket) => ({
      direction: bucket.direction,
      segmentIndex: bucket.segmentIndex,
      startMeasureMeters: bucket.startMeasureMeters,
      endMeasureMeters: bucket.endMeasureMeters,
      sampleCount: bucket.sampleCount,
      durationSeconds: bucket.durationSeconds === 0 ? null : bucket.durationSeconds,
      durationObservationCount: bucket.durationSeconds === 0 ? 0 : 1,
      speedMetersPerSecond: bucket.durationSeconds === 0
        ? null
        : bucket.distanceMeters / bucket.durationSeconds,
      elevationGainMeters: bucket.elevationGainMeters,
      elevationLossMeters: bucket.elevationLossMeters,
      abruptAltitudeChangeCount: bucket.abruptAltitudeChangeCount,
      maxAbsAltitudeDeltaMeters: bucket.maxAbsAltitudeDeltaMeters,
      latestEvidenceAt: bucket.latestEvidenceAt,
    }));
}

export function matchTrajectoryToTrailGraph(
  sessionPath: TrajectoryPoint[],
  edges: TrailGraphEdgeInput[],
  config: TrailGraphMatchConfig = defaultTrailGraphMatchConfig,
): TrailGraphMatchResult {
  const attachableEdges = edges.filter(isAttachableGraphEdge);
  if (sessionPath.length < 2 || attachableEdges.length === 0) {
    return {
      intervals: residualOnlyInterval(sessionPath, config),
      transitions: [],
    };
  }

  type TaggedPoint = {
    edgeId: string | null;
    edgeMeasureMeters: number | null;
    sessionMeasureMeters: number;
    distanceMeters: number | null;
  };

  const sessionMeasures = cumulativeMeasures(sessionPath);
  const tags: TaggedPoint[] = sessionPath.map((point, index) => {
    let best: TaggedPoint = {
      edgeId: null,
      edgeMeasureMeters: null,
      sessionMeasureMeters: sessionMeasures[index] ?? 0,
      distanceMeters: null,
    };

    for (const edge of attachableEdges) {
      if (edge.path.length < 2) continue;
      const distanceMeters = distanceToPolylineMeters(point, edge.path);
      if (distanceMeters > config.maxDistanceMeters) continue;
      if (best.distanceMeters !== null && distanceMeters >= best.distanceMeters) continue;
      best = {
        edgeId: edge.id,
        edgeMeasureMeters: projectMeasureOnLine(point, edge.path),
        sessionMeasureMeters: sessionMeasures[index] ?? 0,
        distanceMeters,
      };
    }

    return best;
  });

  const raw: Array<{
    kind: 'matched' | 'residual';
    edgeId: string | null;
    start: number;
    end: number;
  }> = [];

  let start = 0;
  for (let index = 1; index < tags.length; index += 1) {
    const prev = tags[index - 1];
    const current = tags[index];
    const currentKind = current.edgeId === null ? 'residual' : 'matched';
    const prevKind = prev.edgeId === null ? 'residual' : 'matched';
    let shouldSplit = currentKind !== prevKind || current.edgeId !== prev.edgeId;

    if (!shouldSplit && current.edgeId !== null && prev.edgeId !== null) {
      const measureDelta = (current.edgeMeasureMeters ?? 0) - (prev.edgeMeasureMeters ?? 0);
      const first = tags[start];
      const baseDelta = (prev.edgeMeasureMeters ?? 0) - (first.edgeMeasureMeters ?? 0);
      const direction = Math.abs(baseDelta) < 1 ? Math.sign(measureDelta) : Math.sign(baseDelta);
      if (
        direction > 0 && measureDelta < -config.backtrackToleranceMeters ||
        direction < 0 && measureDelta > config.backtrackToleranceMeters
      ) {
        shouldSplit = true;
      }
    }

    if (shouldSplit) {
      raw.push({
        kind: tags[start].edgeId === null ? 'residual' : 'matched',
        edgeId: tags[start].edgeId,
        start,
        end: index - 1,
      });
      start = index;
    }
  }

  raw.push({
    kind: tags[start].edgeId === null ? 'residual' : 'matched',
    edgeId: tags[start].edgeId,
    start,
    end: tags.length - 1,
  });

  const normalized = raw.map((interval) => {
    if (interval.kind === 'residual' || interval.edgeId === null) return interval;
    const startTag = tags[interval.start];
    const endTag = tags[interval.end];
    const matchedLength = Math.abs((endTag.edgeMeasureMeters ?? 0) - (startTag.edgeMeasureMeters ?? 0));
    const pointCount = interval.end - interval.start + 1;
    if (matchedLength < config.minMatchedLengthMeters || pointCount < config.minIntervalPoints) {
      return { ...interval, kind: 'residual' as const, edgeId: null };
    }
    return interval;
  });

  const merged: typeof normalized = [];
  for (const interval of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && previous.kind === interval.kind && previous.edgeId === interval.edgeId) {
      previous.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }

  const intervals: TrailGraphInterval[] = [];
  for (let index = 0; index < merged.length; index += 1) {
    const interval = merged[index];
    if (interval.kind === 'matched' && interval.edgeId !== null) {
      const startTag = tags[interval.start];
      const endTag = tags[interval.end];
      const edgeStartMeasureMeters = startTag.edgeMeasureMeters ?? 0;
      const edgeEndMeasureMeters = endTag.edgeMeasureMeters ?? edgeStartMeasureMeters;
      intervals.push({
        kind: 'matched_edge',
        edgeId: interval.edgeId,
        sessionStartIndex: interval.start,
        sessionEndIndex: interval.end,
        sessionStartMeasureMeters: startTag.sessionMeasureMeters,
        sessionEndMeasureMeters: endTag.sessionMeasureMeters,
        edgeStartMeasureMeters,
        edgeEndMeasureMeters,
        direction: edgeEndMeasureMeters >= edgeStartMeasureMeters ? 'forward' : 'reverse',
        lengthMeters: Math.abs(edgeEndMeasureMeters - edgeStartMeasureMeters),
        pointCount: interval.end - interval.start + 1,
      });
    } else {
      const startTag = tags[interval.start];
      const endTag = tags[interval.end];
      const previous = findAdjacentMatchedInterval(merged, tags, index, -1);
      const next = findAdjacentMatchedInterval(merged, tags, index, 1);
      const validatedAttach = validatedResidualAttach(
        sessionPath,
        interval.start,
        interval.end,
        attachableEdges,
        previous,
        next,
        config,
      );
      const lengthMeters = endTag.sessionMeasureMeters - startTag.sessionMeasureMeters;
      if (lengthMeters < config.minResidualLengthMeters && interval.end - interval.start + 1 < config.minIntervalPoints) {
        continue;
      }
      intervals.push({
        kind: 'candidate_edge',
        sessionStartIndex: interval.start,
        sessionEndIndex: interval.end,
        sessionStartMeasureMeters: startTag.sessionMeasureMeters,
        sessionEndMeasureMeters: endTag.sessionMeasureMeters,
        attachStartEdgeId: validatedAttach.start?.edgeId ?? null,
        attachStartMeasureMeters: validatedAttach.start?.measureMeters ?? null,
        attachEndEdgeId: validatedAttach.end?.edgeId ?? null,
        attachEndMeasureMeters: validatedAttach.end?.measureMeters ?? null,
        residualKind: residualKind(validatedAttach.start?.edgeId ?? null, validatedAttach.end?.edgeId ?? null),
        lengthMeters,
        pointCount: interval.end - interval.start + 1,
      });
    }
  }

  return {
    intervals,
    transitions: buildGraphTransitions(intervals),
  };
}

export function sliceTrajectoryPath(
  points: TrajectoryPoint[],
  startIndex: number,
  endIndex: number,
): TrajectoryPoint[] {
  return points.slice(Math.max(0, startIndex), Math.min(points.length, endIndex + 1));
}

export function cumulativeMeasures(points: Array<{ lat: number; lon: number }>): number[] {
  const measures: number[] = [0];
  for (let index = 1; index < points.length; index += 1) {
    measures.push(measures[index - 1] + haversineMeters(
      points[index - 1].lat,
      points[index - 1].lon,
      points[index].lat,
      points[index].lon,
    ));
  }
  return measures;
}

function residualOnlyInterval(
  sessionPath: TrajectoryPoint[],
  config: TrailGraphMatchConfig,
): TrailGraphInterval[] {
  if (sessionPath.length < config.minIntervalPoints) return [];
  const lengthMeters = trajectoryLengthMeters(sessionPath);
  if (lengthMeters < config.minResidualLengthMeters) return [];
  return [{
    kind: 'candidate_edge',
    sessionStartIndex: 0,
    sessionEndIndex: sessionPath.length - 1,
    sessionStartMeasureMeters: 0,
    sessionEndMeasureMeters: lengthMeters,
    attachStartEdgeId: null,
    attachStartMeasureMeters: null,
    attachEndEdgeId: null,
    attachEndMeasureMeters: null,
    residualKind: 'standalone',
    lengthMeters,
    pointCount: sessionPath.length,
  }];
}

type AdjacentMatchedInterval = {
  edgeId: string;
  measureMeters: number;
  start: number;
  end: number;
  lengthMeters: number;
  direction: 'forward' | 'reverse';
};

function findAdjacentMatchedInterval(
  intervals: Array<{ kind: 'matched' | 'residual'; edgeId: string | null; start: number; end: number }>,
  tags: Array<{ edgeId: string | null; edgeMeasureMeters: number | null }>,
  index: number,
  direction: -1 | 1,
): AdjacentMatchedInterval | null {
  for (let cursor = index + direction; cursor >= 0 && cursor < intervals.length; cursor += direction) {
    const interval = intervals[cursor];
    if (interval.kind !== 'matched' || interval.edgeId === null) continue;
    const tagIndex = direction < 0 ? interval.end : interval.start;
    const measure = tags[tagIndex].edgeMeasureMeters;
    const startMeasure = tags[interval.start].edgeMeasureMeters;
    const endMeasure = tags[interval.end].edgeMeasureMeters;
    if (measure === null || startMeasure === null || endMeasure === null) return null;
    return {
      edgeId: interval.edgeId,
      measureMeters: measure,
      start: interval.start,
      end: interval.end,
      lengthMeters: Math.abs(endMeasure - startMeasure),
      direction: endMeasure >= startMeasure ? 'forward' : 'reverse',
    };
  }
  return null;
}

function validatedResidualAttach(
  sessionPath: TrajectoryPoint[],
  residualStart: number,
  residualEnd: number,
  edges: TrailGraphEdgeInput[],
  previous: AdjacentMatchedInterval | null,
  next: AdjacentMatchedInterval | null,
  config: TrailGraphMatchConfig,
): {
  start: AdjacentMatchedInterval | null;
  end: AdjacentMatchedInterval | null;
} {
  const start = previous !== null &&
      isDirectionalAttach(
        sessionPath,
        residualStart,
        residualEnd,
        edges,
        previous,
        'start',
        config,
      )
    ? previous
    : null;
  const end = next !== null &&
      isDirectionalAttach(
        sessionPath,
        residualStart,
        residualEnd,
        edges,
        next,
        'end',
        config,
      )
    ? next
    : null;

  return { start, end };
}

function isDirectionalAttach(
  sessionPath: TrajectoryPoint[],
  residualStart: number,
  residualEnd: number,
  edges: TrailGraphEdgeInput[],
  adjacent: AdjacentMatchedInterval,
  side: 'start' | 'end',
  config: TrailGraphMatchConfig,
): boolean {
  if (adjacent.lengthMeters < config.minAttachMatchedLengthMeters) return false;

  const edge = edges.find((item) => item.id === adjacent.edgeId);
  if (!edge || edge.path.length < 2) return false;

  const residualPath = sessionPath.slice(residualStart, residualEnd + 1);
  if (
    residualPath.length < config.minIntervalPoints &&
    trajectoryLengthMeters(residualPath) < config.minResidualLengthMeters
  ) {
    return false;
  }
  const separationRatio = residualPath.filter((point) =>
    distanceToPolylineMeters(point, edge.path) > config.maxDistanceMeters
  ).length / residualPath.length;
  if (separationRatio < config.minSeparationRatio) return false;

  const edgeVector = edgeTangentVector(edge.path, adjacent.measureMeters, adjacent.direction);
  const residualVector = side === 'start'
    ? residualExitVector(sessionPath, adjacent.end, residualEnd, config.directionSampleMeters)
    : residualEntryVector(sessionPath, residualStart, adjacent.start, config.directionSampleMeters);
  if (!edgeVector || !residualVector) return false;

  return vectorAngleDegrees(edgeVector, residualVector) >= config.minDivergenceAngleDegrees;
}

function isAttachableGraphEdge(edge: TrailGraphEdgeInput): boolean {
  return edge.status === undefined || edge.status === 'reference' || edge.status === 'recommended';
}

function edgeTangentVector(
  path: TrajectoryPoint[],
  measureMeters: number,
  direction: 'forward' | 'reverse',
): { x: number; y: number } | null {
  const lengthMeters = trajectoryLengthMeters(path);
  if (lengthMeters <= 0) return null;
  const before = pointAtMeasure(path, Math.max(0, measureMeters - 20));
  const after = pointAtMeasure(path, Math.min(lengthMeters, measureMeters + 20));
  return direction === 'forward'
    ? vectorMeters(before, after)
    : vectorMeters(after, before);
}

function residualExitVector(
  sessionPath: TrajectoryPoint[],
  attachIndex: number,
  residualEnd: number,
  sampleMeters: number,
): { x: number; y: number } | null {
  if (attachIndex >= residualEnd) return null;
  const path = sessionPath.slice(attachIndex, residualEnd + 1);
  const target = pointAtMeasure(path, Math.min(sampleMeters, trajectoryLengthMeters(path)));
  return vectorMeters(path[0], target);
}

function residualEntryVector(
  sessionPath: TrajectoryPoint[],
  residualStart: number,
  attachIndex: number,
  sampleMeters: number,
): { x: number; y: number } | null {
  if (residualStart >= attachIndex) return null;
  const path = sessionPath.slice(residualStart, attachIndex + 1);
  const lengthMeters = trajectoryLengthMeters(path);
  const source = pointAtMeasure(path, Math.max(0, lengthMeters - sampleMeters));
  return vectorMeters(source, path[path.length - 1]);
}

function pointAtMeasure<T extends { lat: number; lon: number }>(path: T[], measureMeters: number): T {
  if (path.length === 0) throw new Error('pointAtMeasure requires at least one point');
  if (path.length === 1 || measureMeters <= 0) return path[0];

  let consumed = 0;
  for (let index = 1; index < path.length; index += 1) {
    const previous = path[index - 1];
    const current = path[index];
    const segmentLength = haversineMeters(previous.lat, previous.lon, current.lat, current.lon);
    if (segmentLength <= 0) continue;
    if (consumed + segmentLength >= measureMeters) {
      const ratio = Math.max(0, Math.min(1, (measureMeters - consumed) / segmentLength));
      return {
        ...previous,
        lat: previous.lat + (current.lat - previous.lat) * ratio,
        lon: previous.lon + (current.lon - previous.lon) * ratio,
      };
    }
    consumed += segmentLength;
  }

  return path[path.length - 1];
}

function vectorMeters(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): { x: number; y: number } | null {
  const lat = ((from.lat + to.lat) / 2) * Math.PI / 180;
  const x = (to.lon - from.lon) * 111_320 * Math.cos(lat);
  const y = (to.lat - from.lat) * 111_320;
  if (Math.hypot(x, y) < 1) return null;
  return { x, y };
}

function vectorAngleDegrees(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  const leftLength = Math.hypot(left.x, left.y);
  const rightLength = Math.hypot(right.x, right.y);
  if (leftLength === 0 || rightLength === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (left.x * right.x + left.y * right.y) / (leftLength * rightLength)));
  return Math.acos(cosine) * 180 / Math.PI;
}

function residualKind(
  attachStartEdgeId: string | null,
  attachEndEdgeId: string | null,
): TrailGraphResidualKind {
  if (attachStartEdgeId !== null && attachEndEdgeId !== null) return 'connector';
  if (attachStartEdgeId !== null) return 'branch_out';
  if (attachEndEdgeId !== null) return 'branch_in';
  return 'standalone';
}

function buildGraphTransitions(intervals: TrailGraphInterval[]): TrailGraphTransition[] {
  const transitions: TrailGraphTransition[] = [];
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    const fromEdgeId = previous.kind === 'matched_edge' ? previous.edgeId : null;
    const toEdgeId = current.kind === 'matched_edge' ? current.edgeId : null;
    if (fromEdgeId === null && toEdgeId === null) continue;
    transitions.push({
      fromEdgeId,
      toEdgeId,
      nodeMeasureMeters: current.kind === 'matched_edge'
        ? current.edgeStartMeasureMeters
        : current.attachStartMeasureMeters,
      direction: current.kind === 'matched_edge' ? current.direction : 'unknown',
    });
  }
  return transitions;
}

function simplifyPolyline<T extends { lat: number; lon: number }>(points: T[], toleranceMeters: number): T[] {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = pointToSegmentDistanceMeters(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  if (maxDistance <= toleranceMeters) return [start, end];

  const left = simplifyPolyline(points.slice(0, maxIndex + 1), toleranceMeters);
  const right = simplifyPolyline(points.slice(maxIndex), toleranceMeters);
  return [...left.slice(0, -1), ...right];
}

function resampleLine<T extends { lat: number; lon: number }>(
  points: T[],
  spacingMeters: number | null,
  targetCount?: number,
): T[] {
  if (points.length <= 1) return points;
  if (points.length === 2 && targetCount === undefined) return points;

  const totalLength = trajectoryLengthMeters(points);
  const count = targetCount ?? Math.max(2, Math.floor(totalLength / Math.max(1, spacingMeters ?? 20)) + 1);
  if (totalLength === 0) return Array.from({ length: count }, () => points[0]);

  const distances = Array.from({ length: count }, (_, index) =>
    (totalLength * index) / Math.max(1, count - 1)
  );

  const result: T[] = [];
  let segmentStartDistance = 0;
  let segmentIndex = 1;

  for (let targetIndex = 0; targetIndex < distances.length; targetIndex += 1) {
    const targetDistance = distances[targetIndex];
    while (segmentIndex < points.length) {
      const segmentLength = haversineMeters(
        points[segmentIndex - 1].lat,
        points[segmentIndex - 1].lon,
        points[segmentIndex].lat,
        points[segmentIndex].lon,
      );
      if (segmentStartDistance + segmentLength >= targetDistance) {
        const ratio = segmentLength === 0 ? 0 : (targetDistance - segmentStartDistance) / segmentLength;
        const previous = points[segmentIndex - 1];
        const current = points[segmentIndex];
        result.push({
          ...previous,
          lat: previous.lat + (current.lat - previous.lat) * ratio,
          lon: previous.lon + (current.lon - previous.lon) * ratio,
          recordedAt: interpolateIsoTime(
            (previous as { recordedAt?: string }).recordedAt,
            (current as { recordedAt?: string }).recordedAt,
            ratio,
          ) ?? (previous as { recordedAt?: string }).recordedAt,
          accuracy: interpolateOptionalNumber(
            (previous as { accuracy?: number | null }).accuracy,
            (current as { accuracy?: number | null }).accuracy,
            ratio,
          ),
          altitude: interpolateOptionalNumber(
            (previous as { altitude?: number | null }).altitude,
            (current as { altitude?: number | null }).altitude,
            ratio,
          ),
        });
        break;
      }
      segmentStartDistance += segmentLength;
      segmentIndex += 1;
    }

    if (result.length < targetIndex + 1) result.push(points[points.length - 1]);
  }

  if (result.length === 0) {
    result.push(points[points.length - 1]);
  } else {
    result[result.length - 1] = points[points.length - 1];
  }

  return result;
}

function distanceToPolylineMeters(
  point: { lat: number; lon: number },
  line: Array<{ lat: number; lon: number }>,
): number {
  if (line.length === 0) return Number.POSITIVE_INFINITY;
  if (line.length === 1) return haversineMeters(point.lat, point.lon, line[0].lat, line[0].lon);

  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < line.length; i += 1) {
    best = Math.min(best, pointToSegmentDistanceMeters(point, line[i - 1], line[i]));
  }
  return best;
}

function pointToSegmentDistanceMeters(
  point: { lat: number; lon: number },
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
): number {
  return projectPointToSegment(point, start, end).distanceMeters;
}

function projectMeasureOnLine(
  point: { lat: number; lon: number },
  line: Array<{ lat: number; lon: number }>,
): number {
  if (line.length < 2) return 0;

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestMeasure = 0;
  let cumulativeMeasure = 0;
  for (let index = 1; index < line.length; index += 1) {
    const start = line[index - 1];
    const end = line[index];
    const segmentLength = haversineMeters(start.lat, start.lon, end.lat, end.lon);
    const projection = projectPointToSegment(point, start, end);
    if (projection.distanceMeters < bestDistance) {
      bestDistance = projection.distanceMeters;
      bestMeasure = cumulativeMeasure + segmentLength * projection.ratio;
    }
    cumulativeMeasure += segmentLength;
  }
  return bestMeasure;
}

function projectPointToSegment(
  point: { lat: number; lon: number },
  start: { lat: number; lon: number },
  end: { lat: number; lon: number },
): { ratio: number; distanceMeters: number } {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLon = 111_320 * Math.cos((point.lat * Math.PI) / 180);
  const px = point.lon * metersPerDegreeLon;
  const py = point.lat * metersPerDegreeLat;
  const ax = start.lon * metersPerDegreeLon;
  const ay = start.lat * metersPerDegreeLat;
  const bx = end.lon * metersPerDegreeLon;
  const by = end.lat * metersPerDegreeLat;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return {
      ratio: 0,
      distanceMeters: haversineMeters(point.lat, point.lon, start.lat, start.lon),
    };
  }
  const ratio = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const cx = ax + dx * ratio;
  const cy = ay + dy * ratio;
  return { ratio, distanceMeters: Math.hypot(px - cx, py - cy) };
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

function chaikinOnce(points: Array<{ lat: number; lon: number }>): Array<{ lat: number; lon: number }> {
  if (points.length < 3) return points;
  const smoothed: Array<{ lat: number; lon: number }> = [points[0]];
  for (let i = 0; i < points.length - 1; i += 1) {
    const current = points[i];
    const next = points[i + 1];
    smoothed.push({
      lat: current.lat * 0.75 + next.lat * 0.25,
      lon: current.lon * 0.75 + next.lon * 0.25,
    });
    smoothed.push({
      lat: current.lat * 0.25 + next.lat * 0.75,
      lon: current.lon * 0.25 + next.lon * 0.75,
    });
  }
  smoothed.push(points[points.length - 1]);
  return smoothed;
}

function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number =>
    typeof value === 'number' && Number.isFinite(value)
  );
  return finite.length === 0 ? null : average(finite);
}

function interpolateOptionalNumber(
  left: number | null | undefined,
  right: number | null | undefined,
  ratio: number,
): number | null {
  if (typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right)) {
    return left + (right - left) * ratio;
  }
  if (typeof left === 'number' && Number.isFinite(left)) return left;
  if (typeof right === 'number' && Number.isFinite(right)) return right;
  return null;
}

function interpolateIsoTime(
  left: string | undefined,
  right: string | undefined,
  ratio: number,
): string | null {
  const leftMs = parseOptionalTime(left);
  const rightMs = parseOptionalTime(right);
  if (leftMs === null || rightMs === null) return null;
  return new Date(leftMs + (rightMs - leftMs) * ratio).toISOString();
}

function parseOptionalTime(value: string | null | undefined): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestIsoString(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function emptyTrajectory(): RefinedTrajectory {
  return {
    points: [],
    pointCount: 0,
    avgAccuracy: null,
    avgAltitude: null,
    latestEvidenceAt: null,
    lengthMeters: 0,
  };
}
