import { useEffect, useMemo, useState } from 'react';

import { routeQualityRows, type OperatorRouteQualityDetail } from '../data/readModels';
import { fetchRouteQualityDetails } from '../data/routesRepository';

export function QualityPage() {
  const [rows, setRows] = useState<OperatorRouteQualityDetail[]>(routeQualityRows);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRouteQualityDetails()
      .then((nextRows) => { if (!cancelled) setRows(nextRows); })
      .catch((nextError: Error) => { if (!cancelled) setError(nextError.message); });
    return () => { cancelled = true; };
  }, []);

  const counts = useMemo(() => ({
    recommended: rows.filter((row) => row.routeState === 'recommended').length,
    reference: rows.filter((row) => row.routeState === 'reference').length,
    missing: rows.filter((row) => row.routeState === 'none').length,
  }), [rows]);

  const totalAccepted = rows.reduce((s, r) => s + r.acceptedPointCount, 0);
  const totalRejected = rows.reduce((s, r) => s + r.rejectedPointCount, 0);

  const firstRow = rows[0] ?? null;

  return (
    <>
      <div className="page-header">
        <h2>Quality</h2>
        <span className="page-badge">Operator only</span>
      </div>

      {error && (
        <div className="notice error">
          <strong>Quality detail unavailable</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">Recommended</div>
          <div className="stat-value good">{counts.recommended}</div>
          <div className="stat-sub">routes</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Reference</div>
          <div className="stat-value warn">{counts.reference}</div>
          <div className="stat-sub">routes</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">No route</div>
          <div className="stat-value">{counts.missing}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Accepted pts</div>
          <div className="stat-value">{totalAccepted.toLocaleString()}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Rejected pts</div>
          <div className="stat-value">{totalRejected.toLocaleString()}</div>
        </div>
      </div>

      <div className="quality-layout">
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="table-panel">
            <div className="table-panel-header">
              <span className="table-panel-title">Route coverage by mountain</span>
            </div>
            <table>
              <thead>
                <tr>
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
                {rows.map((row) => (
                  <tr key={row.mountainId}>
                    <td>
                      <span className="cell-name">{row.displayName}</span>
                      <span className="cell-sub">{row.mountainId}</span>
                    </td>
                    <td>
                      <span className={`status-badge ${row.routeState}`}>{row.routeState}</span>
                    </td>
                    <td>{formatScore(row.confidence)}</td>
                    <td>{row.sessionCount}</td>
                    <td>{formatScore(row.gpsQualityScore)}</td>
                    <td>{formatScore(row.branchAmbiguityScore)}</td>
                    <td>{row.acceptedPointCount}</td>
                    <td>{row.rejectedPointCount}</td>
                    <td style={{ fontSize: 12 }}>{formatDate(row.latestEvidenceAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-stack">
          <div className="card">
            <div className="card-title">Confidence inputs</div>
            {firstRow ? (
              <>
                <ScoreRow label="Session count" value={firstRow.sessionCount} max={10} />
                <ScoreRow label="GPS quality" value={firstRow.gpsQualityScore} max={1} />
                <ScoreRow label="Branch ambiguity" value={firstRow.branchAmbiguityScore} max={1} invert />
                <ScoreRow label="Recency" value={1} max={1} />
                <ScoreRow label="Confidence" value={firstRow.confidence} max={1} />
              </>
            ) : (
              <p style={{ fontSize: 13, color: 'var(--text-3)' }}>No data loaded.</p>
            )}
          </div>

          <div className="card">
            <div className="card-title">Privacy &amp; RLS</div>
            <div className="check-item">
              <span className="check-dot">✓</span>
              Raw traces protected
            </div>
            <div className="check-item">
              <span className="check-dot">✓</span>
              Consent enforced
            </div>
            <div className="check-item">
              <span className="check-dot">✓</span>
              Event payload safe
            </div>
          </div>

          <div className="card">
            <div className="card-title">Operator notes</div>
            <ul className="bullet-list">
              <li>Operator quality only</li>
              <li>Route coverage by mountain</li>
              <li>Privacy and RLS checks</li>
              <li>Accepted / rejected points</li>
            </ul>
          </div>

          <div className="card">
            <div className="card-title">Beta gate</div>
            <ul className="bullet-list">
              <li>Routes below gate stay reference-only.</li>
              <li>Raw track points blocked by RLS.</li>
              <li>Snap payloads store buckets, not coords.</li>
              <li>Staging credentials or field evidence required.</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

function ScoreRow({
  label,
  value,
  max,
  invert = false,
}: {
  label: string;
  value: number | null;
  max: number;
  invert?: boolean;
}) {
  const raw = value ?? 0;
  const pct = Math.min(100, Math.round((raw / max) * 100));
  const displayPct = invert ? 100 - pct : pct;
  const fillClass = displayPct >= 70 ? '' : displayPct >= 40 ? 'mid' : 'low';
  const display = value === null ? '-' : max === 1 ? value.toFixed(2) : String(Math.round(raw));

  return (
    <div className="score-row">
      <span className="score-label">{label}</span>
      <div className="score-track">
        <div className={`score-fill ${fillClass}`} style={{ width: `${displayPct}%` }} />
      </div>
      <span className="score-val">{display}</span>
    </div>
  );
}

function formatScore(value: number | null) {
  if (value === null) return '-';
  return value.toFixed(2);
}

function formatDate(value: string | null) {
  if (value === null) return '-';
  return new Date(value).toLocaleString();
}
