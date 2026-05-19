import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import Feature from 'ol/Feature';
import type { FeatureLike } from 'ol/Feature';
import Map from 'ol/Map';
import View from 'ol/View';
import LineString from 'ol/geom/LineString';
import Point from 'ol/geom/Point';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat, transformExtent } from 'ol/proj';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style';
import 'ol/ol.css';

import type { GeoJsonLineString, RouteState } from '../data/readModels';

type RouteOverlay = {
  geometry: GeoJsonLineString;
  id?: string;
  label?: string;
  routeState: RouteState;
  promotionReady?: boolean;
  selected?: boolean;
  selectable?: boolean;
  debugOnly?: boolean;
  debugKind?: 'trail-edge' | 'attach-start' | 'attach-end';
};

type OperatorRouteMapProps = {
  geometry: GeoJsonLineString | null;
  routeState: RouteState;
  bbox?: [number, number, number, number] | null;
  routes?: RouteOverlay[];
  title?: string;
  allowExpand?: boolean;
  discoveryMode?: boolean;
  initialViewState?: MapViewState | null;
  initialLayer?: RouteMapLayerId;
  preserveViewOnRoutesChange?: boolean;
  preserveExpandedViewLocally?: boolean;
  onOverlayClick?: (overlayId: string, viewState: MapViewState | null) => void;
};

const routeColors: Record<RouteState, string> = {
  recommended: '#1f8f5f',
  reference: '#c27a00',
  none: '#7a8691',
};

type RouteMapLayerId = 'map' | 'satellite';

type MapViewState = {
  center: [number, number];
  zoom: number;
  rotation: number;
};

const mapLayers: Record<
  RouteMapLayerId,
  { label: string; attribution: string; maxZoom: number; createSource: () => OSM | XYZ }
> = {
  map: {
    label: 'Map',
    attribution: 'OpenStreetMap contributors',
    maxZoom: 19,
    createSource: () => new OSM({ maxZoom: 19 }),
  },
  satellite: {
    label: 'Satellite',
    attribution: 'Esri World Imagery',
    maxZoom: 19,
    createSource: () =>
      new XYZ({
        attributions: 'Esri World Imagery',
        maxZoom: 19,
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      }),
  },
};

export function OperatorRouteMap({
  geometry,
  routeState,
  bbox,
  routes,
  title = 'Map preview',
  allowExpand = true,
  discoveryMode = false,
  initialViewState = null,
  initialLayer = 'map',
  preserveViewOnRoutesChange = false,
  preserveExpandedViewLocally = false,
  onOverlayClick,
}: OperatorRouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const [mapElement, setMapElement] = useState<HTMLDivElement | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<RouteMapLayerId>(initialLayer);
  const [expanded, setExpanded] = useState(false);
  const layerConfig = mapLayers[selectedLayer];
  const tileLayerRef = useRef<TileLayer<OSM | XYZ> | null>(null);
  const mapRef = useRef<Map | null>(null);
  const dynamicLayersRef = useRef<VectorLayer<VectorSource>[]>([]);
  const hoverSourceRef = useRef<VectorSource | null>(null);
  const discoveryModeRef = useRef(discoveryMode);
  const onOverlayClickRef = useRef(onOverlayClick);
  const viewStateRef = useRef<MapViewState | null>(initialViewState);
  const [hoveredOverlay, setHoveredOverlay] = useState<RouteOverlay | null>(null);
  const hasSelectedOverlay = routes?.some((route) => route.selected) ?? false;
  const hasPromotionReadyOverlay =
    !hasSelectedOverlay && (routes?.some((route) => route.promotionReady) ?? false);

  useEffect(() => {
    setSelectedLayer(initialLayer);
  }, [initialLayer]);

  function chooseLayer(layer: RouteMapLayerId) {
    setSelectedLayer(layer);
  }

  const bindMapElement = useCallback((element: HTMLDivElement | null) => {
    mapElementRef.current = element;
    setMapElement(element);
  }, []);

  useEffect(() => {
    discoveryModeRef.current = discoveryMode;
    onOverlayClickRef.current = onOverlayClick;
  }, [discoveryMode, onOverlayClick]);

  useEffect(() => {
    if (!mapElement || mapRef.current) return undefined;
    const tileLayer = new TileLayer({ source: mapLayers[selectedLayer].createSource() });
    tileLayerRef.current = tileLayer;

    const map = new Map({
      layers: [tileLayer],
      target: mapElement,
      view: new View({
        center: initialViewState?.center ?? [0, 0],
        zoom: initialViewState?.zoom ?? 2,
        rotation: initialViewState?.rotation ?? 0,
        maxZoom: mapLayers[selectedLayer].maxZoom,
      }),
    });
    mapRef.current = map;
    const hoverSource = new VectorSource();
    hoverSourceRef.current = hoverSource;
    const hoverLayer = new VectorLayer({
      source: hoverSource,
      style: hoverStyle,
      zIndex: 9,
    });
    map.addLayer(hoverLayer);

    const handlePointerMove = (event: any) => {
      const hit = map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature.get('hoverable') ? feature : undefined,
        { hitTolerance: 8 },
      );

      hoverSource.clear();
      map.getTargetElement().style.cursor = hit ? 'pointer' : '';

      if (!hit) {
        setHoveredOverlay(null);
        return;
      }

      const route = hit.get('route') as RouteOverlay;
      const overlayId = hit.get('overlayId') as string;
      const overlayLabel = hit.get('overlayLabel') as string;
      const hoverLine = lineFeature(route.geometry);
      hoverLine.setProperties({ hoverKind: 'edge' });
      hoverSource.addFeature(hoverLine);

      if (discoveryModeRef.current) {
        hoverSource.addFeatures(edgeDebugNodeFeatures(route.geometry, overlayId));
      }
      setHoveredOverlay({ ...route, id: overlayId, label: overlayLabel });
    };

    const handleSingleClick = (event: any) => {
      const hit = map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature.get('selectableClickTarget') ? feature : undefined,
        { hitTolerance: 4 },
      );
      if (!hit) return;
      const route = hit.get('route') as RouteOverlay | undefined;
      const overlayId = hit.get('overlayId') as string | undefined;
      if (!route?.selectable || !overlayId) return;
      const clickedViewState = readMapViewState(map);
      viewStateRef.current = clickedViewState;
      onOverlayClickRef.current?.(overlayId, clickedViewState);
    };

    const handleMoveEnd = () => {
      viewStateRef.current = readMapViewState(map);
    };

    map.on('pointermove', handlePointerMove);
    map.on('singleclick', handleSingleClick);
    map.on('moveend', handleMoveEnd);
    window.requestAnimationFrame(() => map.updateSize());
    handleMoveEnd();

    return () => {
      map.un('pointermove', handlePointerMove);
      map.un('singleclick', handleSingleClick);
      map.un('moveend', handleMoveEnd);
      map.setTarget(undefined);
      tileLayerRef.current = null;
      mapRef.current = null;
      hoverSourceRef.current = null;
      dynamicLayersRef.current = [];
      setHoveredOverlay(null);
    };
  }, [mapElement]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const hasRoutes = (routes?.length ?? 0) > 0;
    if (geometry === null && !bbox && !hasRoutes) return;
    const preservedViewState = preserveViewOnRoutesChange ? viewStateRef.current : null;
    const startingViewState = preserveExpandedViewLocally
      ? preservedViewState ?? initialViewState
      : initialViewState ?? preservedViewState;

    for (const layer of dynamicLayersRef.current) {
      map.removeLayer(layer);
    }
    dynamicLayersRef.current = [];
    hoverSourceRef.current?.clear();
    setHoveredOverlay(null);

    let extentFitSource: VectorSource | null = null;

    const addDynamicLayer = (layer: VectorLayer<VectorSource>) => {
      dynamicLayersRef.current.push(layer);
      map.addLayer(layer);
    };

    if (hasRoutes) {
      const allFeatures: Feature<LineString>[] = [];
      const selectedFitFeatures: Feature<LineString>[] = [];
      const selectableClickFeatures: Feature<LineString>[] = [];
      for (const [routeIndex, route] of routes!.entries()) {
        if (route.debugOnly && !discoveryMode) continue;
        const feature = lineFeature(route.geometry);
        const overlayId = route.id ?? `edge-${routeIndex + 1}`;
        feature.setProperties({
          hoverable: shouldEnableHover(route, discoveryMode),
          overlayId,
          overlayLabel: route.label ?? route.id ?? `Edge ${routeIndex + 1}`,
          route,
        });
        allFeatures.push(feature);
        if (route.selected) selectedFitFeatures.push(feature);
        if (route.selectable) {
          const clickFeature = lineFeature(route.geometry);
          clickFeature.setProperties({
            overlayId,
            route,
            selectableClickTarget: true,
          });
          selectableClickFeatures.push(clickFeature);
        }
        if (discoveryMode && route.debugKind === 'attach-start') {
          const attachFeature = lineFeature(route.geometry);
          allFeatures.push(attachFeature);
          addDynamicLayer(new VectorLayer({
            source: new VectorSource({ features: [attachFeature] }),
            style: attachHighlightStyle('#16a34a'),
            zIndex: 7,
          }));
        } else if (discoveryMode && route.debugKind === 'attach-end') {
          const attachFeature = lineFeature(route.geometry);
          allFeatures.push(attachFeature);
          addDynamicLayer(new VectorLayer({
            source: new VectorSource({ features: [attachFeature] }),
            style: attachHighlightStyle('#dc2626'),
            zIndex: 7,
          }));
        } else if (route.selected) {
          const selectedFeature = lineFeature(route.geometry);
          allFeatures.push(selectedFeature);
          addDynamicLayer(new VectorLayer({
            source: new VectorSource({ features: [selectedFeature] }),
            style: selectedHighlightStyle(),
            zIndex: 5,
          }));
        } else if (route.promotionReady && !hasSelectedOverlay) {
          const highlightFeature = lineFeature(route.geometry);
          allFeatures.push(highlightFeature);
          addDynamicLayer(new VectorLayer({
            source: new VectorSource({ features: [highlightFeature] }),
            style: promotionReadyHighlightStyle(),
            zIndex: 3,
          }));
        }
        addDynamicLayer(new VectorLayer({
          source: new VectorSource({ features: [feature] }),
          style: route.debugOnly
            ? debugTrailEdgeStyle()
            : route.selectable
              ? candidateRouteStyle(route.routeState)
              : routeStyle(route.routeState),
          zIndex: route.debugOnly ? 1 : route.selected ? 6 : route.promotionReady ? 4 : 2,
        }));
      }
      if (selectableClickFeatures.length > 0) {
        addDynamicLayer(new VectorLayer({
          source: new VectorSource({ features: selectableClickFeatures }),
          style: selectableClickTargetStyle(),
          zIndex: 8,
        }));
      }
      if (!bbox) {
        extentFitSource = new VectorSource({
          features: selectedFitFeatures.length > 0 ? selectedFitFeatures : allFeatures,
        });
      }
    } else if (geometry !== null) {
      const feature = lineFeature(geometry);
      feature.setProperties({
        hoverable: true,
        overlayId: title,
        overlayLabel: title,
        route: { geometry, id: title, label: title, routeState },
      });
      const source = new VectorSource({ features: [feature] });
      addDynamicLayer(new VectorLayer({
        source,
        style: routeStyle(routeState),
        zIndex: 2,
      }));
      if (!bbox) extentFitSource = source;
    }

    if (startingViewState) {
      const view = map.getView();
      view.setCenter(startingViewState.center);
      view.setZoom(Math.min(startingViewState.zoom, layerConfig.maxZoom));
      view.setRotation(startingViewState.rotation);
    } else if (bbox) {
      const extent = transformExtent(
        [bbox[0], bbox[1], bbox[2], bbox[3]],
        'EPSG:4326',
        'EPSG:3857',
      );
      map.getView().fit(extent, { padding: [24, 24, 24, 24], maxZoom: 15 });
    } else if (extentFitSource) {
      const extent = extentFitSource.getExtent();
      if (extent) {
        map.getView().fit(extent, {
          padding: hasSelectedOverlay ? [54, 54, 54, 54] : [32, 32, 32, 32],
          maxZoom: Math.min(layerConfig.maxZoom, hasSelectedOverlay ? 18 : 16),
        });
      }
    }

  }, [
    geometry,
    bbox,
    mapElement,
    routes,
    routeState,
    title,
    discoveryMode,
    initialViewState,
    preserveExpandedViewLocally,
    preserveViewOnRoutesChange,
  ]);

  useEffect(() => {
    tileLayerRef.current?.setSource(mapLayers[selectedLayer].createSource());
    mapRef.current?.getView().setMaxZoom(mapLayers[selectedLayer].maxZoom);
  }, [selectedLayer]);

  if (geometry === null && !bbox && !(routes?.length)) {
    return (
      <div className="route-map-empty">
        <strong>No route geometry</strong>
        <span>Run aggregation after accepted traces are available.</span>
      </div>
    );
  }

  const map = (
    <div className="route-map-frame">
      <div aria-label="Operator route map" className="route-map-shell">
        <div className="route-map" ref={bindMapElement} />
        {hasPromotionReadyOverlay && (
          <div className="map-promotion-legend">
            <span className="map-promotion-line" />
            <span>Promotion ready</span>
          </div>
        )}
        {hasSelectedOverlay && (
          <div className="map-selected-legend">
            <span className="map-selected-line" />
            <span>Selected candidate</span>
          </div>
        )}
        {hoveredOverlay && (
          <div className="map-hover-badge">
            <strong>{hoveredOverlay.label ?? hoveredOverlay.id ?? 'Edge'}</strong>
            {discoveryMode && hoveredOverlay.id && (
              <span>ID: {hoveredOverlay.id}</span>
            )}
            <span>
              {discoveryMode
                ? 'Discovery mode - start and end markers shown'
                : 'Edge hover'}
            </span>
          </div>
        )}
        <div aria-label="Route map layer" className="map-layer-switch" role="group">
          {Object.entries(mapLayers).map(([id, config]) => (
            <button
              aria-pressed={selectedLayer === id}
              className={selectedLayer === id ? 'active' : undefined}
              key={id}
              onClick={() => chooseLayer(id as RouteMapLayerId)}
              type="button"
            >
              {config.label}
            </button>
          ))}
        </div>
        {allowExpand && (
          <button
            aria-label="Open full map"
            className="map-expand-button"
            onClick={() => setExpanded(true)}
            title="Open full map"
            type="button"
          >
            <Maximize2 aria-hidden="true" size={17} strokeWidth={2.2} />
          </button>
        )}
        <span className="map-attribution">{layerConfig.attribution}</span>
      </div>
    </div>
  );

  return (
    <>
      {map}
      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal map-modal" onClick={(event) => event.stopPropagation()}>
            <div className="map-modal-header">
              <h3 className="modal-title">{title}</h3>
              <button className="btn btn-ghost" onClick={() => setExpanded(false)} type="button">
                <X aria-hidden="true" size={15} strokeWidth={2} />
                Close
              </button>
            </div>
            <OperatorRouteMap
              allowExpand={false}
              bbox={bbox}
              geometry={geometry}
              initialLayer={selectedLayer}
              initialViewState={initialViewState ?? viewStateRef.current}
              onOverlayClick={(overlayId, viewState) => {
                onOverlayClick?.(overlayId, preserveExpandedViewLocally ? null : viewState);
              }}
              preserveExpandedViewLocally={preserveExpandedViewLocally}
              preserveViewOnRoutesChange
              routeState={routeState}
              routes={routes}
              title={title}
              discoveryMode={discoveryMode}
            />
          </div>
        </div>
      )}
    </>
  );
}

function lineFeature(geometry: GeoJsonLineString): Feature<LineString> {
  return new Feature(new LineString(geometry.coordinates.map(([lon, lat]) => fromLonLat([lon, lat]))));
}

function readMapViewState(map: Map): MapViewState | null {
  const view = map.getView();
  const center = view.getCenter();
  const zoom = view.getZoom();
  if (!center || zoom === undefined) return null;

  return {
    center: [center[0], center[1]],
    zoom,
    rotation: view.getRotation(),
  };
}

function edgeDebugNodeFeatures(geometry: GeoJsonLineString, edgeId: string): Feature<Point>[] {
  const features: Feature<Point>[] = [];
  const coordinates = geometry.coordinates;
  if (coordinates.length === 0) return features;

  for (let index = 1; index < coordinates.length - 1; index += 1) {
    features.push(nodeFeature(coordinates[index], `${edgeId}:node-${index + 1}`, 'node'));
  }

  features.push(nodeFeature(coordinates[0], `${edgeId}:start`, 'start'));
  if (coordinates.length > 1) {
    features.push(nodeFeature(coordinates[coordinates.length - 1], `${edgeId}:end`, 'end'));
  }

  return features;
}

function nodeFeature(
  [lon, lat]: [number, number],
  id: string,
  kind: 'node' | 'start' | 'end',
): Feature<Point> {
  const feature = new Feature(new Point(fromLonLat([lon, lat])));
  feature.setProperties({ hoverKind: kind, nodeId: id });
  return feature;
}

function routeStyle(routeState: RouteState): Style {
  return new Style({
    stroke: new Stroke({
      color: routeColors[routeState],
      lineCap: 'round',
      lineJoin: 'round',
      width: 3,
    }),
  });
}

function candidateRouteStyle(routeState: RouteState): Style {
  const colors: Record<RouteState, string> = {
    recommended: 'rgba(112, 157, 139, 0.82)',
    reference: 'rgba(190, 158, 100, 0.78)',
    none: 'rgba(143, 154, 151, 0.74)',
  };

  return new Style({
    stroke: new Stroke({
      color: colors[routeState],
      lineCap: 'round',
      lineJoin: 'round',
      width: 3,
    }),
  });
}

function shouldEnableHover(route: RouteOverlay, discoveryMode: boolean): boolean {
  if (!discoveryMode) return true;
  return route.selectable === true || route.debugOnly === true;
}

function promotionReadyHighlightStyle(): Style {
  return new Style({
    stroke: new Stroke({
      color: 'rgba(250, 204, 21, 0.92)',
      lineCap: 'round',
      lineJoin: 'round',
      width: 11,
    }),
  });
}

function selectedHighlightStyle(): Style {
  return new Style({
    stroke: new Stroke({
      color: 'rgba(250, 204, 21, 0.92)',
      lineCap: 'round',
      lineJoin: 'round',
      width: 10,
    }),
  });
}

function attachHighlightStyle(color: string): Style {
  return new Style({
    stroke: new Stroke({
      color,
      lineCap: 'round',
      lineJoin: 'round',
      width: 9,
    }),
  });
}

function debugTrailEdgeStyle(): Style {
  return new Style({
    stroke: new Stroke({
      color: 'rgba(15, 23, 42, 0.34)',
      lineCap: 'round',
      lineJoin: 'round',
      lineDash: [4, 5],
      width: 2,
    }),
  });
}

function selectableClickTargetStyle(): Style {
  return new Style({
    stroke: new Stroke({
      color: 'rgba(255, 255, 255, 0.01)',
      lineCap: 'round',
      lineJoin: 'round',
      width: 18,
    }),
  });
}

function hoverStyle(feature: FeatureLike): Style {
  if (feature.get('hoverKind') === 'start' || feature.get('hoverKind') === 'end') {
    const isStart = feature.get('hoverKind') === 'start';
    return new Style({
      image: new CircleStyle({
        radius: 6,
        fill: new Fill({ color: isStart ? '#16a34a' : '#dc2626' }),
        stroke: new Stroke({ color: '#ffffff', width: 2 }),
      }),
      text: new Text({
        text: isStart ? 'START' : 'END',
        offsetY: -17,
        padding: [3, 5, 3, 5],
        fill: new Fill({ color: '#0b1220' }),
        backgroundFill: new Fill({ color: 'rgba(255, 255, 255, 0.94)' }),
        backgroundStroke: new Stroke({ color: 'rgba(15, 23, 42, 0.18)', width: 1 }),
        font: '700 11px Inter, sans-serif',
      }),
    });
  }

  if (feature.get('hoverKind') === 'node') {
    return new Style({
      image: new CircleStyle({
        radius: 3,
        fill: new Fill({ color: '#ffffff' }),
        stroke: new Stroke({ color: '#50DF9C', width: 2.5 }),
      }),
    });
  }

  return new Style({
    stroke: new Stroke({
      color: 'rgba(80, 223, 156, 0.88)',
      lineCap: 'round',
      lineJoin: 'round',
      width: 8,
    }),
  });
}
