import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { getPageCount, getPageItems, Pagination } from '../components/Pagination';
import { type Mountain, type OperatorRouteCoverage, type OperatorRouteDetail } from '../data/readModels';
import {
  fetchMountains,
  formatBbox,
  parseBbox,
  updateMountainBbox,
} from '../data/mountainsRepository';
import { fetchMountainRouteDetails, fetchRouteCoverage } from '../data/routesRepository';

const OperatorRouteMap = lazy(() =>
  import('../components/OperatorRouteMap').then((m) => ({ default: m.OperatorRouteMap })),
);

type EditState = {
  mountainId: string;
  minLon: string;
  minLat: string;
  maxLon: string;
  maxLat: string;
};

export function MountainsPage() {
  const [mountains, setMountains] = useState<Mountain[]>([]);
  const [coverage, setCoverage] = useState<OperatorRouteCoverage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewRoutes, setPreviewRoutes] = useState<OperatorRouteDetail[]>([]);
  const [page, setPage] = useState(1);

  const loadMountains = useCallback(() => {
    Promise.all([fetchMountains(), fetchRouteCoverage()])
      .then(([m, cov]) => { setMountains(m); setCoverage(cov); })
      .catch((e: Error) => setError(e.message));
  }, []);

  const mountainStats = useMemo(() => {
    const stats = new Map<string, {
      routes: number; recommended: number; reference: number; sessions: number;
      confidenceSum: number; confidenceCount: number; latestUpdatedAt: string | null;
    }>();
    for (const row of coverage) {
      if (row.routeId === null) continue;
      const s = stats.get(row.mountainId) ?? { routes: 0, recommended: 0, reference: 0, sessions: 0, confidenceSum: 0, confidenceCount: 0, latestUpdatedAt: null };
      s.routes++;
      if (row.routeState === 'recommended') s.recommended++;
      else if (row.routeState === 'reference') s.reference++;
      s.sessions += row.sessionCount;
      if (row.confidence !== null) { s.confidenceSum += row.confidence; s.confidenceCount++; }
      if (row.updatedAt !== null && (s.latestUpdatedAt === null || row.updatedAt > s.latestUpdatedAt)) {
        s.latestUpdatedAt = row.updatedAt;
      }
      stats.set(row.mountainId, s);
    }
    return stats;
  }, [coverage]);

  const totals = useMemo(() => ({
    mountains: mountains.length,
    routes: coverage.filter((r) => r.routeId !== null).length,
    recommended: coverage.filter((r) => r.routeState === 'recommended').length,
    sessions: coverage.reduce((s, r) => s + r.sessionCount, 0),
  }), [mountains, coverage]);

  useEffect(() => {
    loadMountains();
  }, [loadMountains]);

  useEffect(() => {
    if (previewId === null) {
      setPreviewRoutes([]);
      return;
    }
    let cancelled = false;
    fetchMountainRouteDetails(previewId).then((routes) => {
      if (!cancelled) {
        setPreviewRoutes(routes);
      }
    }).catch(() => {
      if (!cancelled) setPreviewRoutes([]);
    });
    return () => { cancelled = true; };
  }, [previewId]);

  function startEdit(mountain: Mountain) {
    const bbox = parseBbox(mountain.bbox);
    setEdit({
      mountainId: mountain.id,
      minLon: bbox ? String(bbox[0]) : '',
      minLat: bbox ? String(bbox[1]) : '',
      maxLon: bbox ? String(bbox[2]) : '',
      maxLat: bbox ? String(bbox[3]) : '',
    });
    // focus preview to this mountain so the map can be used as a drawing target
    setPreviewId(mountain.id);
  }

  function cancelEdit() {
    setEdit(null);
  }

  async function saveEdit() {
    if (!edit) return;
    const { mountainId, minLon, minLat, maxLon, maxLat } = edit;
    const allFilled = [minLon, minLat, maxLon, maxLat].every((v) => v.trim() !== '');
    const newBbox = allFilled
      ? formatBbox([
          Number(minLon),
          Number(minLat),
          Number(maxLon),
          Number(maxLat),
        ])
      : null;

    if (allFilled && parseBbox(newBbox) === null) {
      setError('Invalid bbox: check that min < max values.');
      return;
    }

    setSaving(mountainId);
    try {
      await updateMountainBbox(mountainId, newBbox);
      setEdit(null);
      loadMountains();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }

  const previewMountain = mountains.find((m) => m.id === previewId) ?? null;
  const previewBbox = parseBbox(previewMountain?.bbox ?? null);
  const pageCount = getPageCount(mountains.length);
  const pageMountains = getPageItems(mountains, Math.min(page, pageCount));

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  return (
    <>
      <div className="page-header">
        <h2>Mountains</h2>
        <span className="page-badge">Operator only</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" type="button" onClick={loadMountains}>
          Refresh
        </button>
      </div>

      {error && (
        <div className="notice error">
          <strong>Error</strong>
          <span>{error}</span>
          <button
            type="button"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setError(null)}
          >
            Close
          </button>
        </div>
      )}

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="stat-card">
          <div className="stat-label">Mountains</div>
          <div className="stat-value">{totals.mountains}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total routes</div>
          <div className="stat-value">{totals.routes}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Recommended</div>
          <div className="stat-value good">{totals.recommended}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total sessions</div>
          <div className="stat-value">{totals.sessions.toLocaleString()}</div>
        </div>
      </div>

      <div className="route-layout">
        <div className="table-panel">
          <div className="table-panel-header">
            <span className="table-panel-title">Mountain registry</span>
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
              {mountains.length} mountain{mountains.length !== 1 ? 's' : ''}
            </span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Mountain</th>
                <th>Routes</th>
                <th>Sessions</th>
                <th>Avg conf.</th>
                <th>Last updated</th>
                <th>BBox (minLon, minLat, maxLon, maxLat)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mountains.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--text-3)', textAlign: 'center', padding: 16 }}>
                    No mountains found.
                  </td>
                </tr>
              )}
              {pageMountains.map((mountain) => {
                const isEditing = edit?.mountainId === mountain.id;
                const isSaving = saving === mountain.id;
                const isSelected = previewId === mountain.id;
                return (
                  <tr
                    key={mountain.id}
                    className={isSelected ? 'selected-row' : ''}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setPreviewId((prev) => prev === mountain.id ? null : mountain.id)}
                  >
                    <td>
                      <span className="cell-name" style={{ fontWeight: isSelected ? 700 : 400 }}>{mountain.displayName}</span>
                      <span className="cell-sub">{mountain.id}</span>
                    </td>
                    <td>
                      {(() => {
                        const s = mountainStats.get(mountain.id);
                        if (!s || s.routes === 0) return <span className="cell-sub">-</span>;
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="cell-mono">{s.routes}</span>
                            <span style={{ display: 'flex', gap: 3 }}>
                              {s.recommended > 0 && <span className="status-badge recommended" style={{ fontSize: 10, padding: '1px 5px' }}>{s.recommended} rec</span>}
                              {s.reference > 0 && <span className="status-badge reference" style={{ fontSize: 10, padding: '1px 5px' }}>{s.reference} ref</span>}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td>
                      <span className="cell-mono">
                        {mountainStats.get(mountain.id)?.sessions.toLocaleString() ?? '-'}
                      </span>
                    </td>
                    <td>
                      {(() => {
                        const s = mountainStats.get(mountain.id);
                        if (!s || s.confidenceCount === 0) return <span className="cell-sub">-</span>;
                        const pct = Math.round((s.confidenceSum / s.confidenceCount) * 100);
                        const color = pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warn)' : 'var(--error, #e55)';
                        return <span className="cell-mono" style={{ color }}>{pct}%</span>;
                      })()}
                    </td>
                    <td>
                      {(() => {
                        const s = mountainStats.get(mountain.id);
                        if (!s?.latestUpdatedAt) return <span className="cell-sub">-</span>;
                        return <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{formatRelativeDate(s.latestUpdatedAt)}</span>;
                      })()}
                    </td>
                    <td onClick={isEditing ? (e) => e.stopPropagation() : undefined}>
                      {isEditing ? (
                        <BboxInputs
                          edit={edit!}
                          onChange={(field, val) =>
                            setEdit((prev) => prev ? { ...prev, [field]: val } : prev)
                          }
                        />
                      ) : (
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                          {mountain.bbox ?? <span style={{ color: 'var(--text-3)' }}>-</span>}
                        </span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="btn btn-primary" type="button" disabled={isSaving} onClick={saveEdit}>
                            {isSaving ? 'Saving...' : 'Save'}
                          </button>
                          <button className="btn btn-ghost" type="button" onClick={cancelEdit}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button className="btn btn-ghost" type="button" onClick={() => startEdit(mountain)}>
                          Edit bbox
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pagination
            page={Math.min(page, pageCount)}
            totalItems={mountains.length}
            onPageChange={setPage}
          />
        </div>

        <div className="route-detail-panel">
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0, flex: 1 }}>
                {previewMountain ? previewMountain.displayName : 'Select a mountain'}
              </div>
            </div>
            {previewMountain ? (
              <Suspense fallback={<div className="route-map-empty"><strong>Loading map</strong><span>Preparing map preview.</span></div>}>
                <OperatorRouteMap
                  geometry={null}
                  routeState="none"
                  bbox={previewBbox}
                  routes={previewRoutes.filter((r) => r.trailGeoJson !== null).map((r) => ({
                    geometry: r.trailGeoJson!,
                    id: r.routeId ?? undefined,
                    label: r.routeDisplayName ?? r.routeId ?? undefined,
                    routeState: r.routeState,
                  }))}
                  title={previewMountain.displayName}
                  // If we're editing this mountain, enable the small bbox editor.
                  enableBBoxEditor={edit?.mountainId === previewMountain.id}
                  onBBoxChange={(newBbox) => {
                    if (!newBbox) return;
                    setEdit((prev) => prev ? ({
                      ...prev,
                      minLon: String(newBbox[0]),
                      minLat: String(newBbox[1]),
                      maxLon: String(newBbox[2]),
                      maxLat: String(newBbox[3]),
                    }) : prev);
                  }}
                />
              </Suspense>
            ) : (
              <div className="route-map-empty">
                <strong>No mountain selected</strong>
                <span>Click a mountain to preview its bounding box on the map.</span>
              </div>
            )}
          </div>
        </div>
      </div>

    </>
  );
}

function formatRelativeDate(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return new Date(isoString).toLocaleDateString();
}

function BboxInputs({
  edit,
  onChange,
}: {
  edit: EditState;
  onChange: (field: keyof EditState, val: string) => void;
}) {
  const fields: Array<{ key: keyof EditState; label: string }> = [
    { key: 'minLon', label: 'W' },
    { key: 'minLat', label: 'S' },
    { key: 'maxLon', label: 'E' },
    { key: 'maxLat', label: 'N' },
  ];
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {fields.map(({ key, label }) => (
        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 12 }}>
          <span style={{ color: 'var(--text-3)', minWidth: 12 }}>{label}</span>
          <input
            type="number"
            step="0.0001"
            value={edit[key]}
            onChange={(e) => onChange(key, e.target.value)}
            style={{
              width: 84,
              padding: '3px 6px',
              fontSize: 12,
              border: '1px solid var(--border)',
              borderRadius: 4,
            }}
          />
        </label>
      ))}
    </div>
  );
}
