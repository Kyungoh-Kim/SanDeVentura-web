import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import { fetchRouteCoverage, fetchRouteDetail } from '../data/routesRepository';
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

export function RoutesPage() {
  const [rows, setRows] = useState<OperatorRouteCoverage[]>([]);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<OperatorRouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRouteCoverage()
      .then((nextRows) => {
        if (cancelled) return;
        setRows(nextRows);
        setSelectedRouteId(
          (current) => current ?? nextRows.find((r) => r.routeId !== null)?.routeId ?? null,
        );
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

  const selectedRow = useMemo(
    () => rows.find((row) => row.routeId === selectedRouteId) ?? null,
    [rows, selectedRouteId],
  );
  const detail = selectedDetail ?? selectedRow;

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

      <div className="filter-row">
        <select className="filter-select" disabled><option>Route state: All</option></select>
        <select className="filter-select" disabled><option>Mountain: All</option></select>
        <select className="filter-select" disabled><option>Updated: All time</option></select>
        <div className="filter-spacer" />
        <button className="btn btn-ghost" type="button" disabled>↓ Export</button>
      </div>

      <div className="route-layout">
        <div className="table-panel">
          <div className="table-panel-header">
            <span className="table-panel-title">Route coverage</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Mountain</th>
                <th>Route</th>
                <th>State</th>
                <th>Confidence</th>
                <th>Sessions</th>
                <th>Ambiguity</th>
                <th>GPS</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className={row.routeId === selectedRouteId ? 'selected-row' : ''}
                  key={row.routeId ?? row.mountainId}
                >
                  <td>
                    <span className="cell-name">{row.mountainDisplayName}</span>
                    <span className="cell-sub">{row.mountainId}</span>
                  </td>
                  <td>
                    {row.routeId !== null ? (
                      <button
                        className="link-button"
                        onClick={() => setSelectedRouteId(row.routeId)}
                        type="button"
                      >
                        <span className="cell-name">{row.routeDisplayName}</span>
                        <span className="cell-sub">{row.routeId}</span>
                      </button>
                    ) : (
                      <span className="cell-sub">—</span>
                    )}
                  </td>
                  <td><RouteBadge state={row.routeState} /></td>
                  <td>{formatScore(row.confidence)}</td>
                  <td>{row.sessionCount}</td>
                  <td>{formatScore(row.branchAmbiguityScore)}</td>
                  <td>{formatScore(row.gpsQualityScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="route-detail-panel">
          <div className="card">
            <div className="card-title">
              {detail && detail.routeId !== null
                ? `${detail.mountainDisplayName} — ${detail.routeDisplayName ?? detail.routeId}`
                : 'Select a route'}
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
                <Suspense
                  fallback={
                    <div className="route-map-empty">
                      <strong>Loading map</strong>
                      <span>Preparing route preview.</span>
                    </div>
                  }
                >
                  <OperatorRouteMap
                    geometry={routeGeometry(detail)}
                    routeState={detail.routeState}
                  />
                </Suspense>
              </>
            ) : (
              <div className="route-map-empty">
                <strong>No route selected</strong>
                <span>Select a route to inspect geometry and metrics.</span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">Snap thresholds</div>
            <div className="threshold-item">
              <span className="threshold-dot" style={{ background: '#1f8f5f' }} />
              <span>On route — ≤ 25 m</span>
            </div>
            <div className="threshold-item">
              <span className="threshold-dot" style={{ background: '#c47800' }} />
              <span>Caution — 26–50 m</span>
            </div>
            <div className="threshold-item">
              <span className="threshold-dot" style={{ background: '#8a3c2f' }} />
              <span>Away — &gt; 50 m</span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">About this page</div>
            <ul className="bullet-list">
              <li>Multiple routes per mountain</li>
              <li>Confidence inputs below</li>
              <li>Ambiguous branch review</li>
              <li>Snap thresholds per route</li>
            </ul>
          </div>
        </div>
      </div>
    </>
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
