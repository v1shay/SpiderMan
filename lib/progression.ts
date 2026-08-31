import type { SuitConfig } from '@/lib/game-config';

const STORAGE_KEY = 'spiderman-progression-v1';
const PROGRESSION_EVENT = 'spiderman-progression';

export type PlayerProgress = {
  version: 1;
  swingAttachments: number;
};

export const emptyProgress = (): PlayerProgress => ({ version: 1, swingAttachments: 0 });
let memoryProgress = emptyProgress();

const cleanCount = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
  ? Math.max(0, Math.min(1_000_000, Math.floor(value)))
  : 0;

export function readProgress(): PlayerProgress {
  if (typeof window === 'undefined') return emptyProgress();
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return memoryProgress;
    const parsed = JSON.parse(stored) as Partial<PlayerProgress>;
    memoryProgress = { version: 1, swingAttachments: cleanCount(parsed.swingAttachments) };
    return memoryProgress;
  } catch {
    return memoryProgress;
  }
}

export function addSwingAttachment(): PlayerProgress {
  const current = readProgress();
  const next = { version: 1 as const, swingAttachments: cleanCount(current.swingAttachments + 1) };
  memoryProgress = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage-blocked/private sessions can still unlock heroes for this run.
  }
  window.dispatchEvent(new CustomEvent<PlayerProgress>(PROGRESSION_EVENT, { detail: next }));
  return next;
}

export const isSuitUnlocked = (suit: SuitConfig, progress: PlayerProgress) =>
  !suit.unlockSwings || progress.swingAttachments >= suit.unlockSwings;

export const swingsRemaining = (suit: SuitConfig, progress: PlayerProgress) =>
  Math.max(0, (suit.unlockSwings ?? 0) - progress.swingAttachments);

export const progressionEventName = PROGRESSION_EVENT;
