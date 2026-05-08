import { useCallback, useEffect, useState } from 'react';

import { type OperatorSessionIngestion } from '../data/readModels';
import { fetchSessionIngestion } from '../data/routesRepository';

export function SessionsPage() {
  const [rows, setRows] = useState<OperatorSessionIngestion[] | null>(null);
  const [selected, setSelected] = useState<OperatorSessionIngestion | null>(null);

  const loadRows = useCallback(() => {
    fetchSessionIngestion().then(setRows).catch(() => setRows(null));
  }, []);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const uploaded = rows?.filter((r) => r.uploadState === 'uploaded').length ?? 0;
  const totalAccepted = rows?.reduce((s, r) => s + r.acceptedPointCount, 0) ?? 0;
  const totalRejected = rows?.reduce((s, r) => s + r.rejectedPointCount, 0) ?? 0;
  const unavailable = rows === null;

  return (
    <>
      <div className="page-header">
        <h2>Sessions</h2>
        <span className="page-badge">Operator only</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" type="button" onClick={loadRows}>↻ Refresh</button>
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">Total sessions</div>
          <div className="stat-value">{unavailable ? '–' : rows!.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Uploaded</div>
          <div className="stat-value good">{unavailable ? '–' : uploaded}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Accepted points</div>
          <div className="stat-value">{unavailable ? '–' : totalAccepted.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rejected points</div>
          <div className="stat-value">{unavailable ? '–' : totalRejected.toLocaleString()}</div>
        </div>
      </div>

      <div className="sessions-layout">
        <div>
          <div className="filter-row">
            <select className="filter-select" disabled><option>State: All</option></select>
            <select className="filter-select" disabled><option>Mountain: All</option></select>
            <div className="filter-spacer" />
          </div>
          <div
            className="table-panel"
            style={unavailable ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
          >
            <div className="table-panel-header">
              <span className="table-panel-title">Session ingestion</span>
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
                    <th>Consent</th>
                    <th>Accepted</th>
                    <th>Rejected</th>
                    <th>Last error</th>
                  </tr>
                </thead>
                <tbody>
                  {rows!.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--text-3)', textAlign: 'center', padding: '16px' }}>
                        No sessions found.
                      </td>
                    </tr>
                  ) : (
                    rows!.map((row) => (
                      <tr
                        key={row.sessionId}
                        className={selected?.sessionId === row.sessionId ? 'selected-row' : ''}
                        onClick={() => setSelected(row)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td>
                          <span className="cell-name cell-mono">{row.sessionId}</span>
                        </td>
                        <td>{row.mountainId}</td>
                        <td>
                          <span className={`status-badge ${row.uploadState}`}>{row.uploadState}</span>
                        </td>
                        <td>{row.consentVersion ?? '-'}</td>
                        <td>{row.acceptedPointCount}</td>
                        <td>{row.rejectedPointCount}</td>
                        <td style={{ color: row.lastError ? 'var(--red)' : 'var(--text-3)' }}>
                          {row.lastError ?? '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="side-stack">
          {selected ? (
            <div className="card">
              <div className="card-title">Selected session</div>
              <div className="score-row">
                <span className="score-label">Session ID</span>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{selected.sessionId}</span>
              </div>
              <div className="score-row">
                <span className="score-label">Mountain</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.mountainId}</span>
              </div>
              <div className="score-row">
                <span className="score-label">State</span>
                <span className={`status-badge ${selected.uploadState}`}>{selected.uploadState}</span>
              </div>
              <div className="score-row">
                <span className="score-label">Consent</span>
                <span style={{ fontSize: 12 }}>{selected.consentVersion ?? '-'}</span>
              </div>
              <div className="score-row">
                <span className="score-label">Accepted pts</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--green)' }}>{selected.acceptedPointCount}</span>
              </div>
              <div className="score-row">
                <span className="score-label">Rejected pts</span>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{selected.rejectedPointCount}</span>
              </div>
              {selected.lastError && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--red-bg)', borderRadius: 5, fontSize: 12, color: 'var(--red)' }}>
                  {selected.lastError}
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <div className="card-title">Session detail</div>
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>Click a row to inspect session detail.</p>
            </div>
          )}

          <div className="card">
            <div className="card-title">Privacy &amp; RLS</div>
            <div className="check-item">
              <span className="check-dot">✓</span>
              Raw traces protected
            </div>
            <div className="check-item">
              <span className="check-dot">✓</span>
              Consent before sync
            </div>
            <div className="check-item">
              <span className="check-dot">✓</span>
              You can see only yours
            </div>
          </div>

          <div className="card">
            <div className="card-title">Feature highlights</div>
            <ul className="bullet-list">
              <li>Upload queue health</li>
              <li>Consent before sync</li>
              <li>Accepted / rejected split</li>
              <li>Accepted / rejected summary</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
