import { sessionIngestionRows } from '../data/readModels';

export function SessionsPage() {
  return (
    <>
      <header>
        <p className="eyebrow">Upload queue</p>
        <h2>Sessions</h2>
      </header>
      <div className="table-panel">
        <h3>Session ingestion</h3>
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
            {sessionIngestionRows.map((row) => (
              <tr key={row.sessionId}>
                <td>{row.sessionId}</td>
                <td>{row.mountainId}</td>
                <td><span className={`status-badge ${row.uploadState}`}>{row.uploadState}</span></td>
                <td>{row.consentVersion ?? '-'}</td>
                <td>{row.acceptedPointCount}</td>
                <td>{row.rejectedPointCount}</td>
                <td>{row.lastError ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
