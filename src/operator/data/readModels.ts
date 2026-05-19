export type RouteState = 'none' | 'reference' | 'recommended';
export type UploadState =
  | 'local'
  | 'queued'
  | 'uploaded'
  | 'retry'
  | 'failed'
  | 'ingesting'
  | 'ingested'
  | 'complete'
  | 'rejected'
  | 'accepted';
export type AttributionPrecision = 'exact' | 'approximate' | 'none';
export type RouteMatchMethod =
  | 'exact_overlap'
  | 'frechet_match'
  | 'candidate_residual'
  | 'trajectory_match'
  | 'trail_graph_interval';
export type ResidualKind = 'branch_out' | 'branch_in' | 'connector' | 'standalone';
export type EdgeStatus = 'candidate' | 'reference' | 'recommended' | 'retired';

export type Mountain = {
  id: string;
  displayName: string;
  bbox: string | null;
};

export type OperatorOverviewMetrics = {
  uploadSuccessRate: number | null;
  queuedUploads: number;
  routeCoverage: number | null;
  snapRequests: number;
  trailServed: number;
};

export type OperatorRouteCoverage = {
  routeId: string | null;           // null = mountain has no routes defined yet
  mountainId: string;
  mountainDisplayName: string;
  routeDisplayName: string | null;  // null = mountain has no routes defined yet
  routeState: RouteState;
  confidence: number | null;
  version: number | null;
  sessionCount: number;
  branchAmbiguityScore: number | null;
  gpsQualityScore: number | null;
  updatedAt: string | null;
};

export type GeoJsonLineString = {
  type: 'LineString';
  coordinates: Array<[number, number]>;
};

export type OperatorRouteDetail = OperatorRouteCoverage & {
  updatedAt: string | null;
  trailGeoJson: GeoJsonLineString | null;
};

export type OperatorRouteQualityDetail = OperatorRouteCoverage & {
  acceptedPointCount: number;
  rejectedPointCount: number;
  latestEvidenceAt: string | null;
  updatedAt: string | null;
};

export type OperatorSessionIngestion = {
  sessionId: string;
  mountainId: string;
  mountainDisplayName: string;
  routeId: string | null;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  pipelineState: string;
  uploadState: UploadState;
  consentVersion: string | null;
  acceptedPointCount: number;
  rejectedPointCount: number;
  lastError: string | null;
  matchedRouteCount: number;
  matchedRouteSupportCount: number;
  matchedRoutePointCount: number | null;
  candidateSupportCount: number;
  candidatePointCount: number | null;
  attributionPrecision: AttributionPrecision;
  processedAlgorithmVersion: string | null;
  rawRetentionState: 'available' | 'purged';
  recomputable: boolean;
};

export type OperatorSessionRouteAttribution = {
  sessionId: string;
  routeId: string;
  routeDisplayName: string;
  supportCount: number;
  pointCount: number | null;
  transitionCount: number;
  matchMethod: RouteMatchMethod;
  frechetDistance: number | null;
  overlapRatio: number | null;
  scoreMargin: number | null;
  attributionPrecision: AttributionPrecision;
};

export type OperatorSessionEdgeAttribution = {
  sessionId: string;
  mountainId: string;
  intervalIndex: number;
  targetKind: 'edge' | 'candidate';
  edgeId: string | null;
  routeId: string | null;
  routeDisplayName: string | null;
  candidateEdgeId: string | null;
  residualKind: ResidualKind | null;
  direction: 'forward' | 'reverse' | 'unknown';
  sessionStartMeasureMeters: number | null;
  sessionEndMeasureMeters: number | null;
  edgeStartMeasureMeters: number | null;
  edgeEndMeasureMeters: number | null;
  attachStartEdgeId: string | null;
  attachStartMeasureMeters: number | null;
  attachEndEdgeId: string | null;
  attachEndMeasureMeters: number | null;
  pointCount: number;
  avgAccuracy: number | null;
  avgAltitude: number | null;
  matchedLengthMeters: number | null;
  algorithmVersion: string;
  matchedAt: string;
  rawRetentionState: 'available' | 'purged';
  recomputable: boolean;
};

export type OperatorTrajectorySegmentMetric = {
  mountainId: string;
  targetKind: 'edge' | 'candidate';
  targetId: string;
  routeId: string | null;
  edgeId?: string | null;
  candidateEdgeId: string | null;
  direction: 'forward' | 'reverse';
  segmentIndex: number;
  startMeasureMeters: number;
  endMeasureMeters: number;
  sessionCount: number;
  sampleCount: number;
  durationSecondsAvg: number | null;
  durationSecondsSum: number;
  durationObservationCount: number;
  speedMetersPerSecondAvg: number | null;
  elevationGainMeters: number;
  elevationLossMeters: number;
  abruptAltitudeChangeCount: number;
  maxAbsAltitudeDeltaMeters: number | null;
  latestEvidenceAt: string | null;
  algorithmVersion: string;
  updatedAt: string;
};

export type TrailEdge = {
  id: string;
  mountainId: string;
  routeId: string | null;
  trailGeoJson: GeoJsonLineString | null;
  lengthMeters: number | null;
  sessionCount: number;
  pointCount: number;
  confidence: number | null;
  status: EdgeStatus;
  algorithmVersion: string;
};

export type CandidateEdge = {
  id: string;
  mountainId: string;
  mountainDisplayName: string;
  trailGeoJson: GeoJsonLineString | null;
  attachStartEdgeId: string | null;
  attachStartMeasureMeters: number | null;
  attachEndEdgeId: string | null;
  attachEndMeasureMeters: number | null;
  residualKind: ResidualKind;
  pointCount: number;
  sessionCount: number;
  lengthMeters: number | null;
  confidence: number | null;
  confidenceLevel: 'reference' | 'recommended';
  promotionReady: boolean;
  validationFailureReason: string | null;
  latestEvidenceAt: string | null;
  algorithmVersion: string;
};
