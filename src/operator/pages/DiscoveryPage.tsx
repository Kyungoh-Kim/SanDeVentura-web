import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type CandidateCluster,
  type EvaluateRouteSplitsResult,
  type PromoteCandidateClusterResult,
  fetchCandidateCells,
  fetchCandidateClusters,
  fetchTrailCells,
  promoteCandidateCluster,
  triggerEvaluateRouteSplits,
  triggerMatchAndAggregate,
} from '../data/operationsRepository';
import { type CandidateCell, type OperatorRouteDetail } from '../data/readModels';
import { fetchMountainRouteDetails } from '../data/routesRepository';

const OperatorRouteMap = lazy(() =>
  import('../components/OperatorRouteMap').then((m) => ({ default: m.OperatorRouteMap })),
);

type PromoteState =
  | { status: 'idle' }
  | { status: 'pending'; mountainId: string }
  | { status: 'done'; result: PromoteCandidateClusterResult }
  | { status: 'error'; message: string };

type SplitHint = {
  originalRouteId: string;
  cfgConfidence: number;
  crossBranchRatio: number;
  valid: boolean;
  invalidReason?: string;
};

export function DiscoveryPage() {
  const [clusters, setClusters] = useState<CandidateCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [promote, setPromote] = useState<PromoteState>({ status: 'idle' });
  const [splitHints, setSplitHints] = useState<Map<string, SplitHint>>(new Map());
  const [detecting, setDetecting] = useState(false);
  const [executingSplit, setExecutingSplit] = useState<string | null>(null);
  const [modalMountainId, setModalMountainId] = useState<string | null>(null);
  const [routeName, setRouteName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [selectedMountainId, setSelectedMountainId] = useState<string | null>(null);
  const [selectedCells, setSelectedCells] = useState<CandidateCell[]>([]);
  const [selectedRoutes, setSelectedRoutes] = useState<OperatorRouteDetail[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    fetchCandidateClusters()
      .then((data) => { setClusters(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selectedMountainId === null) {
      setSelectedCells([]);
      setSelectedRoutes([]);
      return;
    }
    let cancelled = false;
    Promise.all([
      fetchCandidateCells(selectedMountainId),
      fetchTrailCells(selectedMountainId),
      fetchMountainRouteDetails(selectedMountainId),
    ]).then(([candidateCells, trailCells, routes]) => {
      if (!cancelled) {
        setSelectedCells([...trailCells, ...candidateCells]);
        setSelectedRoutes(routes);
      }
    }).catch(() => {
      if (!cancelled) {
        setSelectedCells([]);
        setSelectedRoutes([]);
      }
    });
    return () => { cancelled = true; };
  }, [selectedMountainId]);

  useEffect(() => {
    if (modalMountainId !== null) {
      setRouteName('');
      setTimeout(() => nameInputRef.current?.focus(), 50);
    }
  }, [modalMountainId]);

  const mapRoutes = useMemo(
    () => selectedRoutes
      .filter((r) => r.trailGeoJson !== null)
      .map((r) => ({ geometry: r.trailGeoJson!, routeState: r.routeState })),
    [selectedRoutes],
  );

  function applySplitResult(result: EvaluateRouteSplitsResult) {
    const hints = new Map<string, SplitHint>();
    for (const plan of result.plans) {
      hints.set(plan.originalRouteId.split('-')[0] ?? plan.originalRouteId, {
        originalRouteId: plan.originalRouteId,
        cfgConfidence: plan.cfgConfidence,
        crossBranchRatio: plan.crossBranchRatio,
        valid: plan.valid,
        invalidReason: plan.invalidReason,
      });
    }
    setSplitHints(hints);
  }

  async function handleDetectBranches() {
    setDetecting(true);
    try {
      const result = await triggerEvaluateRouteSplits(undefined, true);
      applySplitResult(result);
    } catch {
      // silently ignore — no hint is better than a broken page
    } finally {
      setDetecting(false);
    }
  }

  async function handleExecuteSplit(mountainId: string) {
    setExecutingSplit(mountainId);
    try {
      await triggerEvaluateRouteSplits(mountainId, false);
      setSplitHints((prev) => { const next = new Map(prev); next.delete(mountainId); return next; });
      load();
    } finally {
      setExecutingSplit(null);
    }
  }

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
    if (!modalMountainId || routeName.trim() === '') return;
    const targetMountainId = modalMountainId;
    setModalMountainId(null);
    setPromote({ status: 'pending', mountainId: targetMountainId });
    try {
      const result = await promoteCandidateCluster(targetMountainId, routeName.trim());
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
          onClick={handleDetectBranches}
          disabled={detecting}
          style={{ marginLeft: 'auto' }}
        >
          {detecting ? 'Detecting…' : 'Detect branches'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? 'Scanning…' : 'Scan for candidates'}
        </button>
      </div>

      {promote.status === 'done' && (
        <div className="notice success">
          <strong>Route created: {promote.result.routeId}</strong>
          <span>
            {promote.result.cellCount} cells &middot;{' '}
            {promote.result.transitionCount} transitions &middot;{' '}
            confidence {(promote.result.confidence * 100).toFixed(0)}%
            ({promote.result.confidenceLevel})
            {promote.result.sessionsReset > 0
              ? ` · ${promote.result.sessionsReset} sessions queued for re-attribution`
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
        <div className="table-panel">
          {loading ? (
            <p style={{ color: 'var(--text-3)', fontSize: 13, padding: 16 }}>Loading…</p>
          ) : clusters.length === 0 ? (
            <EmptyState onScan={handleRefresh} scanning={refreshing} />
          ) : (
            <>
              <div className="table-panel-header">
                <span className="table-panel-title">Candidate clusters</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {clusters.length} mountain{clusters.length !== 1 ? 's' : ''} with unmatched GPS data
                </span>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Mountain</th>
                    <th>Cells</th>
                    <th>Session contributions</th>
                    <th>Last evidence</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {clusters.map((c) => (
                    <ClusterRow
                      key={c.mountainId}
                      cluster={c}
                      selected={selectedMountainId === c.mountainId}
                      promoting={promote.status === 'pending' && promote.mountainId === c.mountainId}
                      splitHint={splitHints.get(c.mountainId) ?? null}
                      executingSplit={executingSplit === c.mountainId}
                      onSelect={() => setSelectedMountainId((prev) => prev === c.mountainId ? null : c.mountainId)}
                      onPromote={() => setModalMountainId(c.mountainId)}
                      onExecuteSplit={() => handleExecuteSplit(c.mountainId)}
                    />
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="route-detail-panel">
          <div className="card">
            <div className="card-title">
              {selectedMountainId
                ? `Map preview — ${selectedMountainId}`
                : 'Select a mountain'}
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
                  cells={selectedCells}
                />
              </Suspense>
            ) : (
              <div className="route-map-empty">
                <strong>No mountain selected</strong>
                <span>Click a row to preview its H3 heatmap and routes.</span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">About candidate clusters</div>
            <ul className="bullet-list">
              <li>H3 cells with GPS data not yet matched to a route</li>
              <li>Orange intensity = session count contribution</li>
              <li>Promote to create a new route from the cluster</li>
            </ul>
          </div>
        </div>
      </div>

      {modalMountainId !== null && (
        <PromoteModal
          mountainId={modalMountainId}
          routeName={routeName}
          nameInputRef={nameInputRef}
          onChange={setRouteName}
          onConfirm={handlePromote}
          onCancel={() => setModalMountainId(null)}
        />
      )}
    </>
  );
}

function ClusterRow({
  cluster,
  selected,
  promoting,
  splitHint,
  executingSplit,
  onSelect,
  onPromote,
  onExecuteSplit,
}: {
  cluster: CandidateCluster;
  selected: boolean;
  promoting: boolean;
  splitHint: SplitHint | null;
  executingSplit: boolean;
  onSelect: () => void;
  onPromote: () => void;
  onExecuteSplit: () => void;
}) {
  const relativeTime = cluster.latestEvidenceAt
    ? formatRelative(new Date(cluster.latestEvidenceAt))
    : '—';

  return (
    <tr className={selected ? 'selected-row' : ''}>
      <td>
        <button className="link-button" type="button" onClick={onSelect}>
          <span className="cell-name">{cluster.mountainId}</span>
        </button>
        {splitHint && splitHint.valid && (
          <span style={{ display: 'block', fontSize: 11, color: 'var(--warn)', marginTop: 2 }}>
            분기 후보 감지 — confidence {splitHint.cfgConfidence.toFixed(2)}, ratio {splitHint.crossBranchRatio.toFixed(2)}
          </span>
        )}
      </td>
      <td>
        <span className="cell-mono">{cluster.cellCount}</span>
      </td>
      <td>
        <span className="cell-mono">{cluster.totalSessionContributions}</span>
      </td>
      <td style={{ color: 'var(--text-3)', fontSize: 12 }}>{relativeTime}</td>
      <td style={{ textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {splitHint?.valid && (
          <button
            className="btn btn-ghost"
            onClick={onExecuteSplit}
            disabled={executingSplit}
            style={{ fontSize: 12, padding: '5px 10px' }}
          >
            {executingSplit ? 'Splitting…' : 'Execute split'}
          </button>
        )}
        <button
          className="btn btn-primary"
          onClick={onPromote}
          disabled={promoting}
          style={{ fontSize: 12, padding: '5px 10px' }}
        >
          {promoting ? 'Creating…' : 'Create Route'}
        </button>
      </td>
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
}: {
  mountainId: string;
  routeName: string;
  nameInputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && routeName.trim() !== '') onConfirm();
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">Create route from candidate cluster</h3>
        <p className="modal-body">
          Mountain: <strong>{mountainId}</strong>
          <br />
          The accumulated GPS cells will become a new route's trail cells.
          After creation, run <em>Recalculate hitmaps</em> to re-attribute sessions.
        </p>
        <label className="modal-label">
          Route name
          <input
            ref={nameInputRef}
            className="modal-input"
            type="text"
            placeholder="e.g. 북한산 주능선"
            value={routeName}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={80}
          />
        </label>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={routeName.trim() === ''}
          >
            Create Route
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onScan, scanning }: { onScan: () => void; scanning: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-3)' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>🗺️</div>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>
        No candidate clusters yet
      </p>
      <p style={{ fontSize: 13, marginBottom: 20 }}>
        Upload sessions for mountains without routes, then scan to discover new route candidates.
      </p>
      <button className="btn btn-ghost" onClick={onScan} disabled={scanning}>
        {scanning ? 'Scanning…' : 'Scan now'}
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
