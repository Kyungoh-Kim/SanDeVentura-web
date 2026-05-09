import { lazy, Suspense, useCallback, useEffect, useState } from 'react';

import { type CandidateCell, type Mountain, type OperatorRouteDetail } from '../data/readModels';
import {
  fetchMountains,
  formatBbox,
  parseBbox,
  updateMountainBbox,
} from '../data/mountainsRepository';
import { fetchCandidateCells, fetchTrailCells } from '../data/operationsRepository';
import { fetchMountainRouteDetails } from '../data/routesRepository';

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
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewRoutes, setPreviewRoutes] = useState<OperatorRouteDetail[]>([]);
  const [previewCells, setPreviewCells] = useState<CandidateCell[]>([]);

  const loadMountains = useCallback(() => {
    fetchMountains()
      .then(setMountains)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    loadMountains();
  }, [loadMountains]);

  useEffect(() => {
    if (previewId === null) { setPreviewRoutes([]); setPreviewCells([]); return; }
    let cancelled = false;
    Promise.all([
      fetchMountainRouteDetails(previewId),
      fetchCandidateCells(previewId),
      fetchTrailCells(previewId),
    ]).then(([routes, candidateCells, trailCells]) => {
      if (!cancelled) {
        setPreviewRoutes(routes);
        setPreviewCells([...trailCells, ...candidateCells]);
      }
    }).catch(() => {
      if (!cancelled) { setPreviewRoutes([]); setPreviewCells([]); }
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
      setError('Invalid bbox — check that min < max values.');
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

  return (
    <>
      <div className="page-header">
        <h2>Mountains</h2>
        <span className="page-badge">Operator only</span>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" type="button" onClick={loadMountains}>
          ↻ Refresh
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
            ✕
          </button>
        </div>
      )}

      <div className="route-layout">
        <div className="table-panel">
          <div className="table-panel-header">
            <span className="table-panel-title">Mountain registry</span>
          </div>
          <table>
            <thead>
              <tr>
                <th>Mountain</th>
                <th>BBox (minLon, minLat, maxLon, maxLat)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {mountains.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--text-3)', textAlign: 'center', padding: 16 }}>
                    No mountains found.
                  </td>
                </tr>
              )}
              {mountains.map((mountain) => {
                const isEditing = edit?.mountainId === mountain.id;
                const isSaving = saving === mountain.id;
                return (
                  <tr
                    key={mountain.id}
                    className={previewId === mountain.id ? 'selected-row' : ''}
                  >
                    <td>
                      <button
                        className="link-button"
                        type="button"
                        onClick={() =>
                          setPreviewId((prev) =>
                            prev === mountain.id ? null : mountain.id,
                          )
                        }
                      >
                        <span className="cell-name">{mountain.displayName}</span>
                        <span className="cell-sub">{mountain.id}</span>
                      </button>
                    </td>
                    <td>
                      {isEditing ? (
                        <BboxInputs
                          edit={edit!}
                          onChange={(field, val) =>
                            setEdit((prev) => prev ? { ...prev, [field]: val } : prev)
                          }
                        />
                      ) : (
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                          {mountain.bbox ?? <span style={{ color: 'var(--text-3)' }}>—</span>}
                        </span>
                      )}
                    </td>
                    <td>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            className="btn btn-primary"
                            type="button"
                            disabled={isSaving}
                            onClick={saveEdit}
                          >
                            {isSaving ? '…' : 'Save'}
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-ghost"
                          type="button"
                          onClick={() => startEdit(mountain)}
                        >
                          Edit bbox
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="route-detail-panel">
          <div className="card">
            <div className="card-title">
              {previewMountain
                ? `Map preview — ${previewMountain.displayName}`
                : 'Select a mountain'}
            </div>
            {previewMountain ? (
              <Suspense
                fallback={
                  <div className="route-map-empty">
                    <strong>Loading map</strong>
                    <span>Preparing map preview.</span>
                  </div>
                }
              >
                <OperatorRouteMap
                  geometry={null}
                  routeState="none"
                  bbox={previewBbox}
                  routes={previewRoutes
                    .filter((r) => r.trailGeoJson !== null)
                    .map((r) => ({ geometry: r.trailGeoJson!, routeState: r.routeState }))}
                  cells={previewCells}
                />
              </Suspense>
            ) : (
              <div className="route-map-empty">
                <strong>No mountain selected</strong>
                <span>Click a mountain to preview its bounding box on the map.</span>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">About bbox</div>
            <ul className="bullet-list">
              <li>Format: minLon,minLat,maxLon,maxLat</li>
              <li>WGS84 decimal degrees</li>
              <li>Used to frame the map view</li>
              <li>Falls back to route geometry when present</li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
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
