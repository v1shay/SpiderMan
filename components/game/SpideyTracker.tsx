'use client';

import { Crosshair, Map, Volume2, X } from 'lucide-react';
import { DISTRICTS, type DistrictId } from '@/lib/game-config';

type Props = {
  open: boolean;
  current: DistrictId;
  loaded: ReadonlySet<DistrictId>;
  onClose: () => void;
  onOpen: () => void;
  onTravel: (id: DistrictId) => void;
};

export function SpideyTracker({ open, current, loaded, onClose, onOpen, onTravel }: Props) {
  if (!open) {
    return (
      <button className="tracker-trigger" type="button" onClick={onOpen} aria-label="Open Spidey Tracker">
        <Map aria-hidden="true" />
        <span>Tracker</span>
      </button>
    );
  }

  return (
    <section className="tracker-panel" aria-label="Spidey Tracker">
      <header className="tracker-topbar">
        <div className="tracker-avatar" aria-hidden="true"><span /></div>
        <div className="tracker-wordmark"><span>Spidey</span><i /> <span>Tracker</span></div>
        <button className="tracker-close" type="button" onClick={onClose} aria-label="Close Spidey Tracker"><X /></button>
      </header>

      <div className="tracker-map">
        <div className="map-grid" aria-hidden="true" />
        <div className="island-shape" aria-hidden="true" />
        <div className="river-label west">Hudson</div>
        <div className="river-label east">East river</div>
        {DISTRICTS.map((district) => {
          const isCurrent = district.id === current;
          const isLoaded = loaded.has(district.id);
          return (
            <button
              key={district.id}
              type="button"
              className={`map-marker ${district.accent} ${isCurrent ? 'current' : ''}`}
              style={{ left: `${district.map[0]}%`, top: `${district.map[1]}%` }}
              onClick={() => onTravel(district.id)}
              aria-label={`Travel to ${district.name}${isLoaded ? ', loaded' : ', will stream'}`}
            >
              <span className="marker-icon"><Crosshair aria-hidden="true" /></span>
              <span className="marker-label">{district.name}</span>
              {!isLoaded && <span className="stream-dot">Stream</span>}
            </button>
          );
        })}
        <div className="map-coordinates">40.7580° N<br />73.9855° W</div>
      </div>

      <footer className="tracker-footer">
        <div className="tiny-spidey" aria-hidden="true"><span /></div>
        <div className="tracker-ticker">NYC district network online · select a marker to fast travel</div>
        <button type="button" className="tracker-audio" aria-label="Tracker sound"><Volume2 /></button>
      </footer>
    </section>
  );
}
