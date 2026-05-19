import { useEffect, useMemo, useState } from 'react';

import { getPageCount, getPageItems, Pagination } from '../components/Pagination';
import { type OperatorRouteQualityDetail } from '../data/readModels';
import { type MatchAndAggregateResult, triggerMatchAndAggregate } from '../data/operationsRepository';
import { fetchRouteQualityDetails } from '../data/routesRepository';

type QualityPageProps = {
  selectedRouteId: string | null;
  onSelectRoute: (id: string | null) => void;
};

export function QualityPage({ selectedRouteId, onSelectRoute }: QualityPageProps) {
  const [rows, setRows] = useState<OperatorRouteQualityDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [recalcResult, setRecalcResult] = useState<MatchAndAggregateResult | null>(null);
  const [recalcError, setRecalcError] = useState<string | null>(null);
  const [routePage, setRoutePage] = useState(1);
  const [stateFilter, setStateFilter] = useState('all');
  const [mountainFilter, setMountainFilter] = useState('all');

  useEffect(() => {
    let cancelled = false;
    fetchRouteQualityDetails()
      .then((nextRows) => {
        if (cancelled) return;
        setRows(nextRows);
        if (selectedRouteId === null) {
          onSelectRoute(nextRows.find((route) => route.routeId !== null)?.routeId ?? null);
        }
      })
      .catch((nextError: Error) => {
        if (!cancelled) setError(nextError.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleRecalculate() {
    setRecalculating(true);
    setRecalcResult(null);
    setRecalcError(null);
    try {
      const result = await triggerMatchAndAggregate();
      setRecalcResult(result);
      setRows(await fetchRouteQualityDetails());
    } catch (err) {
      setRecalcError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecalculating(false);
    }
  }

  const stateOptions = useMemo(() => {
    const states = new Set(rows.map((row) => row.routeState));
    return [...states].sort();
  }, [rows]);

  const mountainOptions = useMemo(() => {
    const mountains = new Map<string, string>();
    for (const row of rows) {
      mountains.set(row.mountainId, row.mountainDisplayName);
    }
    return [...mountains.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const routeRows = useMemo(() => rows
    .filter((row) => row.routeId !== null)
    .filter((row) => {
      if (stateFilter !== 'all' && row.routeState !== stateFilter) return false;
      if (mountainFilter !== 'all' && row.mountainId !== mountainFilter) return false;
      return true;
    }), [rows, stateFilter, mountainFilter]);

  const counts = useMemo(() => ({
    missing: routeRows.filter((row) => row.routeState === 'none').length,
    recommended: routeRows.filter((row) => row.routeState === 'recommended').length,
    reference: routeRows.filter((row) => row.routeState === 'reference').length,
  }), [routeRows]);

  const totalAccepted = routeRows.reduce((sum, row) => sum + row.acceptedPointCount, 0);
  const totalRejected = routeRows.reduce((sum, row) => sum + row.rejectedPointCount, 0);

  const selectedRow = rows.find((row) => row.routeId === selectedRouteId) ?? null;
  const routePageCount = getPageCount(routeRows.length);
  const routePageRows = getPageItems(routeRows, Math.min(routePage, routePageCount));

  useEffect(() => {
    setRoutePage(1);
  }, [stateFilter, mountainFilter]);

  useEffect(() => {
    if (routePage > routePageCount) setRoutePage(routePageCount);
  }, [routePage, routePageCount]);

  useEffect(() => {
    if (selectedRouteId !== null && !routeRows.some((row) => row.routeId === selectedRouteId)) {
      onSelectRoute(null);
    }
  }, [onSelectRoute, routeRows, selectedRouteId]);

  return (
    <>
      <div className="page-header">
        <h2>Quality</h2>
        <span className="page-badge">Operator only</span>
        <button
          className="btn btn-ghost"
          disabled={recalculating}
          onClick={handleRecalculate}
          style={{ marginLeft: 'auto' }}
          type="button"
        >
          {recalculating ? 'Recalculating...' : 'Recalculate graph'}
        </button>
      </div>

      {recalcResult && (
        <div className="notice success">
          <strong>Recalculation complete</strong>
          <span>
            {recalcResult.processedSessions} sessions processed,{' '}
            {recalcResult.affectedRoutes} routes updated,{' '}
            {recalcResult.candidatePointsAdded} candidate points added
            {recalcResult.candidateEdgesFormed > 0
              ? `, ${recalcResult.candidateEdgesFormed} candidate edges`
              : ''}
          </span>
        </div>
      )}
      {recalcError && (
        <div className="notice error"><strong>Recalculation failed</strong><span>{recalcError}</span></div>
      )}
      {error && (
        <div className="notice error"><strong>Quality detail unavailable</strong><span>{error}</span></div>
      )}

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <Stat label="Recommended" sub="routes" tone="good" value={counts.recommended} />
        <Stat label="Reference" sub="routes" tone="warn" value={counts.reference} />
        <Stat label="No route" value={counts.missing} />
        <Stat label="Accepted pts" value={totalAccepted.toLocaleString()} />
        <Stat label="Rejected pts" value={totalRejected.toLocaleString()} />
      </div>

      <div className="quality-layout">
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
            <div className="table-panel-header">
              <span className="table-panel-title">Route quality</span>
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                {routeRows.length} route{routeRows.length !== 1 ? 's' : ''} matching filters
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
                <th>GPS</th>
                <th>Ambiguity</th>
                <th>Accepted</th>
                <th>Rejected</th>
                <th>Latest evidence</th>
              </tr>
            </thead>
            <tbody>
              {routeRows.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ color: 'var(--text-3)', textAlign: 'center', padding: 16 }}>
                    No routes found.
                  </td>
                </tr>
              )}
              {routePageRows.map((row) => {
                const isSelected = row.routeId === selectedRouteId;
                return (
                  <tr
                    className={isSelected ? 'selected-row' : ''}
                    key={row.routeId ?? row.mountainId}
                    onClick={() => {
                      if (row.routeId !== null) onSelectRoute(row.routeId);
                    }}
                    style={{ cursor: row.routeId !== null ? 'pointer' : undefined }}
                  >
                    <td>
                      <span className="cell-name" style={{ fontWeight: isSelected ? 700 : 400 }}>
                        {row.routeDisplayName ?? '-'}
                      </span>
                      <span className="cell-sub">{row.routeId ?? '-'}</span>
                    </td>
                    <td>
                      <span className="cell-name" style={{ fontWeight: isSelected ? 700 : 400 }}>
                        {row.mountainDisplayName}
                      </span>
                      <span className="cell-sub">{row.mountainId}</span>
                    </td>
                    <td><span className={`status-badge ${row.routeState}`}>{row.routeState}</span></td>
                    <td>{formatScore(row.confidence)}</td>
                    <td>{row.sessionCount}</td>
                    <td>{formatScore(row.gpsQualityScore)}</td>
                    <td>{formatScore(row.branchAmbiguityScore)}</td>
                    <td>{row.acceptedPointCount.toLocaleString()}</td>
                    <td>{row.rejectedPointCount.toLocaleString()}</td>
                    <td style={{ fontSize: 12 }}>{formatDate(row.latestEvidenceAt)}</td>
                  </tr>
                );
              })}
            </tbody>
            </table>
            <Pagination page={Math.min(routePage, routePageCount)} totalItems={routeRows.length} onPageChange={setRoutePage} />
          </div>
        </div>

        <div className="side-stack">
          <div className="card">
            <div className="card-title">
              Confidence inputs
              {selectedRow && (
                <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)', marginLeft: 6 }}>
                  - {selectedRow.routeDisplayName ?? selectedRow.routeId}
                </span>
              )}
            </div>
            {selectedRow ? (
              <>
                <ScoreRow label="Session support" max={1} note={`${selectedRow.sessionCount} / 5`} value={Math.min(1, selectedRow.sessionCount / 5)} />
                <ScoreRow label="GPS quality" max={1} value={selectedRow.gpsQualityScore} />
                <ScoreRow invert label="Branch ambiguity" max={1} value={selectedRow.branchAmbiguityScore} />
                <ScoreRow bold label="Confidence" max={1} value={selectedRow.confidence} />
                <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)' }}>
                  Accepted {selectedRow.acceptedPointCount.toLocaleString()} pts, rejected{' '}
                  {selectedRow.rejectedPointCount.toLocaleString()} pts
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Select a route.</p>
            )}
          </div>

          <div className="card">
            <div className="card-title">Trajectory quality model</div>
            <ul className="bullet-list">
              <li>Canonical trails are inferred from refined trajectory support.</li>
              <li>Candidate evidence remains separate until promoted into a route.</li>
              <li>Raw GPS is purged after aggregation; only representative geometry and support metrics remain.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function ScoreRow({
  label,
  value,
  max,
  invert = false,
  bold = false,
  note,
}: {
  label: string;
  value: number | null;
  max: number;
  invert?: boolean;
  bold?: boolean;
  note?: string;
}) {
  const raw = value ?? 0;
  const pct = Math.min(100, Math.round((raw / max) * 100));
  const displayPct = invert ? 100 - pct : pct;
  const fillClass = displayPct >= 70 ? '' : displayPct >= 40 ? 'mid' : 'low';
  const display = value === null ? '-' : max === 1 ? value.toFixed(2) : String(Math.round(raw));

  return (
    <div className="score-row">
      <span className="score-label" style={{ fontWeight: bold ? 600 : undefined }}>
        {label}
        {note && <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 4 }}>({note})</span>}
      </span>
      <div className="score-track">
        <div className={`score-fill ${fillClass}`} style={{ width: `${displayPct}%` }} />
      </div>
      <span className="score-val" style={{ fontWeight: bold ? 600 : undefined }}>{display}</span>
    </div>
  );
}

function formatScore(value: number | null) {
  return value === null ? '-' : value.toFixed(2);
}

function formatDate(value: string | null) {
  return value === null ? '-' : new Date(value).toLocaleString();
}
