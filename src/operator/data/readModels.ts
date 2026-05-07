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

export const operatorOverviewMetrics: OperatorOverviewMetrics = {
  uploadSuccessRate: 0.95,
  queuedUploads: 2,
  routeCoverage: 0.67,
  snapRequests: 18,
};

export const routeCoverageRows: OperatorRouteCoverage[] = [
  {
    mountainId: 'beta-mountain',
    displayName: 'Beta Mountain',
    routeState: 'recommended',
    confidence: 0.81,
    version: 3,
    sessionCount: 4,
    branchAmbiguityScore: 0.08,
    gpsQualityScore: 0.91,
  },
  {
    mountainId: 'branch-test-mountain',
    displayName: 'Branch Test Mountain',
    routeState: 'reference',
    confidence: 0.58,
    version: 1,
    sessionCount: 2,
    branchAmbiguityScore: 0.42,
    gpsQualityScore: 0.84,
  },
  {
    mountainId: 'empty-beta-mountain',
    displayName: 'Empty Beta Mountain',
    routeState: 'none',
    confidence: null,
    version: null,
    sessionCount: 0,
    branchAmbiguityScore: null,
    gpsQualityScore: null,
  },
];

export const sessionIngestionRows: OperatorSessionIngestion[] = [
  {
    sessionId: 'local-session-001',
    mountainId: 'beta-mountain',
    uploadState: 'uploaded',
    consentVersion: 'beta-upload-consent-v1',
    acceptedPointCount: 48,
    rejectedPointCount: 2,
    lastError: null,
  },
  {
    sessionId: 'local-session-002',
    mountainId: 'branch-test-mountain',
    uploadState: 'retry',
    consentVersion: 'beta-upload-consent-v1',
    acceptedPointCount: 0,
    rejectedPointCount: 0,
    lastError: 'network timeout',
  },
];
