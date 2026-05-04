export function OverviewPage() {
  return (
    <>
      <header>
        <p className="eyebrow">MVP health</p>
        <h2>Overview</h2>
      </header>
      <div className="metric-grid">
        <Metric label="Upload success" value="-" />
        <Metric label="Queued uploads" value="-" />
        <Metric label="Route coverage" value="-" />
        <Metric label="Snap requests" value="-" />
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

