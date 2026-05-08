import { useEffect, useMemo, useState } from 'react';

import { routeQualityRows, type OperatorRouteQualityDetail } from '../data/readModels';
import { fetchRouteQualityDetails } from '../data/routesRepository';

export function QualityPage() {
  const [rows, setRows] = useState<OperatorRouteQualityDetail[]>(routeQualityRows);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRouteQualityDetails()
      .then((nextRows) => {
        if (!cancelled) {
          setRows(nextRows);
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

  const counts = useMemo(() => ({
    recommended: rows.filter((row) => row.routeState === 'recommended').length,
    reference: rows.filter((row) => row.routeState === 'reference').length,
    missing: rows.filter((row) => row.routeState === 'none').length,
  }), [rows]);

  return (
    <>
      <header>
        <p className="eyebrow">Route quality</p>
        <h2>Quality</h2>
      </header>
      {error && (
        <div className="notice error">
          <strong>Quality detail unavailable</strong>
          <span>{error}</span>
        </div>
      )}
      <div className="panel">
        <h3>Quality signals</h3>
        <p>
          Recommended {counts.recommended}, reference {counts.reference}, no route{' '}
          {counts.missing}. Confidence depends on session support, GPS quality,
          branch ambiguity, rejected points, and recency.
        </p>
      </div>
      <div className="table-panel">
        <h3>Evidence detail</h3>
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
                  <strong>{row.displayName}</strong>
                  <span>{row.mountainId}</span>
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
                <td>{formatDate(row.latestEvidenceAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h3>Beta gate</h3>
        <ul className="check-list">
          <li>Routes below the recommendation gate stay reference-only.</li>
          <li>Raw track points remain blocked by RLS policies.</li>
          <li>Snap event payloads store judgment buckets, not coordinates.</li>
          <li>Hosted staging credentials or Android field evidence remain required.</li>
        </ul>
      </div>
    </>
  );
}

function formatScore(value: number | null) {
  if (value === null) {
    return '-';
  }
  return value.toFixed(2);
}

function formatDate(value: string | null) {
  if (value === null) {
    return '-';
  }
  return new Date(value).toLocaleString();
}
