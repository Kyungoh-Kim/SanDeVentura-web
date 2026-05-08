import { useEffect, useState } from 'react';

import { operatorOverviewMetrics, type OperatorOverviewMetrics } from '../data/readModels';
import { fetchOperatorSummary } from '../data/routesRepository';

export function OverviewPage() {
  const [metrics, setMetrics] = useState<OperatorOverviewMetrics>(operatorOverviewMetrics);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchOperatorSummary()
      .then((nextMetrics) => {
        if (!cancelled) {
          setMetrics(nextMetrics);
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
  }, []);

  return (
    <>
      <header>
        <p className="eyebrow">MVP health</p>
        <h2>Overview</h2>
      </header>
      {error && (
        <div className="notice error">
          <strong>Summary metrics unavailable</strong>
          <span>{error}</span>
        </div>
      )}
      <div className="metric-grid">
        <Metric label="Upload success" value={formatPercent(metrics.uploadSuccessRate)} />
        <Metric label="Queued uploads" value={metrics.queuedUploads.toString()} />
        <Metric label="Route coverage" value={formatPercent(metrics.routeCoverage)} />
        <Metric label="Snap requests" value={metrics.snapRequests.toString()} />
        <Metric label="Trail served" value={metrics.trailServed.toString()} />
      </div>
    </>
  );
}

function formatPercent(value: number | null) {
  if (value === null) {
    return '-';
  }
  return `${Math.round(value * 100)}%`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
