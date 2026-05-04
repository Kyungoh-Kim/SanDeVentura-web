export type RouteState = 'none' | 'reference' | 'recommended';
export type UploadState = 'local' | 'queued' | 'uploaded' | 'retry' | 'failed';

export type OperatorOverviewMetrics = {
  uploadSuccessRate: number | null;
  queuedUploads: number;
  routeCoverage: number;
  snapRequests: number;
};

export type OperatorRouteCoverage = {
  mountainId: string;
  displayName: string;
  routeState: RouteState;
  confidence: number | null;
  version: number | null;
  sessionCount: number;
  branchAmbiguityScore: number | null;
  gpsQualityScore: number | null;
};

export type OperatorSessionIngestion = {
  sessionId: string;
  mountainId: string;
  uploadState: UploadState;
  consentVersion: string | null;
  acceptedPointCount: number;
  rejectedPointCount: number;
  lastError: string | null;
};

