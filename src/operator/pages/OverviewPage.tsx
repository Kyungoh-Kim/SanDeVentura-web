import { useEffect, useState } from 'react';

import { operatorOverviewMetrics, routeCoverageRows, type OperatorOverviewMetrics } from '../data/readModels';
import { fetchOperatorSummary } from '../data/routesRepository';

export function OverviewPage() {
  const [metrics, setMetrics] = useState<OperatorOverviewMetrics>(operatorOverviewMetrics);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOperatorSummary()
      .then((nextMetrics) => { if (!cancelled) setMetrics(nextMetrics); })
      .catch((nextError: Error) => { if (!cancelled) setError(nextError.message); });
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
          value={formatPercent(metrics.uploadSuccessRate)}
          valueClass="good"
          sub="vs last 7 days"
          trend="↑ improving"
          trendClass="up"
        />
        <StatCard
          label="Active sessions"
          value="–"
          sub="live devices"
        />
        <StatCard
          label="Queued uploads"
          value={metrics.queuedUploads.toString()}
          valueClass={metrics.queuedUploads > 10 ? 'warn' : undefined}
        />
        <StatCard
          label="Route coverage"
          value={formatPercent(metrics.routeCoverage)}
          sub="of mountains"
        />
        <StatCard
          label="Snap requests"
          value={metrics.snapRequests.toLocaleString()}
        />
        <StatCard
          label="Trail served"
          value={metrics.trailServed.toLocaleString()}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 268px', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <div>
            <div className="section-label">Field map status</div>
            <div className="field-step-grid">
              <FieldStep num={1} label="Recent" value={1} sub="recordings" />
              <FieldStep num={2} label="Sync" value={138} sub="points" />
              <FieldStep num={3} label="Guide" value={4512} sub="requests" />
            </div>
          </div>

          <div className="card">
            <div className="card-title">Privacy checks</div>
            <CheckItem>Consent enforced</CheckItem>
            <CheckItem>Raw traces protected</CheckItem>
            <CheckItem>Event payload safe</CheckItem>
          </div>

          <div>
            <div className="section-label">Beta mountain coverage</div>
            <div className="mountain-cards">
              {routeCoverageRows.map((row) => {
                const pct = row.confidence !== null ? Math.round(row.confidence * 100) : 0;
                const fillClass = pct === 0 ? 'low' : pct < 60 ? 'mid' : '';
                return (
                  <div className="mountain-card" key={row.mountainId}>
                    <div className="mountain-card-name">{row.displayName}</div>
                    <div className="mountain-card-id">{row.mountainId}</div>
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
          </div>
        </div>

        <div className="side-stack">
          <div className="card">
            <div className="card-title">What this shows</div>
            <ul className="bullet-list">
              <li>MVP health at a glance</li>
              <li>Beta mountain coverage</li>
              <li>Privacy checks</li>
              <li>Recent core events</li>
            </ul>
          </div>
          <div className="card">
            <div className="card-title">Recent events</div>
            <div className="event-item">
              <span className="event-dot" />
              <span className="event-name">session_started</span>
              <span className="event-time">19s</span>
            </div>
            <div className="event-item">
              <span className="event-dot" />
              <span className="event-name">session_started</span>
              <span className="event-time">1 min</span>
            </div>
            <div className="event-item">
              <span className="event-dot" />
              <span className="event-name">session_uploaded</span>
              <span className="event-time">22 min</span>
            </div>
            <div className="event-item">
              <span className="event-dot" />
              <span className="event-name">snap_requested</span>
              <span className="event-time">31 min</span>
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
  trend,
  trendClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  trend?: string;
  trendClass?: 'up' | 'down';
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${valueClass ? ` ${valueClass}` : ''}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
      {trend && <div className={`stat-trend${trendClass ? ` ${trendClass}` : ''}`}>{trend}</div>}
    </div>
  );
}

function FieldStep({ num, label, value, sub }: { num: number; label: string; value: number; sub: string }) {
  return (
    <div className="field-step">
      <div className="field-step-header">
        <span className="step-num">{num}</span>
        <span className="field-step-label">{label}</span>
      </div>
      <div className="field-step-value">{value.toLocaleString()}</div>
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
  if (value === null) return '-';
  return `${Math.round(value * 100)}%`;
}
