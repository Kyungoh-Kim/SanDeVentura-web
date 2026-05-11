import { useEffect, useRef, useState } from 'react';
import Feature from 'ol/Feature';
import Map from 'ol/Map';
import View from 'ol/View';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat, transformExtent } from 'ol/proj';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Fill, Stroke, Style } from 'ol/style';
import { cellToBoundary, latLngToCell } from 'h3-js';
import 'ol/ol.css';

import type { CandidateCell, GeoJsonLineString, RouteState } from '../data/readModels';

type RouteOverlay = { geometry: GeoJsonLineString; routeState: RouteState };

type OperatorRouteMapProps = {
  geometry: GeoJsonLineString | null;
  routeState: RouteState;
  bbox?: [number, number, number, number] | null;
  routes?: RouteOverlay[];
  cells?: CandidateCell[];
  title?: string;
  allowExpand?: boolean;
};

const routeColors: Record<RouteState, string> = {
  recommended: '#1f8f5f',
  reference: '#c27a00',
  none: '#7a8691',
};

type RouteMapLayerId = 'map' | 'satellite';

const mapLayers: Record<
  RouteMapLayerId,
  { label: string; attribution: string; createSource: () => OSM | XYZ }
> = {
  map: {
    label: 'Map',
    attribution: 'OpenStreetMap contributors',
    createSource: () => new OSM(),
  },
  satellite: {
    label: 'Satellite',
    attribution: 'Esri World Imagery',
    createSource: () =>
      new XYZ({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attributions: 'Esri World Imagery',
        maxZoom: 19,
      }),
  },
};

function zoomToH3Res(zoom: number): number {
  if (zoom < 9)  return 5;
  if (zoom < 10) return 6;
  if (zoom < 11) return 7;
  if (zoom < 12) return 8;
  if (zoom < 13) return 9;
  if (zoom < 14) return 10;
  return 11;
}


// Interpolate between reference orange (#c27a00) and recommended green (#1f8f5f)
function cellColor(t: number): [number, number, number] {
  return [
    Math.round(194 + (31  - 194) * t),
    Math.round(122 + (143 - 122) * t),
    Math.round(0   + (95  - 0)   * t),
  ];
}

function buildCellFeatures(cells: CandidateCell[], zoom: number): Feature<Polygon>[] {
  const res = zoomToH3Res(zoom);

  // Re-derive key at display resolution so cells aggregate correctly when zoomed out
  const aggregated: Record<string, number> = {};
  for (const cell of cells) {
    const key = latLngToCell(cell.lat, cell.lon, res);
    aggregated[key] = (aggregated[key] ?? 0) + cell.sessionCount;
  }

  const maxCount = Math.max(...Object.values(aggregated), 1);
  return Object.entries(aggregated).map(([key, count]) => {
    const boundary = cellToBoundary(key, true);
    const ring = boundary.map(([lon, lat]) => fromLonLat([lon, lat]));
    const feature = new Feature(new Polygon([ring]));
    const t = count / maxCount;
    const [r, g, b] = cellColor(t);
    const fillOpacity = 0.25 + 0.50 * t;
    feature.setStyle(new Style({
      fill: new Fill({ color: `rgba(${r},${g},${b},${fillOpacity.toFixed(2)})` }),
      stroke: new Stroke({ color: `rgba(${r},${g},${b},0.55)`, width: 1 }),
    }));
    return feature;
  });
}

export function OperatorRouteMap({
  geometry,
  routeState,
  bbox,
  routes,
  cells,
  title = 'Map preview',
  allowExpand = true,
}: OperatorRouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<RouteMapLayerId>('map');
  const [expanded, setExpanded] = useState(false);
  const layerConfig = mapLayers[selectedLayer];
  const tileLayerRef = useRef<TileLayer<OSM | XYZ> | null>(null);

  // ── Map creation — runs only when data changes, NOT on layer switch ──────────
  useEffect(() => {
    if (!mapElementRef.current) return undefined;
    const hasRoutes = (routes?.length ?? 0) > 0;
    const hasCells = (cells?.length ?? 0) > 0;
    if (geometry === null && !bbox && !hasRoutes && !hasCells) return undefined;

    const tileLayer = new TileLayer({ source: mapLayers['map'].createSource() });
    tileLayerRef.current = tileLayer;

    const view = new View({ center: [0, 0], zoom: 2 });
    const map = new Map({
      target: mapElementRef.current,
      layers: [tileLayer],
      view,
    });

    // Apply the currently selected layer immediately after creation
    tileLayer.setSource(mapLayers[selectedLayer].createSource());

    let extentFitSource: VectorSource | null = null;

    // ── Cell heatmap (z=1, below route lines) ────────────────────────────────
    let cellSource: VectorSource | null = null;
    if (hasCells) {
      cellSource = new VectorSource();
      map.addLayer(new VectorLayer({ source: cellSource, zIndex: 1 }));

      if (!bbox && !hasRoutes) {
        extentFitSource = new VectorSource({
          features: cells!.map((c) => new Feature(new Point(fromLonLat([c.lon, c.lat])))),
        });
      }
    }

    // ── Route lines (z=2, on top of heatmap) ─────────────────────────────────
    if (hasRoutes) {
      const allFeatures: Feature<LineString>[] = [];
      for (const route of routes!) {
        const coords = route.geometry.coordinates.map(([lon, lat]) => fromLonLat([lon, lat]));
        const line = new LineString(coords);
        const feature = new Feature(line);
        allFeatures.push(feature);
        map.addLayer(new VectorLayer({
          source: new VectorSource({ features: [feature] }),
          style: new Style({ stroke: new Stroke({ color: routeColors[route.routeState], width: 3 }) }),
          zIndex: 2,
        }));
      }
      if (!bbox) extentFitSource = new VectorSource({ features: allFeatures });
    } else if (geometry !== null) {
      const coordinates = geometry.coordinates.map(([lon, lat]) => fromLonLat([lon, lat]));
      const line = new LineString(coordinates);
      const feature = new Feature(line);
      const source = new VectorSource({ features: [feature] });
      map.addLayer(new VectorLayer({
        source,
        style: new Style({ stroke: new Stroke({ color: routeColors[routeState], width: 3 }) }),
        zIndex: 2,
      }));
      if (!bbox) extentFitSource = source;
    }

    // ── View fitting ──────────────────────────────────────────────────────────
    if (bbox) {
      const extent = transformExtent(
        [bbox[0], bbox[1], bbox[2], bbox[3]],
        'EPSG:4326',
        'EPSG:3857',
      );
      map.getView().fit(extent, { padding: [24, 24, 24, 24], maxZoom: 15 });
    } else if (extentFitSource) {
      const ext = extentFitSource.getExtent();
      if (ext) map.getView().fit(ext, { padding: [32, 32, 32, 32], maxZoom: 16 });
    }

    // ── Cell render + zoom-reactive re-render ─────────────────────────────────
    if (cellSource) {
      const renderCells = () => {
        const zoom = map.getView().getZoom() ?? 12;
        cellSource!.clear();
        cellSource!.addFeatures(buildCellFeatures(cells ?? [], zoom));
      };
      renderCells();
      map.on('moveend', renderCells);
    }

    return () => {
      map.setTarget(undefined);
      tileLayerRef.current = null;
    };
  }, [geometry, bbox, routes, cells, routeState]); // layerConfig 제외 — 별도 effect로 처리

  // ── Layer switch — tile source만 교체, 뷰 위치 유지 ──────────────────────────
  useEffect(() => {
    tileLayerRef.current?.setSource(layerConfig.createSource());
  }, [layerConfig]);

  if (geometry === null && !bbox && !(routes?.length) && !(cells?.length)) {
    return (
      <div className="route-map-empty">
        <strong>No route geometry</strong>
        <span>Recompute canonical trails after accepted traces are available.</span>
      </div>
    );
  }

  const map = (
    <div aria-label="Operator route map" className="route-map-shell">
      <div className="route-map" ref={mapElementRef} />
      {allowExpand && (
        <button
          className="map-expand-button"
          onClick={() => setExpanded(true)}
          title="Open full map"
          type="button"
        >
          ⛶
        </button>
      )}
      <div
        aria-label="Route map layer"
        className="map-layer-switch"
        role="group"
      >
        {Object.entries(mapLayers).map(([id, config]) => {
          return (
            <button
              aria-pressed={selectedLayer === id}
              className={selectedLayer === id ? 'active' : undefined}
              key={id}
              onClick={() => setSelectedLayer(id as RouteMapLayerId)}
              type="button"
            >
              {config.label}
            </button>
          );
        })}
      </div>
      <span className="map-attribution">{layerConfig.attribution}</span>
    </div>
  );

  return (
    <>
      {map}
      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal map-modal" onClick={(e) => e.stopPropagation()}>
            <div className="map-modal-header">
              <h3 className="modal-title">{title}</h3>
              <button
                className="btn btn-ghost"
                onClick={() => setExpanded(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <OperatorRouteMap
              allowExpand={false}
              bbox={bbox}
              cells={cells}
              geometry={geometry}
              routeState={routeState}
              routes={routes}
              title={title}
            />
          </div>
        </div>
      )}
    </>
  );
}
