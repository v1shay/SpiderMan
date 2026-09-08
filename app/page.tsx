'use client';

import {
  Activity,
  Gauge,
  Move3d,
  Navigation,
  Play,
  Radio,
  Rotate3d,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useState, useRef } from 'react';
import Image from 'next/image';
import { RaceHud } from '@/components/game/RaceHud';
import { emptyRaceView } from '@/lib/race-session';
import type {
  GameHud,
  SpiderGameHandle,
  MapPlayer,
} from '@/components/game/SpiderGame';
import { SpideyTracker } from '@/components/game/SpideyTracker';
import SuitShowroom from '@/components/game/SuitShowroom';
import {
  DISTRICTS,
  SUITS,
  type DistrictId,
  type SuitId,
} from '@/lib/game-config';
import type { MultiplayerStatus } from '@/lib/multiplayer';
import {
  addSwingAttachment,
  emptyProgress,
  isSuitUnlocked,
  progressionEventName,
  readProgress,
  type PlayerProgress,
} from '@/lib/progression';

import { SKY_PRESETS, type SkyPreset } from '@/lib/city-weather';

const SpiderGame = lazy(() => import('@/components/game/SpiderGame'));
type Phase = 'select' | 'loading' | 'game';

export default function Home() {
  const gameRef = useRef<SpiderGameHandle>(null);
  const [raceView, setRaceView] = useState(emptyRaceView);
  const [mapPlayers, setMapPlayers] = useState<MapPlayer[]>([]);
  const [sky, setSky] = useState<SkyPreset>('golden');
  const [night, setNight] = useState(false);
  const [selected, setSelected] = useState<SuitId>('miguel');
  const [lobbyEngaged] = useState(true);
  const [selectedMap, setSelectedMap] = useState<DistrictId>('new-york-city');
  const [phase, setPhase] = useState<Phase>('select');
  const [status, setStatus] = useState('Waiting for suit selection');
  const [progress, setProgress] = useState(0);
  const [trackerOpen, setTrackerOpen] = useState(false);
  const [loadedDistricts, setLoadedDistricts] = useState<Set<DistrictId>>(
    () => new Set(),
  );
  const [currentDistrict, setCurrentDistrict] =
    useState<DistrictId>('new-york-city');
  const [hud, setHud] = useState<GameHud>({
    speed: 0,
    altitude: 0,
    fps: 60,
    swinging: false,
  });
  const [online, setOnline] = useState<{
    count: number;
    status: MultiplayerStatus;
  }>({ count: 1, status: 'connecting' });
  const [, setShowroomStatus] = useState({
    message: 'Opening warehouse',
    progress: 0,
  });
  const [playerProgress, setPlayerProgress] = useState<PlayerProgress>(() =>
    typeof window === 'undefined' ? emptyProgress() : readProgress(),
  );
  const activeSuit = SUITS.find((suit) => suit.id === selected) ?? SUITS[0];
  const activeDistrict =
    DISTRICTS.find((district) => district.id === currentDistrict) ??
    DISTRICTS[0];

  useEffect(() => {
    void import('@/lib/analytics').then(({ trackVisit }) => trackVisit());
  }, []);
  useEffect(() => {
    const onProgress = (event: Event) =>
      setPlayerProgress((event as CustomEvent<PlayerProgress>).detail);
    window.addEventListener(progressionEventName, onProgress);
    return () => window.removeEventListener(progressionEventName, onProgress);
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === 'KeyM' && phase === 'game')
        setTrackerOpen((open) => !open);
      if (event.code === 'Escape') setTrackerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  const enterCity = () => {
    if (!isSuitUnlocked(activeSuit, playerProgress)) return;
    setLoadedDistricts(new Set());
    setCurrentDistrict(selectedMap);
    setStatus(
      `Preparing ${activeSuit.name} for ${DISTRICTS.find((city) => city.id === selectedMap)?.name}`,
    );
    setProgress(1);
    setPhase('loading');
  };

  const selectMap = (district: DistrictId) => {
    setSelectedMap(district);
    if (district === 'cyberpunk-city' && sky !== 'snow' && sky !== 'blizzard')
      setSky('snow');
  };

  const travelTo = (district: DistrictId) => {
    if (district === 'cyberpunk-city' && sky !== 'snow' && sky !== 'blizzard')
      setSky('snow');
    setSelectedMap(district);
    setCurrentDistrict(district);
    setLoadedDistricts(new Set());
    setStatus(
      `Opening ${DISTRICTS.find((item) => item.id === district)?.name ?? 'City'}`,
    );
    setProgress(1);
    setPhase('loading');
    setTrackerOpen(false);
  };

  if (phase === 'select') {
    return (
      <main
        className={`launch-screen ${lobbyEngaged ? 'is-hero-focused' : ''}`}
      >
        <SuitShowroom
          selected={selected}
          engaged={lobbyEngaged}
          progress={playerProgress}
          onSelect={(id) => {
            const suit = SUITS.find((item) => item.id === id);
            if (suit && isSuitUnlocked(suit, playerProgress)) setSelected(id);
          }}
          onEngage={() => undefined}
          onStatus={(message, nextProgress) =>
            setShowroomStatus({ message, progress: Math.round(nextProgress) })
          }
        />
        <section className="home-suit-panel" aria-label="Choose Spider-Man">
          <div className="suit-grid" aria-label="Choose Spider-Man">
            {SUITS.map((suit) => (
              <button
                key={suit.id}
                type="button"
                data-selected={suit.id === selected}
                onClick={() => setSelected(suit.id)}
                aria-label={`Select ${suit.name}`}
              >
                <Image
                  src={`/assets/previews/suits/${suit.id}.png`}
                  alt=""
                  width={180}
                  height={180}
                  unoptimized
                />
                <span>{suit.name}</span>
              </button>
            ))}
          </div>
        </section>
        <section
          className="home-launch-panel"
          aria-label="Choose map and start game"
        >
          <div className="home-selected-suit">
            <small>Selected suit</small>
            <h1>{activeSuit.name}</h1>
          </div>
          <div className="home-map-grid" aria-label="Choose map">
            {DISTRICTS.map((city) => (
              <button
                key={city.id}
                type="button"
                data-selected={city.id === selectedMap}
                onClick={() => selectMap(city.id)}
              >
                <Image
                  src={city.preview}
                  alt=""
                  width={320}
                  height={180}
                  unoptimized
                />
                <span>{city.name}</span>
              </button>
            ))}
          </div>
          <button className="enter-city" type="button" onClick={enterCity}>
            <Play aria-hidden="true" /> Start Game
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="game-shell">
      <Suspense fallback={null}>
        <SpiderGame
          ref={gameRef}
          sky={sky}
          night={night}
          onRaceView={setRaceView}
          onMapPlayers={setMapPlayers}
          key={`${selected}:${selectedMap}`}
          suitId={selected}
          districtId={selectedMap}
          onReady={() => setPhase('game')}
          onStatus={(message, nextProgress) => {
            setStatus(message);
            setProgress(Math.round(nextProgress));
          }}
          onHud={setHud}
          onLoadedDistricts={setLoadedDistricts}
          onDistrictChange={setCurrentDistrict}
          onOnlineCount={(count, networkStatus) =>
            setOnline({ count, status: networkStatus })
          }
          onSwingAttached={() => setPlayerProgress(addSwingAttachment())}
        />
      </Suspense>

      {phase === 'loading' && (
        <section
          className="loading-screen"
          aria-live="polite"
          aria-label="Loading SpiderMan"
        >
          <div className="loading-web" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="loading-logo">
            <strong>SpiderMan</strong>
          </div>
          <div className="loading-progress">
            <span style={{ width: `${progress}%` }} />
          </div>
          <div className="loading-readout">
            <span>{status}</span>
            <strong>{progress}%</strong>
          </div>
          <p>Loading city meshes and checking rooftop contact</p>
        </section>
      )}

      {phase === 'game' && (
        <>
          <div className="world-options">
            <label>
              Sky
              <select
                aria-label="Sky and snow"
                value={sky}
                onChange={(event) => setSky(event.target.value as SkyPreset)}
              >
                {Object.entries(SKY_PRESETS)
                  .filter(
                    ([id]) =>
                      currentDistrict !== 'cyberpunk-city' ||
                      id === 'snow' ||
                      id === 'blizzard',
                  )
                  .map(([id, preset]) => (
                    <option key={id} value={id}>
                      {preset.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <RaceHud
            view={raceView}
            action={(action) => gameRef.current?.raceAction(action)}
            night={night}
            onNight={() => setNight((value) => !value)}
          />
          <header className="game-topbar">
            <div className="game-brand">
              <strong>
                {activeSuit.traversal === 'ironman' ? 'Iron Man' : 'SpiderMan'}
              </strong>
            </div>
            <div className="district-readout">
              <Navigation aria-hidden="true" />
              <span>
                <small>Current sector</small>
                <strong>{activeDistrict.name}</strong>
              </span>
            </div>
            <div
              className={`stream-state ${online.status === 'online' ? '' : 'busy'}`}
            >
              <Radio aria-hidden="true" />
              <span>
                {online.status === 'online'
                  ? `${online.count} ${online.count === 1 ? 'player' : 'players'} online`
                  : online.status === 'error'
                    ? 'Solo · network unavailable'
                    : online.status === 'disabled'
                      ? 'Solo skyline'
                      : 'Connecting players'}
              </span>
            </div>
          </header>

          <aside className="telemetry" aria-label="Traversal telemetry">
            <div>
              <Gauge aria-hidden="true" />
              <span>
                <strong>{hud.speed}</strong>
                <small>km/h</small>
              </span>
            </div>
            <div>
              <Move3d aria-hidden="true" />
              <span>
                <strong>{hud.altitude}</strong>
                <small>meters</small>
              </span>
            </div>
            <div>
              <Activity aria-hidden="true" />
              <span>
                <strong>{hud.fps}</strong>
                <small>fps</small>
              </span>
            </div>
          </aside>

          <div className={`swing-indicator ${hud.swinging ? 'active' : ''}`}>
            <span className="web-orb" />
            <div>
              <small>Web line</small>
              <strong>{hud.swinging ? 'Attached' : 'Ready'}</strong>
            </div>
          </div>
          <div className="reticle" aria-hidden="true">
            <span />
            <i />
          </div>

          <aside className="controls-card">
            <div>
              <kbd>WASD</kbd>
              <span>Move</span>
            </div>
            <div>
              <kbd>Mouse</kbd>
              <span>Click game to capture · look / aim</span>
            </div>
            <div>
              <kbd>Esc</kbd>
              <span>Release mouse</span>
            </div>
            <div>
              <kbd>Space</kbd>
              <span>
                {activeSuit.traversal === 'ironman'
                  ? 'Repulsor ascent'
                  : 'Jump / double jump'}
              </span>
            </div>
            <div>
              <kbd>Click</kbd>
              <span>
                {activeSuit.traversal === 'ironman'
                  ? 'Tap cruise / hold boost'
                  : 'Tap zip · hold swing'}
              </span>
            </div>
            <div>
              <kbd>E</kbd>
              <span>
                {activeSuit.traversal === 'ironman'
                  ? 'Toggle cruise'
                  : 'Point launch (optional)'}
              </span>
            </div>
            {activeSuit.traversal === 'ironman' && (
              <div>
                <kbd>F</kbd>
                <span>Hover / free fall</span>
              </div>
            )}
            <div>
              <kbd>Shift</kbd>
              <span>
                {activeSuit.traversal === 'ironman' ? 'Descend' : 'Dive'}
              </span>
            </div>
            {activeSuit.traversal === 'spider' && (
              <div>
                <kbd>Q</kbd>
                <span>Crawl / release wall</span>
              </div>
            )}
            <div>
              <kbd>G</kbd>
              <span>Web wings · W dive / S climb</span>
            </div>
            <div>
              <kbd>C</kbd>
              <span>Hold to charge jump (4s)</span>
            </div>
            <div>
              <kbd>X</kbd>
              <span>Hold slingshot · aim and release</span>
            </div>
            <div>
              <kbd>R</kbd>
              <span>Roll · F for aerial tricks</span>
            </div>
            <div>
              <kbd>M</kbd>
              <span>City tracker</span>
            </div>
            <Rotate3d aria-hidden="true" />
          </aside>

          <SpideyTracker
            players={mapPlayers}
            finish={raceView.course?.finish ?? null}
            open={trackerOpen}
            current={currentDistrict}
            loaded={loadedDistricts}
            onClose={() => setTrackerOpen(false)}
            onOpen={() => setTrackerOpen(true)}
            onTravel={travelTo}
          />
        </>
      )}
    </main>
  );
}
