import { routeCoverageRows, type RouteState } from '../data/readModels';

export function RoutesPage() {
  return (
    <>
      <header>
        <p className="eyebrow">Canonical trails</p>
        <h2>Routes</h2>
      </header>
      <div className="table-panel">
        <h3>Route coverage</h3>
        <table>
          <thead>
            <tr>
              <th>Mountain</th>
              <th>State</th>
              <th>Confidence</th>
              <th>Sessions</th>
              <th>Ambiguity</th>
              <th>GPS</th>
            </tr>
          </thead>
          <tbody>
            {routeCoverageRows.map((row) => (
              <tr key={row.mountainId}>
                <td>
                  <strong>{row.displayName}</strong>
                  <span>{row.mountainId}</span>
                </td>
                <td>
                  <RouteBadge state={row.routeState} />
                </td>
                <td>{formatScore(row.confidence)}</td>
                <td>{row.sessionCount}</td>
                <td>{formatScore(row.branchAmbiguityScore)}</td>
                <td>{formatScore(row.gpsQualityScore)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h3>Snap thresholds</h3>
        <p>On &lt;=25 m, caution 26-50 m, away &gt;50 m.</p>
      </div>
    </>
  );
}

function RouteBadge({ state }: { state: RouteState }) {
  return <span className={`status-badge ${state}`}>{state.replaceAll('_', ' ')}</span>;
}

function formatScore(value: number | null) {
  if (value === null) {
    return '-';
  }
  return value.toFixed(2);
}
