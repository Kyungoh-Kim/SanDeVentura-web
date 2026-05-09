import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { fetchRouteCoverage, fetchRouteDetail, renameRoute } from '../data/routesRepository';
import type {
  GeoJsonLineString,
  OperatorRouteCoverage,
  OperatorRouteDetail,
  RouteState,
} from '../data/readModels';

const OperatorRouteMap = lazy(() =>
  import('../components/OperatorRouteMap').then((module) => ({
    default: module.OperatorRouteMap,
  })),
);

type RoutesPageProps = {
  selectedRouteId: string | null;
  onSelectRoute: (id: string | null) => void;
};

export function RoutesPage({ selectedRouteId, onSelectRoute }: RoutesPageProps) {
  const [rows, setRows] = useState<OperatorRouteCoverage[]>([]);
  const [selectedDetail, setSelectedDetail] = useState<OperatorRouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mountainFilter, setMountainFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [mapExpanded, setMapExpanded] = useState(false);
  const [renamingRouteId, setRenamingRouteId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRouteCoverage()
      .then((nextRows) => {
        if (cancelled) return;
        setRows(nextRows);
        if (selectedRouteId === null) {
          onSelectRoute(nextRows.find((r) => r.routeId !== null)?.routeId ?? null);
        }
      })
      .catch((nextError: Error) => {
        if (!cancelled) setError(nextError.message);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (selectedRouteId === null) { setSelectedDetail(null); return undefined; }
    let cancelled = false;
    fetchRouteDetail(selectedRouteId)
      .then((detail) => { if (!cancelled) setSelectedDetail(detail); })
      .catch((nextError: Error) => { if (!cancelled) setError(nextError.message); });
    return () => { cancelled = true; };
  }, [selectedRouteId]);

  useEffect(() => {
    if (renamingRouteId !== null) {
      const row = rows.find((r) => r.routeId === renamingRouteId);
      setRenameValue(row?.routeDisplayName ?? '');
      setTimeout(() => renameInputRef.current?.focus(), 50);
    }
  }, [renamingRouteId]);

  async function handleRename() {
    if (!renamingRouteId || renameValue.trim() === '') return;
    const targetId = renamingRouteId;
    const newName = renameValue.trim();
    setRenamingRouteId(null);
    setRenameError(null);
    try {
      await renameRoute(targetId, newName);
      setRows((prev) =>
        prev.map((r) => r.routeId === targetId ? { ...r, routeDisplayName: newName } : r),
      );
      setSelectedDetail((prev) =>
        prev && prev.routeId === targetId ? { ...prev, routeDisplayName: newName } : prev,
      );
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : String(err));
    }
  }

  const mountains = useMemo(() => {
    const seen = new Map<string, string>();
    for (const row of rows) seen.set(row.mountainId, row.mountainDisplayName);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filteredRows = useMemo(() => rows.filter((row) => {
    if (row.routeId === null) return false;
    if (mountainFilter !== 'all' && row.mountainId !== mountainFilter) return false;
    if (stateFilter !== 'all' && row.routeState !== stateFilter) return false;
    return true;
  }), [rows, mountainFilter, stateFilter]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.routeId === selectedRouteId) ?? null,
    [rows, selectedRouteId],
  );
  const detail = selectedDetail ?? selectedRow;
  const geometry = detail ? routeGeometry(detail) : null;

  return (
    <>
      <div className="page-header">
        <h2>Routes</h2>
        <span className="page-badge">Operator only</span>
      </div>

      {error && (
        <div className="notice error">
          <strong>Route data unavailable</strong>
          <span>{error}</span>
        </div>
      )}
      {renameError && (
        <div className="notice error">
          <strong>Rename failed</strong>
          <span>{renameError}</span>
        </div>
      )}

      <div className="filter-row">
        <select
          className="filter-select"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
        >
          <option value="all">State: All</option>
          <option value="recommended">Recommended</option>
          <option value="reference">Reference</option>
          <option value="none">None</option>
        </select>
        <select
          className="filter-select"
          value={mountainFilter}
          onChange={(e) => setMountainFilter(e.target.value)}
        >
          <option value="all">Mountain: All</option>
          {mountains.map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
        <div className="filter-spacer" />
      </div>

      <div className="route-layout">
        <div className="table-panel">
          <div className="table-panel-header">
            <span className="table-panel-title">Route coverage</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {filteredRows.length} route{filteredRows.length !== 1 ? 's' : ''}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Route</th>
                <th>Mountain</th>
                <th>State</th>
                <th>Confidence</th>
                <th>Sessions</th>
                <th>Ambiguity</th>
                <th>GPS</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const isSelected = row.routeId === selectedRouteId;
                return (
                  <tr
                    key={row.routeId ?? row.mountainId}
                    className={isSelected ? 'selected-row' : ''}
                    style={{ cursor: row.routeId !== null ? 'pointer' : undefined }}
                    onClick={() => { if (row.routeId !== null) onSelectRoute(row.routeId); }}
                  >
                    <td>
                      {row.routeId !== null ? (
                        <>
                          <span className="cell-name" style={{ fontWeight: isSelected ? 700 : 400 }}>{row.routeDisplayName}</span>
                          <span className="cell-sub">{row.routeId}</span>
                        </>
                      ) : (
                        <span className="cell-sub">—</span>
                      )}
                    </td>
                    <td>
                      <span className="cell-name" style={{ fontWeight: isSelected ? 700 : 400 }}>{row.mountainDisplayName}</span>
                      <span className="cell-sub">{row.mountainId}</span>
                    </td>
                    <td><RouteBadge state={row.routeState} /></td>
                    <td>{formatScore(row.confidence)}</td>
                    <td>{row.sessionCount}</td>
                    <td>{formatScore(row.branchAmbiguityScore)}</td>
                    <td>{formatScore(row.gpsQualityScore)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="route-detail-panel">
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0, flex: 1 }}>
                {detail && detail.routeId !== null
                  ? `${detail.routeDisplayName ?? detail.routeId} — ${detail.mountainDisplayName}`
                  : 'Select a route'}
              </div>
              {detail && detail.routeId !== null && (
                <>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    title="루트 이름 변경"
                    onClick={() => setRenamingRouteId(detail.routeId)}
                    style={{ fontSize: 14, padding: '3px 8px', lineHeight: 1 }}
                  >
                    ✎
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    title="지도 확대"
                    onClick={() => setMapExpanded(true)}
                    style={{ fontSize: 15, padding: '3px 8px', lineHeight: 1 }}
                  >
                    ⤢
                  </button>
                </>
              )}
            </div>
            {detail && detail.routeId !== null ? (
              <>
                <div className="route-detail-metrics">
                  <div className="route-metric">
                    <span>State</span>
                    <strong>{detail.routeState}</strong>
                  </div>
                  <div className="route-metric">
                    <span>Version</span>
                    <strong>{detail.version?.toString() ?? '-'}</strong>
                  </div>
                  <div className="route-metric">
                    <span>Confidence</span>
                    <strong>{formatScore(detail.confidence)}</strong>
                  </div>
                  <div className="route-metric">
                    <span>Sessions</span>
                    <strong>{detail.sessionCount}</strong>
                  </div>
                </div>
                <Suspense fallback={<div className="route-map-empty"><strong>Loading map</strong><span>Preparing route preview.</span></div>}>
                  <OperatorRouteMap geometry={geometry} routeState={detail.routeState} />
                </Suspense>
              </>
            ) : (
              <div className="route-map-empty">
                <strong>No route selected</strong>
                <span>Select a route to inspect geometry and metrics.</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {renamingRouteId !== null && (
        <RenameModal
          routeId={renamingRouteId}
          currentName={rows.find((r) => r.routeId === renamingRouteId)?.routeDisplayName ?? null}
          value={renameValue}
          inputRef={renameInputRef}
          onChange={setRenameValue}
          onConfirm={handleRename}
          onCancel={() => setRenamingRouteId(null)}
        />
      )}

      {mapExpanded && detail && detail.routeId !== null && (
        <div className="modal-backdrop" onClick={() => setMapExpanded(false)}>
          <div
            className="modal map-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <h3 className="modal-title" style={{ margin: 0, flex: 1 }}>
                {detail.routeDisplayName ?? detail.routeId}
                <span style={{ fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>— {detail.mountainDisplayName}</span>
              </h3>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => setMapExpanded(false)}
                style={{ fontSize: 16, padding: '2px 8px', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <Suspense fallback={<div className="route-map-empty"><strong>Loading map</strong><span>Preparing route preview.</span></div>}>
              <OperatorRouteMap geometry={geometry} routeState={detail.routeState} />
            </Suspense>
          </div>
        </div>
      )}
    </>
  );
}

function RenameModal({
  routeId,
  currentName,
  value,
  inputRef,
  onChange,
  onConfirm,
  onCancel,
}: {
  routeId: string;
  currentName: string | null;
  value: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && value.trim() !== '' && value.trim() !== currentName) onConfirm();
    if (e.key === 'Escape') onCancel();
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">루트 이름 변경</h3>
        <p className="modal-body">
          Route ID: <strong>{routeId}</strong>
        </p>
        <label className="modal-label">
          새 이름
          <input
            ref={inputRef}
            className="modal-input"
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={80}
          />
        </label>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>취소</button>
          <button
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={value.trim() === '' || value.trim() === currentName}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

function RouteBadge({ state }: { state: RouteState }) {
  return <span className={`status-badge ${state}`}>{state.replaceAll('_', ' ')}</span>;
}

function formatScore(value: number | null) {
  if (value === null) return '-';
  return value.toFixed(2);
}

function routeGeometry(
  detail: OperatorRouteCoverage | OperatorRouteDetail,
): GeoJsonLineString | null {
  return 'trailGeoJson' in detail ? detail.trailGeoJson : null;
}
