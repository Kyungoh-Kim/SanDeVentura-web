import { routeCoverageRows } from '../data/readModels';

export function QualityPage() {
  const recommended = routeCoverageRows.filter(
    (row) => row.routeState === 'recommended',
  ).length;
  const reference = routeCoverageRows.filter(
    (row) => row.routeState === 'reference',
  ).length;
  const missing = routeCoverageRows.filter((row) => row.routeState === 'none')
    .length;

  return (
    <>
      <header>
        <p className="eyebrow">Route quality</p>
        <h2>Quality</h2>
      </header>
      <div className="panel">
        <h3>Quality signals</h3>
        <p>
          Recommended {recommended}, reference {reference}, no route {missing}.
          Confidence depends on session support, GPS quality, and branch ambiguity.
        </p>
      </div>
      <div className="panel">
        <h3>Beta blockers</h3>
        <ul className="check-list">
          <li>Routes below 0.70 stay reference-only.</li>
          <li>Raw track points remain blocked by RLS policies.</li>
          <li>Snap event payloads store judgment buckets, not coordinates.</li>
        </ul>
      </div>
    </>
  );
}
