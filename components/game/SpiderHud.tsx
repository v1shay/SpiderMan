'use client';

import Image from 'next/image';
import { Radio } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import type { GameHud } from './SpiderGame';
import type { MultiplayerStatus } from '@/lib/multiplayer';
import { SUITS, type SuitId } from '@/lib/game-config';
import { BOSS_DEFINITIONS } from '@/lib/boss-definitions';

type Props = {
  suitId: SuitId;
  suitName: string;
  districtName: string;
  hud: GameHud;
  online: { count: number; status: MultiplayerStatus };
  ironMan: boolean;
  onSuitChange: (id: SuitId) => void;
};

type RecommendedMove = { key: string; label: string };

type StatusBannerProps = {
  className?: string;
  portrait: string;
  portraitAlt: string;
  name: string;
  percent: number;
  detail: string;
  detailStatus?: MultiplayerStatus;
  onPortraitClick?: () => void;
  expanded?: boolean;
};

/** One banner geometry for free traversal and encounters. */
function StatusBanner({ className = '', portrait, portraitAlt, name, percent, detail,
  detailStatus = 'online', onPortraitClick, expanded }: StatusBannerProps) {
  const portraitImage = (
    <Image src={portrait} alt={portraitAlt} width={104} height={104} unoptimized />
  );
  return (
    <aside className={`hero-status ${className}`.trim()} aria-label={`${name} status`}>
      <div className="hero-status-pulse" aria-hidden="true" />
      {onPortraitClick ? (
        <button className="hero-status-portrait" type="button" onClick={onPortraitClick}
          aria-expanded={expanded} aria-label={`Quick switch ${name}`}>
          {portraitImage}
        </button>
      ) : <div className="hero-status-portrait" aria-hidden="true">{portraitImage}</div>}
      <div className="hero-status-data">
        <strong className="hero-banner-name">{name}</strong>
        <div className="hero-energy" aria-label={`${name} health ${Math.ceil(percent)} percent`}>
          {Array.from({ length: 6 }, (_, index) => (
            <i key={index} style={{ opacity: percent > index * 100 / 6 ? 1 : .16 }} />
          ))}
          <b>{Math.ceil(percent)}%</b>
        </div>
        <div className="hero-subsystem">
          <i aria-hidden="true" />
          <span />
          <span />
          <div className="hero-network" data-status={detailStatus}>
            <Radio aria-hidden="true" /> {detail}
          </div>
        </div>
      </div>
    </aside>
  );
}

function recommendedMove(hud: GameHud, ironMan: boolean): RecommendedMove {
  if (ironMan)
    return hud.mode === 'jump' || hud.mode === 'fall'
      ? { key: 'F', label: 'Repulsor hover' }
      : { key: 'Click', label: 'Flight boost' };
  if (hud.chargeLabel === 'SLINGSHOT CHARGE')
    return { key: 'X', label: 'Release slingshot' };
  if (hud.chargeLabel === 'CHARGE JUMP')
    return { key: 'C', label: 'Release charge jump' };
  if (hud.chargeLabel === 'WEB TENSION')
    return { key: 'Click', label: 'Release swing' };

  switch (hud.mode) {
    case 'glide':
      return { key: 'W', label: 'Web-wing dive' };
    case 'swing':
      return { key: 'Space', label: 'Web kick' };
    case 'wallRun':
      return { key: 'Space', label: 'Wall jump' };
    case 'wallCrawl':
      return { key: 'Q', label: 'Release wall' };
    case 'webZip':
      return { key: 'Space', label: 'Point launch' };
    case 'mantle':
      return { key: 'Space', label: 'Vault jump' };
    case 'dive':
      return { key: 'Click', label: 'Dive recovery swing' };
    case 'jump':
    case 'fall':
    case 'doubleJump':
    case 'wallJump':
      return { key: 'Click', label: 'Web swing' };
    default:
      return { key: 'Space', label: 'Jump' };
  }
}

function readableMode(mode: string): string {
  return mode.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}

export function SpiderHud({
  suitId,
  suitName,
  districtName,
  hud,
  online,
  ironMan,
  onSuitChange,
}: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const move = recommendedMove(hud, ironMan);
  const health = Math.ceil(hud.boss?.playerHealth ?? 100);
  const abilityLevel = Math.max(
    1,
    Math.min(
      5,
      hud.charge > 0 ? Math.ceil(hud.charge * 5) : hud.swinging ? 5 : 3,
    ),
  );
  const onlineText =
    online.status === 'online'
      ? `${online.count}`
      : online.status === 'error' || online.status === 'disabled'
        ? '1'
        : '…';
  const trickStyle = {
    '--trick-accent':
      hud.announcement?.kind === 'impact' ? '#ff3650' : '#58eaff',
  } as CSSProperties;

  if (hud.boss) {
    const boss = hud.boss;
    const definition = BOSS_DEFINITIONS[boss.id];
    const bossPercent = Math.max(0, boss.health / boss.maxHealth * 100);
    const playerPercent = Math.max(0, boss.playerHealth);
    const warning = boss.attack?.stage === 'startup'
      ? boss.attack.label
      : boss.attack?.stage === 'active'
        ? 'DODGE NOW'
        : boss.attack?.stage === 'recovery'
          ? 'COUNTER WINDOW'
          : boss.objective;
    const prompt = boss.attack?.stage === 'startup' || boss.attack?.stage === 'active'
      ? { key: 'J', label: 'Dodge' }
      : boss.attack?.stage === 'recovery'
        ? { key: 'K', label: 'Counter' }
        : { key: 'K', label: 'Attack' };
    return (
      <div className="spider-hud boss-mode" style={{ '--boss-accent': definition.accent } as CSSProperties}>
        <StatusBanner className="encounter-villain" portrait={definition.portrait}
          portraitAlt={`${boss.name} portrait`} name={boss.name} percent={bossPercent}
          detail={`PHASE ${boss.phase} · ${definition.subtitle}`} />
        <StatusBanner className="encounter-player" portrait={`/assets/previews/suits/${suitId}.png`}
          portraitAlt={`${suitName} portrait`} name={suitName} percent={playerPercent}
          detail={`SPIDER-MAN · ${districtName}`} />
        <output className={`boss-combat-cue stage-${boss.attack?.stage ?? 'idle'}`} aria-live="polite">
          {boss.cinematic === 'intro' && <small>ENCOUNTER</small>}
          <strong>{boss.cinematic === 'intro' ? boss.name : warning}</strong>
          {boss.attack && <span>{boss.attack.stage === 'startup' ? 'READ THE TELL' : boss.attack.stage === 'recovery' ? 'STRIKE · K' : 'J · EVADE'}</span>}
        </output>
        <aside className="boss-controls" aria-label="Combat controls">
          <strong><span>{prompt.label}</span><kbd>{prompt.key}</kbd></strong>
          <div className="boss-control-grid">
            <span><kbd>K</kbd> light</span>
            <span><kbd>L</kbd> heavy</span>
            <span><kbd>I</kbd> launch</span>
            <span><kbd>U</kbd> grab</span>
            <span><kbd>O</kbd> block</span>
            <span><kbd>J</kbd> dodge</span>
            <span><kbd>H</kbd> web pull</span>
            <span><kbd>Y</kbd> taunt</span>
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="spider-hud" data-mode={hud.mode}>
      <StatusBanner portrait={`/assets/previews/suits/${suitId}.png`}
        portraitAlt={`${suitName} portrait`} name={suitName} percent={health}
        detail={`${onlineText} PLAYER`} detailStatus={online.status}
        onPortraitClick={() => setSwitcherOpen((open) => !open)} expanded={switcherOpen} />

      {switcherOpen && (
        <nav className="quick-suit-switcher" aria-label="Quick switch suit">
          {SUITS.map((suit) => (
            <button
              key={suit.id}
              type="button"
              data-selected={suit.id === suitId}
              onClick={() => {
                setSwitcherOpen(false);
                onSuitChange(suit.id);
              }}
              aria-label={`Switch to ${suit.name}`}
            >
              <Image
                src={`/assets/previews/suits/${suit.id}.png`}
                alt=""
                width={52}
                height={52}
                unoptimized
              />
              <span>{suit.name}</span>
            </button>
          ))}
        </nav>
      )}

      <aside className="hud-ability-strip" aria-label="Traversal ability">
        <div className="hud-ability-segments" aria-hidden="true">
          {Array.from({ length: 5 }, (_, index) => (
            <i key={index} data-active={index < abilityLevel} />
          ))}
        </div>
        <strong>{readableMode(hud.mode || 'ready')}</strong>
      </aside>

      <div className="reticle" aria-hidden="true">
        <span />
        <i />
      </div>

      <aside className="recommended-move" aria-label="Recommended move">
        <span>{move.label}</span>
        <kbd>{move.key}</kbd>
      </aside>

      {hud.announcement && (
        <output
          key={hud.announcement.id}
          className="corner-trick"
          style={trickStyle}
          aria-live="polite"
        >
          <strong data-text={hud.announcement.label}>
            {hud.announcement.label}
          </strong>
          <span>
            x{hud.announcement.multiplier} +
            {hud.announcement.score.toLocaleString()}
          </span>
        </output>
      )}
    </div>
  );
}
