import { useEffect, useRef, useState } from 'react';
import Feature from 'ol/Feature';
import Map from 'ol/Map';
import View from 'ol/View';
import LineString from 'ol/geom/LineString';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import { fromLonLat } from 'ol/proj';
import OSM from 'ol/source/OSM';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import { Stroke, Style } from 'ol/style';
import 'ol/ol.css';

import type { GeoJsonLineString, RouteState } from '../data/readModels';

type OperatorRouteMapProps = {
  geometry: GeoJsonLineString | null;
  routeState: RouteState;
};

const routeColors: Record<RouteState, string> = {
  recommended: '#1f8f5f',
  reference: '#c27a00',
  none: '#7a8691',
};

type RouteMapLayerId = 'map' | 'satellite';

const mapLayers: Record<
  RouteMapLayerId,
  {
    label: string;
    attribution: string;
    createSource: () => OSM | XYZ;
  }
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

export function OperatorRouteMap({ geometry, routeState }: OperatorRouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<RouteMapLayerId>('map');
  const layerConfig = mapLayers[selectedLayer];

  useEffect(() => {
    if (!mapElementRef.current || geometry === null) {
      return undefined;
    }

    const coordinates = geometry.coordinates.map(([lon, lat]) => fromLonLat([lon, lat]));
    const line = new LineString(coordinates);
    const routeFeature = new Feature({ geometry: line });
    const vectorSource = new VectorSource({ features: [routeFeature] });
    const vectorLayer = new VectorLayer({
      source: vectorSource,
      style: new Style({
        stroke: new Stroke({
          color: routeColors[routeState],
          width: 5,
        }),
      }),
    });

    const map = new Map({
      target: mapElementRef.current,
      layers: [
        new TileLayer({ source: layerConfig.createSource() }),
        vectorLayer,
      ],
      view: new View({
        center: coordinates[0],
        zoom: 15,
      }),
    });
    map.getView().fit(line.getExtent(), {
      padding: [32, 32, 32, 32],
      maxZoom: 16,
    });

    return () => {
      map.setTarget(undefined);
    };
  }, [geometry, layerConfig, routeState]);

  if (geometry === null) {
    return (
      <div className="route-map-empty">
        <strong>No route geometry</strong>
        <span>Recompute canonical trails after accepted traces are available.</span>
      </div>
    );
  }

  return (
    <div aria-label="Operator route map" className="route-map-shell">
      <div className="route-map" ref={mapElementRef} />
      <div aria-label="Route map layer" className="map-layer-switch" role="group">
        {Object.entries(mapLayers).map(([id, config]) => (
          <button
            aria-pressed={selectedLayer === id}
            className={selectedLayer === id ? 'active' : undefined}
            key={id}
            onClick={() => setSelectedLayer(id as RouteMapLayerId)}
            type="button"
          >
            {config.label}
          </button>
        ))}
      </div>
      <span className="map-attribution">{layerConfig.attribution}</span>
    </div>
  );
}
