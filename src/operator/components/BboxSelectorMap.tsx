import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import { Stroke, Fill, Style } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import 'ol/ol.css';

type MapViewState = {
  center: [number, number]; // lon, lat
  zoom: number;
  rotation: number;
};

type Props = {
  initialBbox?: [number, number, number, number] | null;
  onBboxChange?: (bbox: [number, number, number, number] | null) => void;
  height?: number | string;
  fitOnMount?: boolean;
  allowExpand?: boolean;
  initialViewState?: MapViewState | null;
};

// Center of South Korea (lon, lat)
const DEFAULT_CENTER: [number, number] = [127.7669, 35.9078];

export function BboxSelectorMap({ initialBbox = null, onBboxChange, height = 220, fitOnMount = false, allowExpand = true, initialViewState = null }: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const bboxLayerRef = useRef<VectorLayer<VectorSource> | null>(null); // persistent confirmed bbox
  const mountFittedRef = useRef(false);
  const tempLayerRef = useRef<VectorLayer<VectorSource> | null>(null); // temp drawing
  const tempFeatureRef = useRef<Feature | null>(null);
  const drawingModeRef = useRef(false);
  const isDrawingRef = useRef(false);
  const startCoordRef = useRef<[number, number] | null>(null);
  const pendingBboxRef = useRef<[number, number, number, number] | null>(null);
  const [drawingMode, setDrawingMode] = useState(false);
  const [pendingBbox, setPendingBbox] = useState<[number, number, number, number] | null>(null);
  const onBboxChangeRef = useRef<((bbox: [number, number, number, number] | null) => void) | undefined>(onBboxChange);
  const [expanded, setExpanded] = useState(false);
  const [expandedViewState, setExpandedViewState] = useState<MapViewState | null>(null);
  // editing via Modify interaction removed — keep map a simple bbox drawer
  // removed separate handle layer; Modify interaction will show vertices
  const prevInteractionsRef = useRef<Array<{ interaction: any; active: boolean }>>([]);
  const spaceDownRef = useRef(false);
  const spaceStateRef = useRef<{ drawingWasOn: boolean }>({ drawingWasOn: false });
  const mouseDownRef = useRef(false);

  const bindRef = useCallback((el: HTMLDivElement | null) => {
    mapEl.current = el;
  }, []);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const tile = new TileLayer({ source: new OSM() });
    const map = new Map({
      target: mapEl.current,
      layers: [tile],
      view: new View({
        center: initialViewState?.center ? fromLonLat(initialViewState.center) : fromLonLat(DEFAULT_CENTER),
        zoom: initialViewState?.zoom ?? 6.5,
        rotation: initialViewState?.rotation ?? 0,
      }),
    });
    mapRef.current = map;

    // Drawing handlers: use viewport pointer events and convert to map coordinates
    const handlePointerDown = (event: any) => {
      if (!drawingModeRef.current) return;
      const viewCoord = map.getEventCoordinate(event);
      if (!viewCoord) return;
      const coord = toLonLat(viewCoord) as [number, number];
      isDrawingRef.current = true;
      startCoordRef.current = coord;
      // create temp feature
      const poly = new Polygon([[fromLonLat(coord), fromLonLat(coord), fromLonLat(coord), fromLonLat(coord), fromLonLat(coord)]]);
      const feat = new Feature(poly);
      tempFeatureRef.current = feat;
      if (tempLayerRef.current) {
        map.removeLayer(tempLayerRef.current);
        tempLayerRef.current = null;
      }
      const layer = new VectorLayer({ source: new VectorSource({ features: [feat] }), style: new Style({ stroke: new Stroke({ color: 'rgba(40,116,240,0.9)', width: 2, lineDash: [6, 6] }), fill: new Fill({ color: 'rgba(40,116,240,0.12)' }) }) });
      tempLayerRef.current = layer;
      map.addLayer(layer);
    };

    const handlePointerMove = (event: any) => {
      // cursor handling: when NOT in drawing mode (including while holding space),
      // show the panning cursor to indicate pan is active. When drawing mode is active,
      // show a crosshair to indicate drawing.
      try {
        const el = map.getTargetElement();
          if (el) {
            if (!drawingModeRef.current || spaceDownRef.current) {
              // show pan cursor; if mouse is pressed show 'grabbing'
              el.style.cursor = mouseDownRef.current ? 'grabbing' : 'grab';
            } else {
              // drawing mode: show crosshair; if mouse is pressed keep 'grabbing'
              el.style.cursor = mouseDownRef.current ? 'grabbing' : 'crosshair';
            }
          }
      } catch {
        // ignore
      }

      // Only update drawing geometry if a draw is in progress
      if (!isDrawingRef.current || !startCoordRef.current || !tempFeatureRef.current) return;
      const viewCoord = map.getEventCoordinate(event);
      if (!viewCoord) return;
      const coord = toLonLat(viewCoord) as [number, number];
      const p1 = startCoordRef.current;
      const p2 = coord;
      const minLon = Math.min(p1[0], p2[0]);
      const minLat = Math.min(p1[1], p2[1]);
      const maxLon = Math.max(p1[0], p2[0]);
      const maxLat = Math.max(p1[1], p2[1]);
      const polyCoords = [
        fromLonLat([minLon, minLat]),
        fromLonLat([minLon, maxLat]),
        fromLonLat([maxLon, maxLat]),
        fromLonLat([maxLon, minLat]),
        fromLonLat([minLon, minLat]),
      ];
      (tempFeatureRef.current.getGeometry() as Polygon).setCoordinates([polyCoords]);
    };

    const handlePointerLeave = () => {
      try {
        const el = map.getTargetElement();
        if (el) el.style.cursor = '';
      } catch {}
    };

    const handlePointerUp = (event: any) => {
      if (!isDrawingRef.current || !startCoordRef.current) return;
      const viewCoord = map.getEventCoordinate(event);
      if (!viewCoord) return;
      const coord = toLonLat(viewCoord) as [number, number];
      const p1 = startCoordRef.current;
      const p2 = coord;
      const minLon = Math.min(p1[0], p2[0]);
      const minLat = Math.min(p1[1], p2[1]);
      const maxLon = Math.max(p1[0], p2[0]);
      const maxLat = Math.max(p1[1], p2[1]);
      const bbox: [number, number, number, number] = [minLon, minLat, maxLon, maxLat];
      pendingBboxRef.current = bbox;
      setPendingBbox(bbox);
      // stop drawing
      isDrawingRef.current = false;
      startCoordRef.current = null;
      // leave tempLayer for confirmation
          // leave tempLayer for confirmation
    };

    const viewport = map.getViewport();
    // attach DOM pointer listeners to the viewport so we can read client coords
    viewport.addEventListener('pointerdown', handlePointerDown as EventListener);
    viewport.addEventListener('pointermove', handlePointerMove as EventListener);
    viewport.addEventListener('pointerup', handlePointerUp as EventListener);
    viewport.addEventListener('pointerleave', handlePointerLeave as EventListener);
    // viewport pointer events for cursor grabbing feedback
    const vpPointerDown = () => {
      try {
        mouseDownRef.current = true;
        const el = map.getTargetElement();
        if (!el) return;
        if (!drawingModeRef.current || spaceDownRef.current) el.style.cursor = 'grabbing';
      } catch {}
    };
    const vpPointerUp = () => {
      try {
        mouseDownRef.current = false;
        const el = map.getTargetElement();
        if (!el) return;
        if (!drawingModeRef.current || spaceDownRef.current) el.style.cursor = 'grab';
        else el.style.cursor = 'crosshair';
      } catch {}
    };
    viewport.addEventListener('pointerdown', vpPointerDown as EventListener);
    viewport.addEventListener('pointerup', vpPointerUp as EventListener);

    return () => {
      try {
        const vp = map.getViewport();
        vp.removeEventListener('pointerdown', handlePointerDown as EventListener);
        vp.removeEventListener('pointermove', handlePointerMove as EventListener);
        vp.removeEventListener('pointerup', handlePointerUp as EventListener);
        vp.removeEventListener('pointerleave', handlePointerLeave as EventListener);
        try { vp.removeEventListener('pointerdown', vpPointerDown as EventListener); vp.removeEventListener('pointerup', vpPointerUp as EventListener); } catch {}
      } catch {
        // ignore
      }
      map.setTarget(undefined);
      mapRef.current = null;
      bboxLayerRef.current = null;
      tempLayerRef.current = null;
      tempFeatureRef.current = null;
    };
  }, []);

  // Keep the latest onBboxChange handler in a ref so we don't have to
  // re-create the OpenLayers map when the parent passes a new function
  // identity on each render (which caused reinitialization on input).
  useEffect(() => { onBboxChangeRef.current = onBboxChange; }, [onBboxChange]);

  // control helpers
  const toggleDrawing = () => {
    const map = mapRef.current;
    const enabling = !drawingModeRef.current;
    drawingModeRef.current = enabling;
    setDrawingMode(enabling);
    // when enabling draw mode, disable map interactions (pan/zoom) so drag draws rectangle
    if (map) {
      if (enabling) {
        // disable pan/drag/pinch interactions but keep wheel zoom active
        prevInteractionsRef.current = [];
        map.getInteractions().forEach((it: any) => {
          try {
            const name = it?.constructor?.name ?? '';
            const active = typeof it.getActive === 'function' ? it.getActive() : true;
            if (/DragPan|DragRotate|Pointer|DragBox|PointerDrag|PinchZoom/i.test(name)) {
              prevInteractionsRef.current.push({ interaction: it, active });
              if (typeof it.setActive === 'function') it.setActive(false);
            }
          } catch (e) {
            // ignore
          }
        });
      } else {
        // restore only those we changed
        for (const entry of prevInteractionsRef.current) {
          try { if (typeof entry.interaction.setActive === 'function') entry.interaction.setActive(entry.active); } catch {}
        }
        prevInteractionsRef.current = [];
      }
    }
    // clear any pending temp when toggling off
    if (!drawingModeRef.current && tempLayerRef.current) {
      const map = mapRef.current;
      if (map && tempLayerRef.current) {
        map.removeLayer(tempLayerRef.current);
        tempLayerRef.current = null;
        tempFeatureRef.current = null;
      }
      setPendingBbox(null);
      pendingBboxRef.current = null;
    }
  };

  // allow holding spacebar to temporarily behave like normal mode while draw mode is active
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      if (spaceDownRef.current) return;
      spaceDownRef.current = true;
      if (!drawingModeRef.current) return;
      const map = mapRef.current;
      if (!map) return;
      // remember previous draw state
      spaceStateRef.current.drawingWasOn = drawingModeRef.current;
      // temporarily disable drawing so space acts like normal/pan mode
      drawingModeRef.current = false;
      setDrawingMode(false);
      // enable pan/drag interactions we previously disabled
      for (const entry of prevInteractionsRef.current) {
        const it = entry.interaction;
        try { if (typeof it.setActive === 'function') it.setActive(true); } catch {}
      }
      // immediately update cursor to indicate pan mode
      try { const el = map.getTargetElement(); if (el) el.style.cursor = 'grab'; } catch {}
      e.preventDefault();
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      spaceDownRef.current = false;
      // only restore if we previously changed state
      if (!spaceStateRef.current.drawingWasOn) return;
      const map = mapRef.current;
      if (!map) return;
      // restore drawing mode
      drawingModeRef.current = true;
      setDrawingMode(true);
      // re-disable pan/drag interactions now that drawing mode is active again
      for (const entry of prevInteractionsRef.current) {
        const it = entry.interaction;
        try { if (typeof it.setActive === 'function') it.setActive(false); } catch {}
      }
      // restore cursor to drawing indicator
      try { const el = map.getTargetElement(); if (el) el.style.cursor = 'crosshair'; } catch {}
      // clear remembered state
      spaceStateRef.current.drawingWasOn = false;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  const confirmPending = () => {
    const map = mapRef.current;
    const bbox = pendingBboxRef.current;
    if (!map || !bbox) return;
    // create permanent layer
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const poly = new Polygon([
      [
        fromLonLat([minLon, minLat]),
        fromLonLat([minLon, maxLat]),
        fromLonLat([maxLon, maxLat]),
        fromLonLat([maxLon, minLat]),
        fromLonLat([minLon, minLat]),
      ],
    ]);
    const feat = new Feature(poly);
    if (bboxLayerRef.current) map.removeLayer(bboxLayerRef.current);
    const layer = new VectorLayer({ source: new VectorSource({ features: [feat] }), style: new Style({ stroke: new Stroke({ color: 'rgba(40,116,240,0.9)', width: 2 }), fill: new Fill({ color: 'rgba(40,116,240,0.12)' }) }) });
    bboxLayerRef.current = layer;
    map.addLayer(layer);
    // no edit interaction: bbox is a simple confirmed polygon on the map
    // remove temp
    if (tempLayerRef.current) { map.removeLayer(tempLayerRef.current); tempLayerRef.current = null; tempFeatureRef.current = null; }
    onBboxChangeRef.current?.(bbox);
    pendingBboxRef.current = null;
    setPendingBbox(null);
    // exit drawing mode
    drawingModeRef.current = false;
    setDrawingMode(false);
    // restore any interactions we previously disabled when entering draw mode
    for (const entry of prevInteractionsRef.current) {
      try { if (typeof entry.interaction.setActive === 'function') entry.interaction.setActive(entry.active); } catch {}
    }
    prevInteractionsRef.current = [];
  };

  const cancelPending = () => {
    const map = mapRef.current;
    if (map && tempLayerRef.current) {
      map.removeLayer(tempLayerRef.current);
      tempLayerRef.current = null;
      tempFeatureRef.current = null;
    }
    pendingBboxRef.current = null;
    setPendingBbox(null);
  };


  const clearBbox = () => {
    const map = mapRef.current;
    if (map && bboxLayerRef.current) {
      map.removeLayer(bboxLayerRef.current);
      bboxLayerRef.current = null;
    }
    // also clear temp
    if (map && tempLayerRef.current) {
      map.removeLayer(tempLayerRef.current);
      tempLayerRef.current = null;
      tempFeatureRef.current = null;
    }
    pendingBboxRef.current = null;
    setPendingBbox(null);
    onBboxChangeRef.current?.(null);
  };

  // edit helpers removed: editing on-map is not supported

  // reflect external initialBbox
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!initialBbox) {
      if (bboxLayerRef.current) {
        map.removeLayer(bboxLayerRef.current);
        bboxLayerRef.current = null;
      }
      return;
    }
    const [minLon, minLat, maxLon, maxLat] = initialBbox;
    const poly = new Polygon([[
      fromLonLat([minLon, minLat]),
      fromLonLat([minLon, maxLat]),
      fromLonLat([maxLon, maxLat]),
      fromLonLat([maxLon, minLat]),
      fromLonLat([minLon, minLat]),
    ]]);
    const feat = new Feature(poly);
    if (bboxLayerRef.current) map.removeLayer(bboxLayerRef.current);
    const layer = new VectorLayer({ source: new VectorSource({ features: [feat] }) });
    bboxLayerRef.current = layer;
    map.addLayer(layer);
    // optionally fit view on first mount when requested (modal wants initial fit)
    if (fitOnMount && !mountFittedRef.current) {
      try {
        const extent = layer.getSource()?.getExtent();
        if (extent) map.getView().fit(extent, { padding: [12, 12, 12, 12], maxZoom: 12 });
        mountFittedRef.current = true;
      } catch {
        // ignore
      }
    }
  }, [initialBbox]);

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <div ref={bindRef} style={{ width: '100%', height }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className={drawingMode ? 'btn btn-primary' : 'btn btn-ghost'} onClick={toggleDrawing}>
          {drawingMode ? 'Drawing: On' : 'Draw bbox'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={clearBbox}>Clear bbox</button>
        {/* inline editing removed — keep controls minimal */}
          <div style={{ flex: 1 }} />
          {allowExpand && (
            <button
              aria-label="Open full map"
              className="btn btn-ghost"
              onClick={() => {
                // capture current view (lon/lat) and pass to expanded map
                try {
                  const view = mapRef.current?.getView();
                  if (view) {
                    const center = view.getCenter();
                    const zoom = view.getZoom() ?? 6.5;
                    const rotation = view.getRotation() ?? 0;
                    const lonlat = center ? toLonLat(center as [number, number]) as [number, number] : DEFAULT_CENTER;
                    setExpandedViewState({ center: lonlat, zoom, rotation });
                  } else {
                    setExpandedViewState(null);
                  }
                } catch {
                  setExpandedViewState(null);
                }
                setExpanded(true);
              }}
              title="Open full map"
              type="button"
            >
              <Maximize2 aria-hidden="true" size={17} strokeWidth={2.2} />
            </button>
          )}
        {pendingBbox ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={cancelPending}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={confirmPending}>Confirm bbox</button>
          </div>
        ) : (
          <small style={{ color: 'var(--text-3)' }}>{drawingMode ? 'Drag on the map to draw a rectangle' : 'Click "Draw bbox" then drag to draw'}</small>
        )}
        </div>
      </div>

      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal map-modal" onClick={(event) => event.stopPropagation()}>
            <div className="map-modal-header">
              <h3 className="modal-title">BBox editor</h3>
              <button className="btn btn-ghost" onClick={() => setExpanded(false)} type="button">
                <X aria-hidden="true" size={15} strokeWidth={2} />
                Close
              </button>
            </div>
            <BboxSelectorMap
              allowExpand={false}
              initialBbox={initialBbox}
              fitOnMount={false}
              initialViewState={expandedViewState}
              onBboxChange={(bbox) => {
                onBboxChange?.(bbox);
              }}
              height={'60vh'}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default BboxSelectorMap;

