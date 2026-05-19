import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CopyableId, formatShortId } from '../components/CopyableId';
import { getPageCount, getPageItems, operatorPageSize, Pagination } from '../components/Pagination';
import {
  type PromoteCandidateEdgeResult,
  fetchCandidateEdges,
  fetchCandidateEdgeRows,
  promoteCandidateEdge,
  triggerMatchAndAggregate,
} from '../data/operationsRepository';
import {
  type CandidateEdge,
  type OperatorRouteDetail,
  type OperatorTrajectorySegmentMetric,
  type TrailEdge,
} from '../data/readModels';
import {
  fetchMountainRouteDetails,
  fetchTrailEdgesForMountain,
  fetchTrajectorySegmentMetrics,
} from '../data/routesRepository';

const OperatorRouteMap = lazy(() =>
  import('../components/OperatorRouteMap').then((m) => ({ default: m.OperatorRouteMap })),
);

type PromoteState =
  | { status: 'idle' }
  | { status: 'pending'; candidateEdgeId: string }
  | { status: 'done'; result: PromoteCandidateEdgeResult }
  | { status: 'error'; message: string };

type MapViewState = {
  center: [number, number];
  zoom: number;
  rotation: number;
};

export function DiscoveryPage() {
  const [candidates, setCandidates] = useState<CandidateEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [promote, setPromote] = useState<PromoteState>({ status: 'idle' });
  const [modalMountainId, setModalMountainId] = useState<string | null>(null);
  const [modalCandidateEdgeId, setModalCandidateEdgeId] = useState<string | null>(null);
  const [routeName, setRouteName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [selectedCandidateEdgeId, setSelectedCandidateEdgeId] = useState<string | null>(null);
  const [selectedCandidateEdges, setSelectedCandidateEdges] = useState<CandidateEdge[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<OperatorRouteDetail[]>([]);
  const [debugTrailEdges, setDebugTrailEdges] = useState<TrailEdge[]>([]);
  const [debugSegmentMetrics, setDebugSegmentMetrics] = useState<OperatorTrajectorySegmentMetric[]>([]);
  const [discoveryModeLoading, setDiscoveryModeLoading] = useState(false);
  const [discoveryModeError, setDiscoveryModeError] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState('all');
  const [mountainFilter, setMountainFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [preserveMapFit, setPreserveMapFit] = useState(false);
  const [preservedMapViewState, setPreservedMapViewState] = useState<MapViewState | null>(null);

  const load = useCallback(() => {
    setLoading(true);
      fetchCandidateEdgeRows()
      .then((data) => {
        setCandidates(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const selected = candidates.find((candidate) => candidate.id === selectedCandidateEdgeId) ?? null;
    if (selected === null) {
      setSelectedCandidateEdges([]);
      setSelectedRoutes([]);
      setDebugTrailEdges([]);
      setDebugSegmentMetrics([]);
      setDiscoveryModeLoading(false);
      setDiscoveryModeError(null);
      return;
    }

    let cancelled = false;
    Promise.all([
      fetchCandidateEdges(selected.mountainId),
      fetchMountainRouteDetails(selected.mountainId),
    ])
      .then(([candidateEdges, routes]) => {
        if (!cancelled) {
          setSelectedCandidateEdges(candidateEdges);
          setSelectedRoutes(routes);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedCandidateEdges([]);
          setSelectedRoutes([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [candidates, selectedCandidateEdgeId]);

  useEffect(() => {
    const selected = candidates.find((candidate) => candidate.id === selectedCandidateEdgeId) ?? null;
    if (selected === null) {
      setDebugTrailEdges([]);
      setDebugSegmentMetrics([]);
      setDiscoveryModeLoading(false);
      setDiscoveryModeError(null);
      return;
    }

    let cancelled = false;
    setDiscoveryModeLoading(true);
    setDiscoveryModeError(null);
    Promise.all([
      fetchTrailEdgesForMountain(selected.mountainId),
      fetchTrajectorySegmentMetrics('candidate', selected.id),
    ])
      .then(([edges, metrics]) => {
        if (!cancelled) {
          setDebugTrailEdges(edges);
          setDebugSegmentMetrics(metrics);
          setDiscoveryModeLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDebugTrailEdges([]);
          setDebugSegmentMetrics([]);
          setDiscoveryModeLoading(false);
          setDiscoveryModeError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [candidates, selectedCandidateEdgeId]);

  useEffect(() => {
    if (modalMountainId !== null) {
      setRouteName('');
      window.setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [modalMountainId]);

  const selectedCandidate = candidates.find((candidate) => candidate.id === selectedCandidateEdgeId) ?? null;
  const selectedCandidateDetail =
    selectedCandidateEdges.find((edge) => edge.id === selectedCandidateEdgeId) ?? selectedCandidate;

  const mapRoutes = useMemo(
    () => [
      ...selectedRoutes
        .filter((route) => route.trailGeoJson !== null)
        .map((route) => ({
          geometry: route.trailGeoJson!,
          id: route.routeId ?? undefined,
          label: route.routeDisplayName ?? route.routeId ?? undefined,
          routeState: route.routeState,
        })),
      ...selectedCandidateEdges
        .filter((edge) => edge.trailGeoJson !== null)
        .map((edge) => ({
          geometry: edge.trailGeoJson!,
          id: edge.id,
          label: `${edge.residualKind.replaceAll('_', ' ')} - ${formatShortId(edge.id)}`,
          promotionReady: edge.promotionReady,
          selectable: true,
          selected: edge.id === selectedCandidateEdgeId,
          routeState: edge.confidenceLevel === 'recommended' ? 'recommended' as const : 'none' as const,
        })),
      ...debugTrailEdges
        .filter((edge) => edge.trailGeoJson !== null)
        .map((edge) => ({
          geometry: edge.trailGeoJson!,
          id: edge.id,
          label: `trail edge - ${formatShortId(edge.id)}`,
          routeState: edge.status === 'recommended' ? 'recommended' as const : edge.status === 'reference' ? 'reference' as const : 'none' as const,
          debugOnly: true,
          debugKind: edge.id === selectedCandidateDetail?.attachStartEdgeId
            ? 'attach-start' as const
            : edge.id === selectedCandidateDetail?.attachEndEdgeId
              ? 'attach-end' as const
              : 'trail-edge' as const,
        })),
    ],
    [debugTrailEdges, selectedCandidateDetail, selectedRoutes, selectedCandidateEdges, selectedCandidateEdgeId],
  );

  const stateOptions = useMemo(() => {
    const levels = new Set(candidates.map((candidate) => candidate.confidenceLevel));
    return [...levels].sort();
  }, [candidates]);

  const mountainOptions = useMemo(() => {
    const mountains = new Map<string, string>();
    for (const candidate of candidates) {
      mountains.set(candidate.mountainId, candidate.mountainDisplayName);
    }
    return [...mountains.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [candidates]);

  const filteredCandidates = useMemo(() => candidates.filter((candidate) => {
    if (mountainFilter !== 'all' && candidate.mountainId !== mountainFilter) return false;
    if (stateFilter === 'promotion_ready') return candidate.promotionReady;
    if (stateFilter === 'not_promotion_ready') return !candidate.promotionReady;
    if (stateFilter !== 'all' && candidate.confidenceLevel !== stateFilter) return false;
    return true;
  }), [candidates, mountainFilter, stateFilter]);

  const selectedMountainId = selectedCandidate?.mountainId ?? null;
  const selectedMountainName = selectedCandidate?.mountainDisplayName ?? selectedMountainId;
  const pageCount = getPageCount(filteredCandidates.length);
  const pageCandidates = getPageItems(filteredCandidates, Math.min(page, pageCount));

  useEffect(() => {
    setPage(1);
  }, [stateFilter, mountainFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    if (selectedCandidateEdgeId && !filteredCandidates.some((candidate) => candidate.id === selectedCandidateEdgeId)) {
      setSelectedCandidateEdgeId(null);
    }
  }, [filteredCandidates, selectedCandidateEdgeId]);

  const selectCandidateFromList = useCallback((candidateId: string) => {
    setPreserveMapFit(false);
    setPreservedMapViewState(null);
    setSelectedCandidateEdgeId(candidateId);
  }, []);

  const selectCandidateFromMap = useCallback((candidateId: string, viewState: MapViewState | null) => {
    setPreserveMapFit(true);
    setPreservedMapViewState(viewState);
    setSelectedCandidateEdgeId(candidateId);
    const index = filteredCandidates.findIndex((candidate) => candidate.id === candidateId);
    if (index >= 0) {
      setPage(Math.floor(index / operatorPageSize) + 1);
    }
  }, [filteredCandidates]);

  async function handleRefresh() {
    setRefreshing(true);
    setPromote({ status: 'idle' });
    try {
      await triggerMatchAndAggregate();
      load();
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePromote() {
    if (!modalMountainId || !modalCandidateEdgeId || routeName.trim() === '') return;
    const targetCandidateEdgeId = modalCandidateEdgeId;
    setModalMountainId(null);
    setModalCandidateEdgeId(null);
    setPromote({ status: 'pending', candidateEdgeId: targetCandidateEdgeId });
    try {
      const result = await promoteCandidateEdge(targetCandidateEdgeId, routeName.trim());
      setPromote({ status: 'done', result });
      load();
    } catch (err) {
      setPromote({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <>
      <div className="page-header">
        <h2>Route Discovery</h2>
        <span className="page-badge">Operator only</span>
        <button
          className="btn btn-ghost"
          disabled={refreshing}
          onClick={handleRefresh}
          style={{ marginLeft: 'auto' }}
          type="button"
        >
          {refreshing ? 'Scanning...' : 'Scan for candidates'}
        </button>
      </div>

      {promote.status === 'done' && (
        <div className="notice success">
          <strong>Candidate edge promoted: {promote.result.promotedEdgeId}</strong>
          <span>
            {promote.result.splitEdgeIds.length} edge split(s),{' '}
            {promote.result.createdNodeIds.length} node(s) created
            {promote.result.confidence !== null
              ? `, confidence ${(promote.result.confidence * 100).toFixed(0)}%`
              : ''}
          </span>
        </div>
      )}

      {promote.status === 'error' && (
        <div className="notice error">
          <strong>Promotion failed</strong>
          <span>{promote.message}</span>
        </div>
      )}

      <div className="route-layout">
        <div>
          <div className="filter-row">
            <select
              className="filter-select"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
            >
              <option value="all">State: All</option>
              {stateOptions.map((state) => (
                <option key={state} value={state}>{state}</option>
              ))}
              <option value="promotion_ready">Promotion ready</option>
              <option value="not_promotion_ready">Not promotion-ready</option>
            </select>
            <select
              className="filter-select"
              value={mountainFilter}
              onChange={(e) => setMountainFilter(e.target.value)}
            >
              <option value="all">Mountain: All</option>
              {mountainOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </select>
            <div className="filter-spacer" />
          </div>
          <div className="table-panel">
            {loading ? (
              <p style={{ color: 'var(--text-3)', fontSize: 13, padding: 16 }}>Loading...</p>
            ) : candidates.length === 0 ? (
              <EmptyState onScan={handleRefresh} scanning={refreshing} />
            ) : (
              <>
                <div className="table-panel-header">
                  <span className="table-panel-title">Candidate edges</span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                    {filteredCandidates.length} candidate edge{filteredCandidates.length !== 1 ? 's' : ''}
                  </span>
                </div>
              <table>
                <thead>
                  <tr>
                    <th>Candidate</th>
                    <th>Mountain</th>
                    <th>State</th>
                    <th>Points</th>
                    <th>Sessions</th>
                    <th>Length</th>
                    <th>Last evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {pageCandidates.map((candidate) => (
                    <CandidateRow
                      candidate={candidate}
                      key={candidate.id}
                      onSelect={() => selectCandidateFromList(candidate.id)}
                      selected={selectedCandidateEdgeId === candidate.id}
                    />
                  ))}
                </tbody>
              </table>
                <Pagination
                  page={Math.min(page, pageCount)}
                  totalItems={filteredCandidates.length}
                  onPageChange={setPage}
                />
              </>
            )}
          </div>
        </div>

        <div className="route-detail-panel">
          <div className="card">
            <div className="card-title map-card-title">
              <span>{selectedMountainId ? `Map preview - ${selectedMountainName}` : 'Select a candidate'}</span>
              <span className="status-pill ready">Discovery mode</span>
            </div>
            {selectedMountainId ? (
              <Suspense
                fallback={
                  <div className="route-map-empty">
                    <strong>Loading map</strong>
                    <span>Preparing map preview.</span>
                  </div>
                }
              >
                <OperatorRouteMap
                  geometry={null}
                  routeState="none"
                  routes={mapRoutes}
                  title={`Discovery map - ${selectedMountainName}`}
                  discoveryMode
                  initialViewState={preserveMapFit ? preservedMapViewState : null}
                  onOverlayClick={selectCandidateFromMap}
                  preserveExpandedViewLocally
                  preserveViewOnRoutesChange={preserveMapFit}
                />
              </Suspense>
            ) : (
              <div className="route-map-empty">
                <strong>No candidate selected</strong>
                <span>Click a candidate to preview it with other routes on the same mountain.</span>
              </div>
            )}
          </div>

          <PromotionDecisionCard
            candidate={selectedCandidateDetail}
            promoteDisabled={promote.status === 'pending'}
            onPromote={(candidate) => {
              setModalMountainId(candidate.mountainId);
              setModalCandidateEdgeId(candidate.id);
            }}
          />

          <DiscoveryGraphPanel
            candidate={selectedCandidateDetail}
            error={discoveryModeError}
            loading={discoveryModeLoading}
            metrics={debugSegmentMetrics}
            trailEdges={debugTrailEdges}
          />
        </div>
      </div>

      {modalMountainId !== null && (
        <PromoteModal
          mountainId={modalMountainId}
          nameInputRef={nameInputRef}
          onCancel={() => {
            setModalMountainId(null);
            setModalCandidateEdgeId(null);
          }}
          onChange={setRouteName}
          onConfirm={handlePromote}
          routeName={routeName}
          candidateEdgeId={modalCandidateEdgeId}
        />
      )}
    </>
  );
}

function DiscoveryGraphPanel({
  candidate,
  loading,
  error,
  trailEdges,
  metrics,
}: {
  candidate: CandidateEdge | null;
  loading: boolean;
  error: string | null;
  trailEdges: TrailEdge[];
  metrics: OperatorTrajectorySegmentMetric[];
}) {
  if (candidate === null) {
    return (
      <div className="card">
        <div className="card-title">Discovery mode</div>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          Select a candidate edge to inspect discovery edge IDs and segment metrics.
        </p>
      </div>
    );
  }

  const attachStart = trailEdges.find((edge) => edge.id === candidate.attachStartEdgeId) ?? null;
  const attachEnd = trailEdges.find((edge) => edge.id === candidate.attachEndEdgeId) ?? null;

  return (
    <div className="card">
      <div className="card-title">Discovery mode</div>
      <div className="debug-graph-panel">
        <div className="debug-graph-row">
          <span>Trail edges loaded</span>
          <b>{loading ? 'Loading...' : trailEdges.length.toLocaleString()}</b>
        </div>
        {error !== null && (
          <div className="debug-graph-row">
            <span>Load error</span>
            <b>{error}</b>
          </div>
        )}
        <div className="debug-graph-row">
          <span>Start attach edge</span>
          <b>
            <DebugAttachValue
              edge={attachStart}
              edgeId={candidate.attachStartEdgeId}
              loading={loading}
            />
          </b>
        </div>
        <div className="debug-graph-row">
          <span>End attach edge</span>
          <b>
            <DebugAttachValue
              edge={attachEnd}
              edgeId={candidate.attachEndEdgeId}
              loading={loading}
            />
          </b>
        </div>
        <div className="debug-graph-note">
          Attach edges are highlighted on the map when available. Hover any route, candidate, or debug trail edge to see start/end markers.
        </div>
      </div>
      <div className="debug-metric-list">
        <strong>Candidate segment metrics</strong>
        {metrics.length === 0 ? (
          <span>No segment metrics available.</span>
        ) : (
          metrics.slice(0, 4).map((metric) => (
            <div className="debug-metric-item" key={`${metric.direction}-${metric.segmentIndex}`}>
              <span>
                #{metric.segmentIndex} {formatMeters(metric.startMeasureMeters)}-{formatMeters(metric.endMeasureMeters)}
              </span>
              <span>
                {metric.sampleCount.toLocaleString()} samples / {formatSpeed(metric.speedMetersPerSecondAvg)} / +{formatMeters(metric.elevationGainMeters)}
              </span>
            </div>
          ))
        )}
        {metrics.length > 4 && <span>+{metrics.length - 4} more segments</span>}
      </div>
    </div>
  );
}

function DebugAttachValue({
  edge,
  edgeId,
  loading,
}: {
  edge: TrailEdge | null;
  edgeId: string | null;
  loading: boolean;
}) {
  if (edgeId === null) return <>none</>;

  return (
    <>
      <CopyableId value={edgeId} />
      {edge === null && loading && <span className="debug-inline-note">loading</span>}
      {edge === null && !loading && <span className="debug-inline-note">not in active graph</span>}
      {edge !== null && <span className="debug-inline-note">{edge.status}</span>}
    </>
  );
}

function PromotionDecisionCard({
  candidate,
  promoteDisabled,
  onPromote,
}: {
  candidate: CandidateEdge | null;
  promoteDisabled: boolean;
  onPromote: (candidate: CandidateEdge) => void;
}) {
  if (candidate === null) {
    return (
      <div className="card">
        <div className="card-title">Promotion decision</div>
        <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
          Select a candidate edge to inspect the confidence and validation inputs used for promotion.
        </p>
      </div>
    );
  }

  const lengthMeters = candidate.lengthMeters ?? 0;
  const hasStartAttach = candidate.attachStartEdgeId !== null || candidate.residualKind === 'standalone';
  const hasEndAttach = candidate.attachEndEdgeId !== null || candidate.residualKind === 'standalone';
  const attachReady = candidate.promotionReady || (hasStartAttach && hasEndAttach && candidate.validationFailureReason === null);
  const decisionText = candidate.promotionReady
    ? 'Promotion is ready because the candidate reached recommended confidence and passed attach/split validation.'
    : `Promotion is blocked${candidate.validationFailureReason ? `: ${candidate.validationFailureReason}` : ' until the candidate satisfies every required input.'}`;

  return (
    <div className="card">
      <div className="card-title promotion-decision-title">
        <span>Promotion decision</span>
        {candidate.promotionReady && (
          <button
            className="btn btn-primary"
            disabled={promoteDisabled}
            onClick={() => onPromote(candidate)}
            style={{ fontSize: 12, padding: '5px 10px' }}
            type="button"
          >
            {promoteDisabled ? 'Promoting...' : 'Promote'}
          </button>
        )}
      </div>
      <div className="decision-summary">
        <span className={candidate.promotionReady ? 'status-pill ready' : 'status-pill muted'}>
          {candidate.promotionReady ? 'Promotion ready' : 'Not promotion-ready'}
        </span>
        <span>{decisionText}</span>
      </div>
      <DecisionScoreRow
        label="Confidence"
        note={`${formatConfidence(candidate.confidence)} / recommended required`}
        passed={candidate.confidenceLevel === 'recommended'}
        value={candidate.confidence ?? 0}
      />
      <DecisionScoreRow
        label="Session support"
        note={`${candidate.sessionCount.toLocaleString()} / 3 sessions`}
        passed={candidate.sessionCount >= 3}
        value={Math.min(1, candidate.sessionCount / 3)}
      />
      <DecisionScoreRow
        label="Length"
        note={`${formatMeters(lengthMeters)} / 80m`}
        passed={lengthMeters >= 80}
        value={Math.min(1, lengthMeters / 80)}
      />
      <DecisionScoreRow
        label="Attach / split validation"
        note={candidate.validationFailureReason ?? 'passed'}
        passed={candidate.promotionReady || attachReady}
        value={candidate.promotionReady || attachReady ? 1 : 0}
      />
      <div className="decision-anchor-list">
        <span>Residual: {candidate.residualKind.replaceAll('_', ' ')}</span>
        <span>{formatAttachSummary('Start attach', candidate.attachStartEdgeId, candidate.attachStartMeasureMeters)}</span>
        <span>{formatAttachSummary('End attach', candidate.attachEndEdgeId, candidate.attachEndMeasureMeters)}</span>
      </div>
    </div>
  );
}

function DecisionScoreRow({
  label,
  value,
  passed,
  note,
}: {
  label: string;
  value: number;
  passed: boolean;
  note: string;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value * 100)));
  const fillClass = passed ? '' : pct >= 40 ? 'mid' : 'low';

  return (
    <div className="score-row">
      <span className="score-label">
        {label}
        <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 4 }}>({note})</span>
      </span>
      <div className="score-track">
        <div className={`score-fill ${fillClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="score-val">{passed ? 'OK' : 'No'}</span>
    </div>
  );
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: CandidateEdge;
  selected: boolean;
  onSelect: () => void;
}) {
  const relativeTime = candidate.latestEvidenceAt
    ? formatRelative(new Date(candidate.latestEvidenceAt))
    : '-';
  const promotionStatus = candidate.promotionReady ? 'Promotion ready' : 'Not promotion-ready';
  const stateClass = candidate.promotionReady || candidate.confidenceLevel === 'recommended' ? 'ready' : 'muted';

  return (
    <tr className={selected ? 'selected-row' : ''} onClick={onSelect} style={{ cursor: 'pointer' }}>
      <td>
        <div className="link-button">
          <span className="cell-name">{candidate.residualKind.replaceAll('_', ' ')}</span>
          <span className="cell-sub"><CopyableId value={candidate.id} /></span>
        </div>
      </td>
      <td>
        <span className="cell-name">{candidate.mountainDisplayName}</span>
        <span className="cell-sub">{candidate.mountainId}</span>
      </td>
      <td>
        <span className={`status-pill ${stateClass}`}>{candidate.confidenceLevel}</span>
        <span className={candidate.promotionReady ? 'status-pill ready' : 'status-pill muted'}>
          {promotionStatus}
        </span>
      </td>
      <td>
        <span className="cell-mono">{candidate.pointCount.toLocaleString()}</span>
      </td>
      <td>
        <span className="cell-mono">{candidate.sessionCount.toLocaleString()}</span>
      </td>
      <td>
        <span className="cell-mono">{candidate.lengthMeters === null ? '-' : `${Math.round(candidate.lengthMeters)}m`}</span>
      </td>
      <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{relativeTime}</td>
    </tr>
  );
}

function PromoteModal({
  mountainId,
  routeName,
  nameInputRef,
  onChange,
  onConfirm,
  onCancel,
  candidateEdgeId,
}: {
  mountainId: string;
  candidateEdgeId: string | null;
  routeName: string;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && routeName.trim() !== '') onConfirm();
    if (event.key === 'Escape') onCancel();
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3 className="modal-title">Promote candidate edge</h3>
        <p className="modal-body">
          Mountain: <strong>{mountainId}</strong>
          <br />
          Candidate edge: <strong>{candidateEdgeId ?? 'select a candidate edge first'}</strong>
          <br />
          Promotion creates a graph edge and splits attached edges when a junction is needed.
        </p>
        <label className="modal-label">
          Route name
          <input
            className="modal-input"
            maxLength={80}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="e.g. Main ridge route"
            ref={nameInputRef}
            type="text"
            value={routeName}
          />
        </label>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={routeName.trim() === '' || candidateEdgeId === null}
            onClick={onConfirm}
            type="button"
          >
            Promote Edge
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-3)' }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
        No candidate edges yet
      </p>
      <p style={{ fontSize: 13, marginBottom: 20 }}>
        Upload sessions for mountains without routes, then scan to discover new route candidates.
      </p>
      <button className="btn btn-ghost" disabled={scanning} onClick={onScan} type="button">
        {scanning ? 'Scanning...' : 'Scan now'}
      </button>
    </div>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function formatConfidence(value: number | null): string {
  return value === null ? '-' : value.toFixed(2);
}

function formatMeters(value: number): string {
  return `${Math.round(value).toLocaleString()}m`;
}

function formatSpeed(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(2)}m/s`;
}

function formatAttachSummary(label: string, edgeId: string | null, measureMeters: number | null): string {
  if (edgeId === null) return `${label}: none`;
  return `${label}: existing trail edge${measureMeters !== null ? ` @ ${formatMeters(measureMeters)}` : ''}`;
}
