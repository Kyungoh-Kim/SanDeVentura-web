import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { CopyableId } from '../components/CopyableId';
import {
  type OperatorSessionIngestion,
  type OperatorSessionRouteAttribution,
  type OperatorSessionEdgeAttribution,
} from '../data/readModels';
import { getPageCount, getPageItems, Pagination } from '../components/Pagination';
import {
  fetchSessionIngestion,
  fetchSessionEdgeAttribution,
  fetchSessionRouteAttribution,
} from '../data/routesRepository';

type DetailState = {
  routes: OperatorSessionRouteAttribution[];
  edges: OperatorSessionEdgeAttribution[];
  status: 'idle' | 'loading' | 'ready' | 'error';
};

const emptyDetail: DetailState = { routes: [], edges: [], status: 'idle' };

export function SessionsPage() {
  const [rows, setRows] = useState<OperatorSessionIngestion[] | null>(null);
  const [selected, setSelected] = useState<OperatorSessionIngestion | null>(null);
  const [detail, setDetail] = useState<DetailState>(emptyDetail);
  const [stateFilter, setStateFilter] = useState('all');
  const [mountainFilter, setMountainFilter] = useState('all');
  const [page, setPage] = useState(1);

  const loadRows = useCallback(() => {
    fetchSessionIngestion().then(setRows).catch(() => setRows(null));
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  useEffect(() => {
    if (!selected) {
      setDetail(emptyDetail);
      return;
    }

    let active = true;
    setDetail({ routes: [], edges: [], status: 'loading' });

    Promise.all([
      fetchSessionRouteAttribution(selected.sessionId),
      fetchSessionEdgeAttribution(selected.sessionId),
    ])
      .then(([routes, edges]) => {
        if (active) setDetail({ routes, edges, status: 'ready' });
      })
      .catch(() => {
        if (active) setDetail({ routes: [], edges: [], status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [selected]);

  const stats = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      ingested: list.filter((row) => row.pipelineState === 'ingested').length,
      exact: list.filter((row) => row.attributionPrecision === 'exact').length,
      routeSupport: list.reduce((sum, row) => sum + row.matchedRouteSupportCount, 0),
      candidateSupport: list.reduce((sum, row) => sum + row.candidateSupportCount, 0),
    };
  }, [rows]);

  const stateOptions = useMemo(() => {
    const states = new Set((rows ?? []).map((row) => row.pipelineState));
    return [...states].sort();
  }, [rows]);

  const mountainOptions = useMemo(() => {
    const mountains = new Map<string, string>();
    for (const row of rows ?? []) {
      mountains.set(row.mountainId, row.mountainDisplayName);
    }
    return [...mountains.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  const filteredRows = useMemo(() => (rows ?? []).filter((row) => {
    if (stateFilter !== 'all' && row.pipelineState !== stateFilter) return false;
    if (mountainFilter !== 'all' && row.mountainId !== mountainFilter) return false;
    return true;
  }), [rows, stateFilter, mountainFilter]);

  const pageCount = getPageCount(filteredRows.length);
  const pageRows = getPageItems(filteredRows, Math.min(page, pageCount));

  useEffect(() => {
    setPage(1);
  }, [stateFilter, mountainFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  useEffect(() => {
    if (selected && !filteredRows.some((row) => row.sessionId === selected.sessionId)) {
      setSelected(null);
    }
  }, [filteredRows, selected]);

  const unavailable = rows === null;
  const candidateEdges = detail.edges.filter((row) => row.targetKind === 'candidate');
  const matchedEdges = detail.edges.filter((row) => row.targetKind === 'edge');

  return (
    <>
      <div className="page-header">
        <h2>Sessions</h2>
        <span className="page-badge">Operator only</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" type="button" onClick={loadRows}>Refresh</button>
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <StatCard label="Total sessions" value={unavailable ? '-' : stats.total} />
        <StatCard label="Ingested" value={unavailable ? '-' : stats.ingested} tone="good" />
        <StatCard label="Exact attribution" value={unavailable ? '-' : stats.exact} />
        <StatCard label="Edge support" value={unavailable ? '-' : stats.routeSupport} />
        <StatCard label="Candidate edges" value={unavailable ? '-' : stats.candidateSupport} tone="warn" />
      </div>

      <div className="sessions-layout">
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
          <div
            className="table-panel"
            style={unavailable ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
          >
            <div className="table-panel-header">
              <span className="table-panel-title">Session ingestion</span>
              {!unavailable && (
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                  {filteredRows.length} session{filteredRows.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {unavailable ? (
              <div style={{ padding: '24px 16px', color: 'var(--text-3)', fontSize: 13 }}>
                Session data not available.
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Mountain</th>
                    <th>State</th>
                    <th>Precision</th>
                    <th>Edge support</th>
                    <th>Candidate edges</th>
                    <th>Accepted</th>
                    <th>Rejected</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ color: 'var(--text-3)', textAlign: 'center', padding: '16px' }}>
                        No sessions found.
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((row) => (
                      <tr
                        key={row.sessionId}
                        className={selected?.sessionId === row.sessionId ? 'selected-row' : ''}
                        onClick={() => setSelected(row)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <span className="cell-name"><CopyableId value={row.sessionId} /></span>
                        </td>
                        <td>
                          <span className="cell-name">{row.mountainDisplayName}</span>
                          <span className="cell-sub">{row.mountainId}</span>
                        </td>
                        <td><span className={`status-badge ${row.pipelineState}`}>{row.pipelineState}</span></td>
                        <td><span className={`status-badge ${row.attributionPrecision}`}>{row.attributionPrecision}</span></td>
                        <td>{formatSupportAndPoints(row.matchedRouteSupportCount, row.matchedRoutePointCount)}</td>
                        <td>{formatSupportAndPoints(row.candidateSupportCount, row.candidatePointCount)}</td>
                        <td>{row.acceptedPointCount.toLocaleString()}</td>
                        <td>{row.rejectedPointCount.toLocaleString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
            {!unavailable && (
              <Pagination
                page={Math.min(page, pageCount)}
                totalItems={filteredRows.length}
                onPageChange={setPage}
              />
            )}
          </div>
        </div>

        <div className="side-stack">
          {selected ? (
            <>
              <div className="card">
                <div className="card-title">Selected session</div>
                <ScoreRow label="Session ID" value={<CopyableId value={selected.sessionId} />} />
                <ScoreRow label="Mountain" value={selected.mountainDisplayName} />
                <ScoreRow label="State" value={selected.pipelineState} badgeClass={selected.pipelineState} />
                <ScoreRow label="Attribution" value={selected.attributionPrecision} badgeClass={selected.attributionPrecision} />
                <ScoreRow label="Consent" value={selected.consentVersion ?? '-'} />
                <ScoreRow label="Raw retention" value={selected.rawRetentionState} />
                <ScoreRow label="Recomputable" value={selected.recomputable ? 'yes' : 'no'} />
                <ScoreRow label="Algorithm" value={selected.processedAlgorithmVersion ?? '-'} />
              </div>

              <div className="card">
                <div className="card-title">Session edge attribution</div>
                {detail.status === 'loading' ? (
                  <EmptyNote>Loading session edge attribution.</EmptyNote>
                ) : detail.edges.length === 0 ? (
                  <EmptyNote>No edge attribution is available for this session.</EmptyNote>
                ) : (
                  <EdgeList rows={detail.edges} />
                )}
              </div>

              <div className="card">
                <div className="card-title">Route-compatible matches</div>
                {detail.status === 'loading' ? (
                  <EmptyNote>Loading route attribution.</EmptyNote>
                ) : detail.status === 'error' ? (
                  <EmptyNote>Route attribution not available.</EmptyNote>
                ) : detail.routes.length === 0 ? (
                  <EmptyNote>No matched routes for this session.</EmptyNote>
                ) : (
                  <div className="detail-list">
                    {detail.routes.map((route) => (
                      <div className="detail-item" key={route.routeId}>
                        <div>
                          <strong>{route.routeDisplayName}</strong>
                          <span>{route.routeId}</span>
                          <span>{formatRouteMatchDiagnostics(route)}</span>
                        </div>
                        <div className="detail-metrics">
                          <b>{route.supportCount}</b> intervals
                          <b>{route.pointCount ?? '-'}</b> points
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="card">
                <div className="card-title">Candidate edge evidence</div>
                <ScoreRow label="Candidate intervals" value={selected.candidateSupportCount.toLocaleString()} />
                <ScoreRow
                  label="Candidate points"
                  value={selected.candidatePointCount === null ? 'Historical aggregate only' : selected.candidatePointCount.toLocaleString()}
                />
                {candidateEdges.length > 0 ? (
                  <EdgeList rows={candidateEdges} />
                ) : (
                  <EmptyNote>No candidate evidence for this session.</EmptyNote>
                )}
              </div>

              <div className="card">
                <div className="card-title">Matched edge evidence</div>
                {matchedEdges.length > 0 ? (
                  <EdgeList rows={matchedEdges} />
                ) : (
                  <EmptyNote>No matched edge details for this session.</EmptyNote>
                )}
              </div>
            </>
          ) : (
            <div className="card">
              <div className="card-title">Session detail</div>
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>
                Click a row to inspect matched edge and candidate edge attribution.
              </p>
            </div>
          )}

          <div className="card">
            <div className="card-title">Privacy boundary</div>
            <div className="check-item"><span className="check-dot">OK</span>Raw traces protected</div>
            <div className="check-item"><span className="check-dot">OK</span>No coordinates in session detail</div>
            <div className="check-item"><span className="check-dot">OK</span>Aggregate graph edge support only</div>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: 'good' | 'warn' | 'bad';
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${tone ?? ''}`}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
  );
}

function ScoreRow({
  label,
  value,
  mono = false,
  badgeClass,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
  badgeClass?: string;
}) {
  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      {badgeClass ? (
        <span className={`status-badge ${badgeClass}`}>{value}</span>
      ) : (
        <span style={{ fontFamily: mono ? 'ui-monospace, monospace' : undefined, fontSize: 12, fontWeight: 600 }}>
          {value}
        </span>
      )}
    </div>
  );
}

function EmptyNote({ children }: { children: string }) {
  return <p style={{ fontSize: 13, color: 'var(--text-3)' }}>{children}</p>;
}

function EdgeList({ rows }: { rows: OperatorSessionEdgeAttribution[] }) {
  return (
    <div className="detail-list">
      {rows.map((row) => (
        <div className="detail-item" key={`${row.intervalIndex}-${row.edgeId ?? row.candidateEdgeId}`}>
          <div>
            <strong>{row.targetKind === 'edge' ? row.routeDisplayName ?? row.edgeId : `Candidate ${row.residualKind}`}</strong>
            <span>{row.algorithmVersion}</span>
            <span>{formatEdgeDiagnostics(row)}</span>
          </div>
          <div className="detail-metrics">
            <b>{row.pointCount.toLocaleString()}</b> points
            <b>{formatMeters(row.matchedLengthMeters)}</b>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSupportAndPoints(cells: number, points: number | null): string {
  return points === null
    ? `${cells.toLocaleString()} / -`
    : `${cells.toLocaleString()} / ${points.toLocaleString()}`;
}

function formatRouteMatchDiagnostics(route: OperatorSessionRouteAttribution): string {
  const parts = [route.matchMethod.replaceAll('_', ' ')];
  if (route.frechetDistance !== null) {
    parts.push(`${Math.round(route.frechetDistance)}m Frechet`);
  }
  if (route.overlapRatio !== null) {
    parts.push(`${Math.round(route.overlapRatio * 100)}% overlap`);
  }
  if (route.scoreMargin !== null && Number.isFinite(route.scoreMargin)) {
    parts.push(`${Math.round(route.scoreMargin)}m margin`);
  }
  return parts.join(' / ');
}

function formatEdgeDiagnostics(row: OperatorSessionEdgeAttribution): string {
  const parts: string[] = [`#${row.intervalIndex}`, row.targetKind, row.direction];
  if (row.residualKind) parts.push(row.residualKind);
  if (row.rawRetentionState === 'purged') parts.push('raw purged');
  if (!row.recomputable) parts.push('not recomputable');
  return parts.join(' / ');
}

function formatMeters(value: number | null): string {
  return value === null ? '-' : `${Math.round(value).toLocaleString()}m`;
}
