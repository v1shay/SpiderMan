'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Map as MapIcon, Volume2, X } from 'lucide-react';
import type { Map as MapLibreMap, Marker, StyleSpecification, GeoJSONSource } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { DISTRICTS, type DistrictId } from '@/lib/game-config';
import styles from './SpideyTracker.module.css';

export type TrackerPlayer = { id:string; position:[number,number,number]; self:boolean };
export const worldToMap = (point: [number,number,number]): [number,number] => [-73.9855 + point[0] / (111320*Math.cos(40.758*Math.PI/180)), 40.758 - point[2]/111320];

type Props = {
  players?: TrackerPlayer[];
  finish?: [number,number,number] | null;
  open: boolean;
  current: DistrictId;
  loaded: ReadonlySet<DistrictId>;
  onClose: () => void;
  onOpen: () => void;
  onTravel: (id: DistrictId) => void;
};

const OPEN_FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const DISTRICT_COORDINATES: Record<DistrictId, [number, number]> = {
  'new-york-city': [-73.9855, 40.758],
  'new-york-buildings': [-74.0104, 40.7075],
  'street-city': [-73.9946, 40.7308],
  'city-night': [-73.9969, 40.7061],
  'backstreet': [-73.9553, 40.7691],
};

/** Convert OpenFreeMap's no-token OpenMapTiles style into the tracker palette before map creation. */
function createTrackerStyle(sourceStyle: StyleSpecification): StyleSpecification {
  const style = structuredClone(sourceStyle);

  for (const layer of style.layers) {
    const id = layer.id.toLowerCase();
    const isPoi = /poi|shop|amenity|hospital|school|airport|transit|railway-label/.test(id);

    if (isPoi) {
      layer.layout = { ...layer.layout, visibility: 'none' };
      continue;
    }

    if (layer.type === 'background') {
      layer.paint = { 'background-color': '#061326' };
      continue;
    }

    if (layer.type === 'fill') {
      if (/water|ocean|river|lake/.test(id)) {
        layer.paint = { ...layer.paint, 'fill-color': '#020714', 'fill-opacity': 1 };
      } else if (/building/.test(id)) {
        layer.paint = {
          ...layer.paint,
          'fill-color': '#0b2b40',
          'fill-outline-color': '#15506a',
          'fill-opacity': 0.94,
        };
      } else if (/park|landcover|landuse|wood|grass/.test(id)) {
        layer.paint = { ...layer.paint, 'fill-color': '#08273a', 'fill-opacity': 0.88 };
      } else {
        layer.paint = { ...layer.paint, 'fill-color': '#071a2f', 'fill-opacity': 0.96 };
      }
      continue;
    }

    if (layer.type === 'fill-extrusion') {
      layer.paint = {
        ...layer.paint,
        'fill-extrusion-color': '#0b2b40',
        'fill-extrusion-opacity': 0.76,
      };
      continue;
    }

    if (layer.type === 'line') {
      const isRoad = /road|street|highway|motorway|trunk|bridge|tunnel/.test(id);
      const isMajor = /motorway|trunk|primary|highway/.test(id);
      const isWater = /water|river|stream/.test(id);
      layer.paint = {
        ...layer.paint,
        'line-color': isMajor ? '#40d9ef' : isRoad ? '#12728c' : isWater ? '#09283d' : '#12445a',
        'line-opacity': isRoad ? 0.9 : 0.58,
      };
      continue;
    }

    if (layer.type === 'symbol') {
      layer.layout = { ...layer.layout, visibility: 'none' };
      const isRoadLabel = /road|street|highway/.test(id);
      const isPlace = /place|city|town|village|state|country/.test(id);
      layer.paint = {
        ...layer.paint,
        'text-color': isRoadLabel ? '#6f9aac' : isPlace ? '#8eb2c0' : '#58798b',
        'text-halo-color': '#03101f',
        'text-halo-width': 1.2,
        'text-opacity': isRoadLabel || isPlace ? 0.82 : 0.52,
        'icon-opacity': 0.25,
      };
    }
  }

  return style;
}

export function SpideyTracker({ open, current, loaded, onClose, onOpen, onTravel, players = [], finish = null }: Props) {
  const liveRef = useRef({players,finish});
  useEffect(() => { liveRef.current = {players,finish}; }, [players,finish]);
  const updateLiveRef = useRef<() => void>(() => undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<DistrictId, { marker: Marker; element: HTMLButtonElement }>());
  const onTravelRef = useRef(onTravel);
  const trackerStateRef = useRef({ current, loaded });
  const [mapStatus, setMapStatus] = useState<'connecting' | 'online' | 'error'>('connecting');

  useEffect(() => {
    onTravelRef.current = onTravel;
  }, [onTravel]);

  useEffect(() => {
    trackerStateRef.current = { current, loaded };
  }, [current, loaded]);

  useEffect(() => {
    if (!open || !containerRef.current) return;

    const abortController = new AbortController();
    const markerStore = markersRef.current;
    let mapInstance: MapLibreMap | null = null;
    let disposed = false;
    setMapStatus('connecting');

    async function mountMap() {
      try {
        const { default: maplibregl } = await import('maplibre-gl');
        const response = await fetch(OPEN_FREE_MAP_STYLE, { signal: abortController.signal });
        if (!response.ok) throw new Error(`Map style request failed: ${response.status}`);
        const sourceStyle = (await response.json()) as StyleSpecification;
        if (disposed || !containerRef.current) return;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: createTrackerStyle(sourceStyle),
          center: DISTRICT_COORDINATES['new-york-city'],
          zoom: 11.35,
          bearing: -24,
          pitch: 34,
          minZoom: 9.5,
          maxZoom: 17,
          attributionControl: false,
          fadeDuration: 120,
        });
        mapInstance = map;
        mapRef.current = map;

        map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true, visualizePitch: true }), 'bottom-right');
        map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

        const liveMarkers = new Map<string, Marker>();
        const updateLive = () => {
          if (!map.isStyleLoaded()) return;
          const {players: peers,finish: goal} = liveRef.current;
          const ids = new Set(peers.map(p=>p.id)); if (goal) ids.add('race-finish');
          for (const [id,marker] of liveMarkers) if (!ids.has(id)) {marker.remove();liveMarkers.delete(id);}
          const all = [...peers.map(p=>({id:p.id,position:p.position,label:p.self?'YOU':`SPIDER ${p.id.slice(0,4)}`,self:p.self})), ...(goal?[{id:'race-finish',position:goal,label:'FINISH',self:false}]:[])];
          for (const entry of all) {
            let marker = liveMarkers.get(entry.id);
            if (!marker) {const element=document.createElement('div');element.className='live-map-player';element.style.cssText=`font-family:Comback Home,Impact,sans-serif;color:${entry.self?'white':'#7deaff'};font-size:16px;text-shadow:0 2px 6px #000;border:1px solid #84f0ff99;border-radius:10px;background:#07192bd9;padding:5px 8px;white-space:nowrap`;element.textContent=entry.label;element.setAttribute('aria-label',entry.label);marker=new maplibregl.Marker({element}).setLngLat(worldToMap(entry.position)).addTo(map);liveMarkers.set(entry.id,marker);}
            marker.setLngLat(worldToMap(entry.position));
          }
          const self = peers.find(p=>p.self);
          const data:GeoJSON.FeatureCollection = {type:'FeatureCollection',features:self&&goal?[{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[worldToMap(self.position),worldToMap(goal)]}}]:[]};
          (map.getSource('race-wayfinder') as GeoJSONSource|undefined)?.setData(data);
          const points=all.map(p=>worldToMap(p.position));
          if (points.length && points.some(point=>!map.getBounds().contains(point))) {const bounds=new maplibregl.LngLatBounds(points[0],points[0]);points.forEach(p=>bounds.extend(p));map.fitBounds(bounds,{padding:85,maxZoom:15,duration:350});}
        };
        updateLiveRef.current = updateLive;
        void map.once('load', () => {
          if (disposed) return;
          setMapStatus('online');

          map.addSource('race-wayfinder',{type:'geojson',data:{type:'FeatureCollection',features:[]}});
          map.addLayer({id:'race-wayfinder-glow',type:'line',source:'race-wayfinder',paint:{'line-color':'#61e6ff','line-width':10,'line-opacity':.18}});
          map.addLayer({id:'race-wayfinder-line',type:'line',source:'race-wayfinder',paint:{'line-color':'#bcfbff','line-width':2.5,'line-dasharray':[2,1]}});
          map.jumpTo({center:worldToMap(liveRef.current.players.find(p=>p.self)?.position ?? [0,0,0]),zoom:14.5,bearing:0,pitch:24});
          updateLive();
          map.resize();
        });
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('[spidey-tracker] basemap failed', error);
          setMapStatus('error');
        }
      }
    }

    void mountMap();

    return () => {
      disposed = true;
      abortController.abort();
      for (const { marker } of markerStore.values()) marker.remove();
      markerStore.clear();
      updateLiveRef.current = () => undefined;
      mapInstance?.remove();
    };
  }, [open]);

  useEffect(() => {
    for (const district of DISTRICTS) {
      const marker = markersRef.current.get(district.id)?.element;
      if (!marker) continue;
      marker.dataset.current = String(district.id === current);
      marker.dataset.loaded = String(loaded.has(district.id));
    }

    const map = mapRef.current;
    if (open && map?.loaded()) {
      map.flyTo({ center: DISTRICT_COORDINATES[current], zoom: 14.5, bearing: 0, pitch: 24, duration: 800, essential: true });
    }
  }, [current, loaded, open]);

  useEffect(() => { if (open) updateLiveRef.current(); }, [players,finish,open]);

  if (!open) {
    return (
      <button className={styles.trigger} type="button" onClick={onOpen} aria-label="Open Maps">
        <MapIcon aria-hidden="true" />
        <span>Maps</span>
        <small>M</small>
      </button>
    );
  }

  const currentDistrict = DISTRICTS.find((district) => district.id === current) ?? DISTRICTS[0];

  return (
    <section className={styles.panel} aria-label="Spidey Tracker">
      <header className={styles.topbar}>
        <div className={styles.maskLogo}><Image src="/assets/ui/spider-man-mask.svg" alt="" width={45} height={45} /></div>
        <div className={styles.wordmark}><span>Spidey</span><i /> <span>Tracker</span></div>
        <div className={styles.connection} data-status={mapStatus}>
          <span /> {mapStatus === 'online' ? 'NYC link online' : mapStatus === 'error' ? 'Map link offline' : 'Linking NYC'}
        </div>
        <button className={styles.close} type="button" onClick={onClose} aria-label="Close Spidey Tracker"><X /></button>
      </header>

      <div className={styles.mapShell}>
        <div ref={containerRef} className={styles.map} aria-label="Live player positions and race route across New York" />
        <div className={styles.scanlines} aria-hidden="true" />
        <div className={styles.cornerLabel}>
          <span>Current sector</span>
          <strong>{currentDistrict.name}</strong>
          <small>40.7580° N · 73.9855° W</small>
        </div>
        {mapStatus === 'error' && (
          <output className={styles.mapError}>Live street grid unavailable. The in-world finish beacon remains active.</output>
        )}
        <nav className={styles.districtRail} aria-label="Fast travel districts">
          {DISTRICTS.map((district) => (
            <button
              key={district.id}
              type="button"
              data-current={district.id === current}
              data-loaded={loaded.has(district.id)}
              onClick={() => onTravel(district.id)}
            >
              <span>{district.name}</span>
              <small>{loaded.has(district.id) ? 'Ready' : 'Stream'}</small>
            </button>
          ))}
        </nav>
      </div>

      <footer className={styles.footer}>
        <div className={styles.spiderLogo}><Image src="/assets/ui/spider-man-emblem.svg" alt="" width={46} height={46} /></div>
        <div className={styles.ticker}>NYC district network online · {loaded.size.toString().padStart(2, '0')} / {DISTRICTS.length.toString().padStart(2, '0')} sectors cached · select a signal to fast travel</div>
        <button type="button" className={styles.audio} aria-label="Tracker sound"><Volume2 /></button>
      </footer>
    </section>
  );
}
