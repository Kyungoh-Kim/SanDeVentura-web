import { operatorOverviewMetrics } from '../data/readModels';

export function OverviewPage() {
  return (
    <>
      <header>
        <p className="eyebrow">MVP health</p>
        <h2>Overview</h2>
      </header>
      <div className="metric-grid">
        <Metric
          label="Upload success"
          value={formatPercent(operatorOverviewMetrics.uploadSuccessRate)}
        />
        <Metric
          label="Queued uploads"
          value={operatorOverviewMetrics.queuedUploads.toString()}
        />
        <Metric
          label="Route coverage"
          value={formatPercent(operatorOverviewMetrics.routeCoverage)}
        />
        <Metric
          label="Snap requests"
          value={operatorOverviewMetrics.snapRequests.toString()}
        />
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
