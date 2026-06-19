import React, { useEffect, useState } from 'react';
import BboxSelectorMap from './BboxSelectorMap';
import { parseBbox, formatBbox } from '../data/mountainsRepository';

export default function CreateMountainModal({
  value,
  onChange,
  onConfirm,
  onCancel,
  creating,
}: {
  value: string | null;
  onChange: (v: string) => void;
  onConfirm: (id: string, displayName: string, bbox: string | null) => Promise<void>;
  onCancel: () => void;
  creating: boolean;
}) {
  const id = value ?? '';
  const [displayName, setDisplayName] = useState('');
  const [bbox, setBbox] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    // reset internal fields when modal mounts (modal open). Do not
    // reset on every id change (typing) — that cleared inputs unexpectedly.
    setDisplayName('');
    setBbox('');
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && id.trim() !== '' && displayName.trim() !== '') onConfirm(id.trim(), displayName.trim(), bbox.trim() === '' ? null : bbox.trim());
    if (e.key === 'Escape') onCancel();
  }

  const idValid = /^[a-z0-9\-]+$/.test((id ?? '').trim());

  async function handleCreate() {
    setErrorMsg(null);
    const trimmedId = (id ?? '').trim();
    if (trimmedId === '') {
      setErrorMsg('Mountain ID is required');
      return;
    }
    if (!idValid) {
      setErrorMsg('Mountain ID may only contain lowercase letters, digits and hyphens');
      return;
    }
    if (displayName.trim() === '') {
      setErrorMsg('Display name is required');
      return;
    }
    try {
      await onConfirm(trimmedId, displayName.trim(), bbox.trim() === '' ? null : bbox.trim());
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e));
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, width: '100%' }}>
        <h3 className="modal-title">Add mountain</h3>
        <p className="modal-body">Create a new mountain identifier and display name.</p>
        <label className="modal-label">
          Mountain ID
          <input className="modal-input" type="text" value={id} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} maxLength={80} />
          {errorMsg && <div style={{ color: 'var(--error, #d33)', marginTop: 6, fontSize: 13 }}>{errorMsg}</div>}
        </label>
        <label className="modal-label">
          Display name
          <input className="modal-input" type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)} onKeyDown={onKeyDown} maxLength={120} />
        </label>
        <label className="modal-label">
          BBox (minLon,minLat,maxLon,maxLat) — optional
          <input className="modal-input" type="text" value={bbox} onChange={(e) => setBbox(e.target.value)} onKeyDown={onKeyDown} />
        </label>

        <div style={{ marginTop: 8 }}>
          <small style={{ color: 'var(--text-3)' }}>Click "Draw bbox" then drag on the map to draw a rectangle.</small>
          <div style={{ marginTop: 8 }}>
            <BboxSelectorMap
              initialBbox={parseBbox(bbox.trim() === '' ? null : bbox.trim())}
              fitOnMount
              onBboxChange={(newBbox) => {
                if (!newBbox) {
                  setBbox('');
                  return;
                }
                const formatted = formatBbox(newBbox);
                setBbox(formatted);
              }}
            />
          </div>
        </div>
        <div className="modal-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12, position: 'relative' }}>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={handleCreate}
            disabled={!idValid || id.trim() === '' || displayName.trim() === '' || creating}
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

