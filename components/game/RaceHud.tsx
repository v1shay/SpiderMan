'use client';
import { Camera, Flag, Moon, Play, Settings, Sun, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatRaceTime, type RaceView } from '@/lib/race-session';
import { SKY_PRESETS, type SkyPreset } from '@/lib/city-weather';
import type { DistrictId } from '@/lib/game-config';
import type { RaceAction } from './SpiderGame';
export function RaceHud({
  view,
  action,
  night,
  onNight,
  sky,
  onSky,
  district,
  experimentalCamera,
  onExperimentalCamera,
  cameraZoom,
  onCameraZoom,
  open,
  onOpenChange,
}: {
  view: RaceView;
  action: (a: RaceAction) => void;
  night: boolean;
  onNight: () => void;
  sky: SkyPreset;
  onSky: (sky: SkyPreset) => void;
  district: DistrictId;
  experimentalCamera: boolean;
  onExperimentalCamera: (enabled: boolean) => void;
  cameraZoom: number;
  onCameraZoom: (zoom: number) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settingsTab, setSettingsTab] = useState<'gameplay' | 'display'>('gameplay');
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.code === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onOpenChange, open]);
  const busy = ['inviting', 'countdown', 'racing'].includes(view.phase);
  const mode = view.mode ?? view.course?.mode ?? 'speed';
  const gateLabel = view.gateType?.replaceAll('-', ' ').toUpperCase();
  return (
    <>
      <section
        className="race-hologram"
        aria-label="Race timer and personal best"
        data-phase={view.phase}
      >
        <div>
          <small>
            {view.phase === 'countdown'
              ? 'LAUNCH IN'
              : view.phase === 'racing'
                ? mode === 'speed'
                  ? 'TIME TRIAL'
                  : mode === 'style'
                    ? 'STYLE RUN'
                    : 'FLOW RACE'
                : view.phase === 'finished'
                  ? 'FINISH'
                  : 'SKYLINE RACING'}
          </small>
          <strong>
            {view.phase === 'countdown'
              ? view.countdown
              : formatRaceTime(view.time)}
          </strong>
        </div>
        <i />
        <div>
          <small>PERSONAL BEST</small>
          <b>{formatRaceTime(view.best)}</b>
          <em>
            {view.splitDelta != null
              ? `${view.splitDelta < 0 ? '−' : '+'}${(Math.abs(view.splitDelta) / 1000).toFixed(2)}s VS PB`
              : view.ghost
                ? 'GHOST READY'
                : 'MAKE YOUR MARK'}
          </em>
        </div>
        {view.course && (
          <div className="race-guidance">
            <b>
              {view.distance} m
              {view.gateCount
                ? ` · GATE ${Math.min((view.gateIndex ?? 0) + 1, view.gateCount)}/${view.gateCount}`
                : ''}
            </b>
            <small>
              {view.missedGate
                ? `RETURN TO ${gateLabel ?? 'MISSED GATE'}`
                : view.phase === 'racing'
                  ? (gateLabel ?? view.message)
                  : view.message}
            </small>
            {mode !== 'speed' && (
              <em>{Math.round(view.styleScore ?? 0).toLocaleString()} STYLE</em>
            )}
          </div>
        )}
      </section>
      <div className="game-settings">
        {!open && <button className="game-settings-toggle" type="button"
          onClick={() => onOpenChange(true)}
          aria-expanded={open} aria-controls="game-settings-panel"
          aria-label="Open game settings">
          <Settings size={17} />
          <span>Settings</span>
        </button>}
        {open && <div className="pause-settings-layer" role="presentation">
          <div className="pause-settings-backdrop" onClick={() => onOpenChange(false)} />
          <aside id="game-settings-panel" className="game-settings-panel pause-settings-panel" aria-label="Paused game settings">
            <header className="pause-settings-header">
              <div><small>PAUSED</small><strong>SETTINGS</strong></div>
              <button className="pause-settings-close" type="button" onClick={() => onOpenChange(false)} aria-label="Resume game">
                <X size={18} />
              </button>
            </header>
            <nav className="settings-tabs" aria-label="Settings categories">
              <button type="button" aria-current={settingsTab === 'gameplay' ? 'page' : undefined} onClick={() => setSettingsTab('gameplay')}>GAMEPLAY</button>
              <button type="button" aria-current={settingsTab === 'display' ? 'page' : undefined} onClick={() => setSettingsTab('display')}>DISPLAY</button>
            </nav>

            <div className="pause-settings-scroll">
              {settingsTab === 'gameplay' ? <>
                <section aria-labelledby="race-settings-heading">
                  <h2 id="race-settings-heading">Race</h2>
                  <div className="settings-action-grid">
                    <button type="button" onClick={() => action(busy ? 'cancel' : 'invite')}>
                      <Flag size={15} /> {busy ? 'Leave race' : 'Start race'}
                    </button>
                    {!busy && view.best !== null && (
                      <button type="button" onClick={() => action('pb')}>Race my ghost</button>
                    )}
                    {(view.phase === 'racing' || view.phase === 'finished' || view.phase === 'countdown') && (
                      <button type="button" onClick={() => action('restart')}>Restart course</button>
                    )}
                    {!busy && view.phase !== 'invited' && (
                      <button type="button" onClick={() => action('daily')}>Daily course</button>
                    )}
                  </div>
                  {!busy && view.phase !== 'invited' && (
                    <label className="settings-row"><span><b>Scoring mode</b><small>Choose how the race is judged</small></span>
                      <select aria-label="Race scoring mode" value={mode}
                        onChange={(event) => action(`mode-${event.target.value}` as RaceAction)}>
                        <option value="speed">Speed</option>
                        <option value="style">Style</option>
                        <option value="combined">Speed + style</option>
                      </select>
                    </label>
                  )}
                </section>

                <section aria-labelledby="world-settings-heading">
                  <h2 id="world-settings-heading">World</h2>
                  <button className="settings-row settings-row-button" type="button" onClick={onNight} aria-label={night ? 'Switch to golden hour' : 'Switch to night'}>
                    <span><b>Time of day</b><small>Change the city lighting</small></span>
                    <span className="settings-value">{night ? <Sun size={15} /> : <Moon size={15} />}{night ? 'Daylight' : 'Nightfall'}</span>
                  </button>
                  <label className="settings-row"><span><b>Sky preset</b><small>Weather and atmosphere</small></span>
                    <select aria-label="Sky and snow" value={sky}
                      onChange={(event) => onSky(event.target.value as SkyPreset)}>
                      {Object.entries(SKY_PRESETS)
                        .filter(([id]) => district !== 'cyberpunk-city' || id === 'snow' || id === 'blizzard')
                        .map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
                    </select>
                  </label>
                </section>
              </> : <>
                <section aria-labelledby="camera-settings-heading">
                  <h2 id="camera-settings-heading"><Camera size={14} /> Camera</h2>
                  <label className="settings-row settings-switch">
                    <span><b>Experimental camera</b><small>Keeps Spider-Man centered</small></span>
                    <input type="checkbox" checked={experimentalCamera}
                      onChange={(event) => onExperimentalCamera(event.target.checked)} />
                  </label>
                  <label className="camera-zoom-control" data-disabled={!experimentalCamera}>
                    <span><b>Camera distance</b><small>1 is the original view</small></span>
                    <output>{cameraZoom}</output>
                    <input type="range" min="1" max="10" step="1" value={cameraZoom}
                      disabled={!experimentalCamera}
                      onChange={(event) => onCameraZoom(Number(event.target.value))} />
                    <div className="zoom-scale"><span>DEFAULT</span><span>CLOSE</span></div>
                  </label>
                </section>
                <section aria-labelledby="display-settings-heading">
                  <h2 id="display-settings-heading">Display</h2>
                  <div className="settings-static-row"><span><b>HUD style</b><small>Liquid glass</small></span><em>SPIDER HUD</em></div>
                  <div className="settings-static-row"><span><b>Motion effects</b><small>Traversal speed response</small></span><em>ON</em></div>
                </section>
              </>}
            </div>
            <footer className="pause-settings-footer">
              <button type="button" onClick={() => onOpenChange(false)}><Play size={16} /> Resume game</button>
              <small>ESC&nbsp;&nbsp; CLOSE</small>
            </footer>
          </aside>
        </div>}
      </div>
      {view.phase === 'invited' && (
        <section className="race-invitation" aria-live="polite">
          <small>LOBBY CHALLENGE</small>
          <strong>
            {view.course?.mode === 'style'
              ? 'Style challenge'
              : view.course?.mode === 'combined'
                ? 'Speed + style challenge'
                : 'Checkpoint race'}
          </strong>
          <span>
            {view.gateCount ?? view.course?.gates?.length ?? 0} gates · shared
            start · {view.countdown}s to join
          </span>
          <div>
            <button type="button" onClick={() => action('accept')}>
              Accept race
            </button>
            <button type="button" onClick={() => action('decline')}>
              Keep exploring
            </button>
          </div>
          <small>{view.message}</small>
        </section>
      )}
      {view.phase === 'inviting' && (
        <output className="race-toast">
          {view.participants} ready · launch in {view.countdown}s
        </output>
      )}
      {view.phase === 'countdown' && (
        <div className="race-countdown" aria-live="assertive">
          {view.countdown || 'GO'}
        </div>
      )}
      {view.phase === 'finished' && (
        <section className="race-results" aria-label="Race results">
          <strong>{view.message}</strong>
          {view.medal && (
            <b>
              {view.medal.toUpperCase()}
              {mode !== 'speed'
                ? ` · ${Math.round(view.styleScore ?? 0).toLocaleString()} STYLE`
                : ''}
            </b>
          )}
          {view.results.map((r, i) => (
            <div key={r.id}>
              <span>
                {i + 1}. Spider {r.id.slice(0, 4)}
              </span>
              <b>
                {formatRaceTime(r.time)}
                {mode !== 'speed'
                  ? ` · ${Math.round(r.score ?? 0).toLocaleString()}`
                  : ''}
              </b>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
