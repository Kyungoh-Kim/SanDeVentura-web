export type RouteState = 'none' | 'reference' | 'recommended';
export type UploadState = 'local' | 'queued' | 'uploaded' | 'retry' | 'failed';

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
  routeId: string | null;
  uploadState: UploadState;
  consentVersion: string | null;
  acceptedPointCount: number;
  rejectedPointCount: number;
  lastError: string | null;
};
