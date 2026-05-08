import { useEffect, useState } from 'react';

import { type OperatorOverviewMetrics, type OperatorRouteCoverage } from '../data/readModels';
import { fetchOperatorSummary, fetchRouteCoverage } from '../data/routesRepository';

export function OverviewPage() {
  const [metrics, setMetrics] = useState<OperatorOverviewMetrics | null>(null);
  const [coverage, setCoverage] = useState<OperatorRouteCoverage[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOperatorSummary()
      .then((nextMetrics) => { if (!cancelled) setMetrics(nextMetrics); })
      .catch((nextError: Error) => { if (!cancelled) setError(nextError.message); });
    fetchRouteCoverage()
      .then((rows) => { if (!cancelled) setCoverage(rows); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <div className="page-header">
        <h2>Overview</h2>
        <span className="page-badge">Operator only</span>
      </div>

      {error && (
        <div className="notice error">
          <strong>Summary metrics unavailable</strong>
          <span>{error}</span>
        </div>
      )}

      <div className="stat-row">
        <StatCard
          label="Upload success"
          value={formatPercent(metrics?.uploadSuccessRate ?? null)}
          valueClass={metrics ? 'good' : undefined}
        />
        <StatCard
          label="Active sessions"
          value="–"
          sub="live devices"
        />
        <StatCard
          label="Queued uploads"
          value={metrics ? metrics.queuedUploads.toString() : '–'}
          valueClass={metrics && metrics.queuedUploads > 10 ? 'warn' : undefined}
        />
        <StatCard
          label="Route coverage"
          value={formatPercent(metrics?.routeCoverage ?? null)}
          sub="of routes"
        />
        <StatCard
          label="Snap requests"
          value={metrics ? metrics.snapRequests.toLocaleString() : '–'}
        />
        <StatCard
          label="Trail served"
          value={metrics ? metrics.trailServed.toLocaleString() : '–'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 268px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div style={{ opacity: 0.45, pointerEvents: 'none' }}>
            <div className="section-label">Field map status</div>
            <div className="field-step-grid">
              <FieldStep num={1} label="Recent" value="–" sub="recordings" />
              <FieldStep num={2} label="Sync" value="–" sub="points" />
              <FieldStep num={3} label="Guide" value="–" sub="requests" />
            </div>
          </div>

          <div className="card">
            <div className="card-title">Privacy checks</div>
            <CheckItem>Consent enforced</CheckItem>
            <CheckItem>Raw traces protected</CheckItem>
            <CheckItem>Event payload safe</CheckItem>
          </div>

          <div>
            <div className="section-label">Mountain coverage</div>
            {coverage.length > 0 ? (
              <div className="mountain-cards">
                {coverage.map((row) => {
                  const pct = row.confidence !== null ? Math.round(row.confidence * 100) : 0;
                  const fillClass = pct === 0 ? 'low' : pct < 60 ? 'mid' : '';
                  return (
                    <div className="mountain-card" key={row.routeId ?? row.mountainId}>
                      <div className="mountain-card-name">{row.mountainDisplayName}</div>
                      <div className="mountain-card-id">{row.routeDisplayName ?? row.mountainId}</div>
                      <div className="mountain-pct">{pct}%</div>
                      <div className="progress-track">
                        <div className={`progress-fill ${fillClass}`} style={{ width: `${pct}%` }} />
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <span className={`status-badge ${row.routeState}`}>{row.routeState}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: 'var(--text-3)', fontSize: 13 }}>No mountains loaded.</div>
            )}
          </div>
        </div>

        <div className="side-stack">
          <div className="card">
            <div className="card-title">What this shows</div>
            <ul className="bullet-list">
              <li>MVP health at a glance</li>
              <li>Mountain coverage</li>
              <li>Privacy checks</li>
              <li>Recent core events</li>
            </ul>
          </div>
          <div className="card" style={{ opacity: 0.45, pointerEvents: 'none' }}>
            <div className="card-title">Recent events</div>
            <div className="event-item">
              <span className="event-dot" />
              <span className="event-name">–</span>
              <span className="event-time">–</span>
            </div>
            <div className="event-item">
              <span className="event-dot" />
              <span className="event-name">–</span>
              <span className="event-time">–</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function StatCard({
  label,
  value,
  valueClass,
  sub,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${valueClass ? ` ${valueClass}` : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function FieldStep({ num, label, value, sub }: { num: number; label: string; value: string; sub: string }) {
  return (
    <div className="field-step">
      <div className="field-step-header">
        <span className="step-num">{num}</span>
        <span className="field-step-label">{label}</span>
      </div>
      <div className="field-step-value">{value}</div>
      <div className="field-step-sub">{sub}</div>
    </div>
  );
}

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="check-item">
      <span className="check-dot">✓</span>
      {children}
    </div>
  );
}

function formatPercent(value: number | null) {
  if (value === null) return '–';
  return `${Math.round(value * 100)}%`;
}
