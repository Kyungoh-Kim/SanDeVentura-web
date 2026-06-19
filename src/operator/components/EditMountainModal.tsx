import React, { useEffect, useState } from 'react';
import BboxSelectorMap from './BboxSelectorMap';
import { parseBbox, formatBbox } from '../data/mountainsRepository';

export default function EditMountainModal({
  id,
  initialDisplayName,
  initialBbox,
  onConfirm,
  onCancel,
  saving,
}: {
  id: string;
  initialDisplayName: string;
  initialBbox: string | null;
  onConfirm: (displayName: string, bbox: string | null) => Promise<void>;
  onCancel: () => void;
  saving: boolean;
}) {
  const [displayName, setDisplayName] = useState('');
  const [bbox, setBbox] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Initialize internal fields when modal opens or props change
  useEffect(() => {
    setDisplayName(initialDisplayName ?? '');
    setBbox(initialBbox ?? '');
  }, [id, initialDisplayName, initialBbox]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && displayName.trim() !== '') handleSave();
    if (e.key === 'Escape') onCancel();
  }

  async function handleSave() {
    setErrorMsg(null);
    if (displayName.trim() === '') {
      setErrorMsg('Display name is required');
      return;
    }

    if (bbox.trim() !== '') {
      try {
        const parsed = parseBbox(bbox.trim());
        if (!parsed) {
          setErrorMsg('BBox is invalid');
          return;
        }
      } catch (e: any) {
        setErrorMsg(e?.message ?? String(e));
        return;
      }
    }

    try {
      await onConfirm(displayName.trim(), bbox.trim() === '' ? null : bbox.trim());
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
        <h3 className="modal-title">Edit mountain</h3>
        <p className="modal-body">Edit the mountain display name and optional bbox. ID is read-only.</p>

        <label className="modal-label">
          Mountain ID
          <input className="modal-input" type="text" value={id} disabled />
        </label>

        <label className="modal-label">
          Display name
          <input
            className="modal-input"
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            onKeyDown={onKeyDown}
            maxLength={120}
          />
        </label>

        <label className="modal-label">
          BBox (minLon,minLat,maxLon,maxLat) — optional
          <input
            className="modal-input"
            type="text"
            value={bbox}
            onChange={(e) => setBbox(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>

        {errorMsg && <div style={{ color: 'var(--error, #d33)', marginTop: 6, fontSize: 13 }}>{errorMsg}</div>}

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
            onClick={handleSave}
            disabled={displayName.trim() === '' || saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

