'use client';

import { Play } from 'lucide-react';
import { lazy, Suspense, useEffect, useState, useRef, type CSSProperties } from 'react';
import Image from 'next/image';
import { RaceHud } from '@/components/game/RaceHud';
import { emptyRaceView } from '@/lib/race-session';
import type {
  GameHud,
  SpiderGameHandle,
  MapPlayer,
} from '@/components/game/SpiderGame';
import { SpideyTracker } from '@/components/game/SpideyTracker';
import { SpiderHud } from '@/components/game/SpiderHud';
import { ActivityHud } from '@/components/game/ActivityHud';
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

import type { SkyPreset } from '@/lib/city-weather';

const SpiderGame = lazy(() => import('@/components/game/SpiderGame'));
type Phase = 'select' | 'loading' | 'game';
type MapTransition = {
  district: DistrictId;
  stage: 'loading' | 'reveal';
  returnPhase: 'select' | 'game';
};

const MAP_LOADING_ACCENTS: Partial<Record<DistrictId, string>> = {
  'new-york-city': '#d92d50',
  'procedural-city': '#e9a85a',
  'cyberpunk-city': '#b638ff',
};

export default function Home() {
  const gameRef = useRef<SpiderGameHandle>(null);
  const [raceView, setRaceView] = useState(emptyRaceView);
  const [mapPlayers, setMapPlayers] = useState<MapPlayer[]>([]);
  const [sky, setSky] = useState<SkyPreset>('golden');
  const [night, setNight] = useState(false);
  const [experimentalCamera, setExperimentalCamera] = useState(false);
  const [cameraZoom, setCameraZoom] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<SuitId>('miguel');
  const [selectedMap, setSelectedMap] = useState<DistrictId>('new-york-city');
  const [phase, setPhase] = useState<Phase>('loading');
  const [menuLeaving, setMenuLeaving] = useState(false);
  const [mapTransition, setMapTransition] = useState<MapTransition | null>(null);
  const mapTransitionRef = useRef<MapTransition | null>(null);
  const transitionTimers = useRef<number[]>([]);
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
    mode: 'idle',
    charge: 0,
    chargeLabel: '',
    announcement: null,
    callout: { x: 50, y: 55, side: 'right' },
  });
  const [online, setOnline] = useState<{
    count: number;
    status: MultiplayerStatus;
  }>({ count: 1, status: 'connecting' });
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

  useEffect(() => () => {
    transitionTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const enterCity = () => {
    if (!isSuitUnlocked(activeSuit, playerProgress)) return;
    setMenuLeaving(true);
    transitionTimers.current.push(window.setTimeout(() => {
      setPhase('game');
      setMenuLeaving(false);
    }, 720));
  };

  const selectSuit = (id: SuitId) => {
    if (id === activeSuit.id) return;
    const suit = SUITS.find((item) => item.id === id);
    if (!suit || !isSuitUnlocked(suit, playerProgress)) return;
    setStatus(`Switching to ${suit.name}`);
    gameRef.current?.switchSuit(id);
    setSelected(id);
  };

  const selectMap = (district: DistrictId, returnPhase: 'select' | 'game' = phase === 'game' ? 'game' : 'select') => {
    if (district === currentDistrict || mapTransitionRef.current) return;
    const transition: MapTransition = { district, stage: 'loading', returnPhase };
    mapTransitionRef.current = transition;
    setMapTransition(transition);
    setSelectedMap(district);
    setLoadedDistricts(new Set());
    setStatus(`Streaming ${DISTRICTS.find((item) => item.id === district)?.name ?? 'city'}`);
    setProgress(1);
    gameRef.current?.travelTo(district);
  };

  const travelTo = (district: DistrictId) => {
    setTrackerOpen(false);
    selectMap(district, 'game');
  };

  return (
    <main className={`game-shell${settingsOpen ? ' is-paused' : ''}${phase === 'select' ? ' is-home' : ''}`}>
      <Suspense fallback={null}>
        <SpiderGame
          ref={gameRef}
          sky={sky}
          night={night}
          experimentalCamera={experimentalCamera}
          cameraZoom={cameraZoom}
          paused={settingsOpen || phase !== 'game' || Boolean(mapTransition)}
          onRaceView={setRaceView}
          onMapPlayers={setMapPlayers}
          suitId={activeSuit.id}
          districtId={selectedMap}
          onReady={() => setPhase('select')}
          onStatus={(message, nextProgress) => {
            setStatus(message);
            setProgress(Math.round(nextProgress));
            const transition = mapTransitionRef.current;
            if (transition && /unavailable|could not/i.test(message)) {
              mapTransitionRef.current = null;
              setMapTransition(null);
              setSelectedMap(currentDistrict);
            }
          }}
          onHud={setHud}
          onLoadedDistricts={setLoadedDistricts}
          onDistrictChange={(district) => {
            setCurrentDistrict(district);
            if (district === 'cyberpunk-city') setSky('blizzard');
            const transition = mapTransitionRef.current;
            if (transition?.stage === 'loading' && transition.district === district) {
              const revealing: MapTransition = { ...transition, stage: 'reveal' };
              mapTransitionRef.current = revealing;
              setMapTransition(revealing);
              setProgress(100);
              setPhase(transition.returnPhase);
              transitionTimers.current.push(window.setTimeout(() => {
                mapTransitionRef.current = null;
                setMapTransition(null);
              }, 650));
            }
          }}
          onOnlineCount={(count, networkStatus) =>
            setOnline({ count, status: networkStatus })
          }
          onSwingAttached={() => setPlayerProgress(addSwingAttachment())}
        />
      </Suspense>

      {phase === 'select' && (
        <div className={`live-home-menu${menuLeaving ? ' is-leaving' : ''}`}>
          <section className="home-suit-panel" aria-label="Choose Spider-Man">
            <div className="suit-grid" aria-label="Choose Spider-Man">
              {SUITS.map((suit) => (
                <button key={suit.id} type="button"
                  data-selected={suit.id === activeSuit.id}
                  onClick={() => selectSuit(suit.id)}
                  aria-label={`Select ${suit.name}`}>
                  <Image src={`/assets/previews/suits/${suit.id}.png`} alt="" width={180} height={180} unoptimized />
                  <span>{suit.name}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="home-launch-panel" aria-label="Choose map and start game">
            <div className="home-selected-suit"><small>Selected suit</small><h1>{activeSuit.name}</h1></div>
            <div className="home-map-grid" aria-label="Choose map">
              {DISTRICTS.map((city) => (
                <button key={city.id} type="button" data-selected={city.id === currentDistrict}
                  data-loading={mapTransition?.district === city.id}
                  disabled={Boolean(mapTransition)}
                  style={{
                    '--map-load-progress': `${mapTransition?.district === city.id ? (mapTransition.stage === 'reveal' ? 100 : progress) : 0}%`,
                    '--map-load-color': MAP_LOADING_ACCENTS[city.id] ?? '#55e9fa',
                  } as CSSProperties}
                  onClick={() => selectMap(city.id, 'select')}>
                  <Image src={city.preview} alt="" width={320} height={180} unoptimized />
                  <span>{city.name}</span>
                  {mapTransition?.district === city.id && (
                    <output>{mapTransition.stage === 'reveal' ? 'READY' : `${Math.max(1, progress)}%`}</output>
                  )}
                </button>
              ))}
            </div>
            <button className="enter-city" type="button" onClick={enterCity}>
              <Play aria-hidden="true" /> Play
            </button>
          </section>
          <p className="home-disclaimer">This website is a non-commercial fan site and is not affiliated with, authorized, or endorsed by Marvel Entertainment or Disney.</p>
        </div>
      )}

      {phase === 'loading' && !mapTransition && (
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
          <RaceHud
            view={raceView}
            action={(action) => gameRef.current?.raceAction(action)}
            night={night}
            onNight={() => setNight((value) => !value)}
            sky={sky}
            onSky={setSky}
            district={currentDistrict}
            experimentalCamera={experimentalCamera}
            onExperimentalCamera={setExperimentalCamera}
            cameraZoom={cameraZoom}
            onCameraZoom={setCameraZoom}
            open={settingsOpen}
            onOpenChange={setSettingsOpen}
          />
          <ActivityHud hud={hud} action={(action) => gameRef.current?.activityAction(action)} />
          <SpiderHud
            suitId={activeSuit.id}
            suitName={activeSuit.name}
            districtName={activeDistrict.name}
            hud={hud}
            online={online}
            ironMan={activeSuit.traversal === 'ironman'}
            onSuitChange={(id) => {
              selectSuit(id);
            }}
          />

          {!hud.boss && <SpideyTracker
            players={mapPlayers}
            finish={raceView.target ?? raceView.course?.finish ?? null}
            route={raceView.route ?? []}
            open={trackerOpen}
            current={currentDistrict}
            loaded={loadedDistricts}
            onClose={() => setTrackerOpen(false)}
            onOpen={() => setTrackerOpen(true)}
            onTravel={travelTo}
            loadingDistrict={mapTransition?.district ?? null}
            loadingProgress={mapTransition?.stage === 'reveal' ? 100 : progress}
          />}
        </>
      )}
    </main>
  );
}
