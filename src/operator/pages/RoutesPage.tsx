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
  const [selectedMountainId, setSelectedMountainId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<OperatorRouteDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRouteCoverage()
      .then((nextRows) => {
        if (cancelled) {
          return;
        }
        setRows(nextRows);
        setSelectedMountainId((current) => current ?? nextRows[0]?.mountainId ?? null);
      })
      .catch((nextError: Error) => {
        if (!cancelled) {
          setError(nextError.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedMountainId === null) {
      setSelectedDetail(null);
      return undefined;
    }

    let cancelled = false;
    fetchRouteDetail(selectedMountainId)
      .then((detail) => {
        if (!cancelled) {
          setSelectedDetail(detail);
        }
      })
      .catch((nextError: Error) => {
        if (!cancelled) {
          setError(nextError.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedMountainId]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.mountainId === selectedMountainId) ?? null,
    [rows, selectedMountainId],
  );
  const detail = selectedDetail ?? selectedRow;

  return (
    <>
      <header>
        <p className="eyebrow">Canonical trails</p>
        <h2>Routes</h2>
      </header>
      {error && (
        <div className="notice error">
          <strong>Route data unavailable</strong>
          <span>{error}</span>
        </div>
      )}
      <div className="route-layout">
        <div className="table-panel">
          <h3>Route coverage</h3>
          <table>
            <thead>
              <tr>
                <th>Mountain</th>
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
                  className={row.mountainId === selectedMountainId ? 'selected-row' : ''}
                  key={row.mountainId}
                >
                  <td>
                    <button
                      className="link-button"
                      onClick={() => setSelectedMountainId(row.mountainId)}
                      type="button"
                    >
                      <strong>{row.displayName}</strong>
                      <span>{row.mountainId}</span>
                    </button>
                  </td>
                  <td>
                    <RouteBadge state={row.routeState} />
                  </td>
                  <td>{formatScore(row.confidence)}</td>
                  <td>{row.sessionCount}</td>
                  <td>{formatScore(row.branchAmbiguityScore)}</td>
                  <td>{formatScore(row.gpsQualityScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel route-detail-panel">
          <div>
            <p className="eyebrow">Selected route</p>
            <h3>{detail?.displayName ?? 'No mountain selected'}</h3>
          </div>
          {detail ? (
            <>
              <div className="route-detail-metrics">
                <Metric label="State" value={detail.routeState} />
                <Metric label="Version" value={detail.version?.toString() ?? '-'} />
                <Metric label="Confidence" value={formatScore(detail.confidence)} />
                <Metric label="Sessions" value={detail.sessionCount.toString()} />
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
              <span>Select a mountain to inspect route geometry.</span>
            </div>
          )}
        </div>
      </div>
      <div className="panel">
        <h3>Snap thresholds</h3>
        <p>On &lt;=25 m, caution 26-50 m, away &gt;50 m.</p>
      </div>
    </>
  );
}

function RouteBadge({ state }: { state: RouteState }) {
  return <span className={`status-badge ${state}`}>{state.replaceAll('_', ' ')}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="route-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatScore(value: number | null) {
  if (value === null) {
    return '-';
  }
  return value.toFixed(2);
}

function routeGeometry(
  detail: OperatorRouteCoverage | OperatorRouteDetail,
): GeoJsonLineString | null {
  return 'trailGeoJson' in detail ? detail.trailGeoJson : null;
}
