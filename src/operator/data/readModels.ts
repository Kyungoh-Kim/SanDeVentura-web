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
export type RouteMatchMethod = 'exact_overlap' | 'frechet_match' | 'candidate_residual';

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
  matchedRouteCellCount: number;
  matchedRoutePointCount: number | null;
  candidateCellCount: number;
  candidatePointCount: number | null;
  attributionPrecision: AttributionPrecision;
};

export type OperatorSessionRouteAttribution = {
  sessionId: string;
  routeId: string;
  routeDisplayName: string;
  cellCount: number;
  pointCount: number | null;
  transitionCount: number;
  matchMethod: RouteMatchMethod;
  frechetDistance: number | null;
  overlapRatio: number | null;
  scoreMargin: number | null;
  attributionPrecision: AttributionPrecision;
};

export type OperatorSessionCellAttribution = {
  sessionId: string;
  targetKind: 'route' | 'candidate';
  routeId: string | null;
  routeDisplayName: string | null;
  cellKey: string;
  pointCount: number;
  avgAccuracy: number | null;
  avgAltitude: number | null;
  lastSeenAt: string | null;
};

export type CandidateCell = {
  cellKey: string;
  lat: number;
  lon: number;
  pointCount: number;
  sessionCount: number;
};
