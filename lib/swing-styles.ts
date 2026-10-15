import type { SuitId } from './game-config.ts';
import type { TraversalConfig } from './traversal-physics.ts';

export type SwingStyleId = Extract<
  SuitId,
  | 'miguel'
  | 'miles-new'
  | 'miles-animated'
  | 'no-way-home'
  | 'homecoming-tech'
  | 'classic-spider'
  | 'tobey'
  | 'symbiote-ps5'
  | 'amazing'
  | 'pavitr-prabhakar'
  | 'spider-woman-atsv'
  | 'classic-suit'
>;

export type SwingAnimationStyle = {
  swingVariants: readonly ('swing-a' | 'swing-b' | 'swing-style')[];
  tricks: readonly string[];
  releaseTrickChance: number;
  trickInterval: number;
};

export type SwingStyleProfile = {
  id: SwingStyleId;
  label: string;
  character: string;
  description: string;
  tuning: Partial<TraversalConfig>;
  animation: SwingAnimationStyle;
};

/** Hand-tuned signatures. Values stay inside the shared collision/assist
 * solver, so a style changes expression without gaining collision privileges. */
export const SWING_STYLES: readonly SwingStyleProfile[] = [
  {
    id: 'miguel',
    label: '2099 Power Dive',
    character: 'Spider-Man 2099',
    description: 'Heavy, fast descents with long momentum and restrained tricks.',
    tuning: {
      maximumSpeed: 118,
      swingMaximumLength: 128,
      anchorMaximumDistance: 150,
      swingPumpAcceleration: 62,
      swingSteerAcceleration: 12,
      swingSpring: 70,
      swingDamping: 11,
      swingReleaseForwardScale: 1.15,
      swingReleaseLiftScale: 0.86,
      maximumFov: 96,
      cameraMotionScale: 1.12,
    },
    animation: {
      swingVariants: ['swing-a', 'swing-b'],
      tricks: ['Front Twist Flip', 'Corkscrew Evade', 'Running Forward Flip'],
      releaseTrickChance: 0.3,
      trickInterval: 2.6,
    },
  },
  {
    id: 'miles-new',
    label: 'Miles Bounce',
    character: 'Miles · Across the Spider-Verse',
    description: 'Shorter arcs, huge release lift, loose steering, and frequent flips.',
    tuning: {
      maximumSpeed: 106,
      swingMaximumLength: 92,
      anchorMaximumDistance: 122,
      swingPumpAcceleration: 55,
      swingSteerAcceleration: 20,
      swingSpring: 58,
      swingDamping: 8,
      swingReleaseForwardScale: 0.84,
      swingReleaseLiftScale: 1.28,
      maximumFov: 94,
      cameraMotionScale: 1.08,
    },
    animation: {
      swingVariants: ['swing-style', 'swing-b', 'swing-style'],
      tricks: ['Backflip', 'Front Twist Flip', 'Butterfly Twirl', 'Aerial Evade'],
      releaseTrickChance: 0.92,
      trickInterval: 0.9,
    },
  },
  {
    id: 'miles-animated',
    label: 'Leap of Faith',
    character: 'Miles · Into the Spider-Verse',
    description: 'Floaty and expressive with high arcs and the most aerial variation.',
    tuning: {
      maximumSpeed: 101,
      swingMaximumLength: 100,
      anchorMaximumDistance: 128,
      swingPumpAcceleration: 52,
      swingSteerAcceleration: 22,
      swingSpring: 55,
      swingDamping: 7.5,
      swingReleaseForwardScale: 0.9,
      swingReleaseLiftScale: 1.2,
      maximumFov: 92,
      cameraMotionScale: 0.96,
    },
    animation: {
      swingVariants: ['swing-style', 'swing-a', 'swing-style'],
      tricks: ['Backflip', 'Butterfly Twirl', 'Big Jump', 'Front Twist Flip'],
      releaseTrickChance: 1,
      trickInterval: 0.72,
    },
  },
  {
    id: 'no-way-home',
    label: 'Integrated Precision',
    character: 'No Way Home',
    description: 'Balanced speed with deliberate steering and clean, controlled releases.',
    tuning: {
      maximumSpeed: 110,
      swingMaximumLength: 118,
      anchorMaximumDistance: 142,
      swingPumpAcceleration: 57,
      swingSteerAcceleration: 18,
      swingSpring: 66,
      swingDamping: 10,
      swingReleaseForwardScale: 1.02,
      swingReleaseLiftScale: 1,
      maximumFov: 94,
      cameraMotionScale: 0.98,
    },
    animation: {
      swingVariants: ['swing-a', 'swing-b', 'swing-style'],
      tricks: ['Front Flip', 'Running Forward Flip', 'Backflip'],
      releaseTrickChance: 0.56,
      trickInterval: 1.55,
    },
  },
  {
    id: 'homecoming-tech',
    label: 'Neighborhood Snap',
    character: 'Homecoming',
    description: 'Tight webs, quick direction changes, and compact energetic flips.',
    tuning: {
      maximumSpeed: 104,
      swingMaximumLength: 86,
      anchorMaximumDistance: 118,
      swingPumpAcceleration: 60,
      swingSteerAcceleration: 25,
      swingSpring: 76,
      swingDamping: 12,
      swingReleaseForwardScale: 0.93,
      swingReleaseLiftScale: 1.12,
      maximumFov: 93,
      cameraMotionScale: 1.04,
    },
    animation: {
      swingVariants: ['swing-b', 'swing-style', 'swing-b'],
      tricks: ['Front Flip', 'Aerial Evade', 'Backflip'],
      releaseTrickChance: 0.76,
      trickInterval: 1.05,
    },
  },
  {
    id: 'classic-spider',
    label: 'Homemade Hustle',
    character: 'Alt Homecoming',
    description: 'Quick, scrappy, lower-speed swings with lots of manual correction.',
    tuning: {
      maximumSpeed: 96,
      swingMaximumLength: 82,
      anchorMaximumDistance: 112,
      swingPumpAcceleration: 50,
      swingSteerAcceleration: 27,
      swingSpring: 72,
      swingDamping: 12,
      swingReleaseForwardScale: 0.86,
      swingReleaseLiftScale: 1.08,
      maximumFov: 90,
      cameraMotionScale: 0.88,
    },
    animation: {
      swingVariants: ['swing-a', 'swing-b'],
      tricks: ['Front Flip', 'Run To Flip', 'Aerial Evade'],
      releaseTrickChance: 0.48,
      trickInterval: 1.7,
    },
  },
  {
    id: 'tobey',
    label: 'Raimi Momentum',
    character: 'Spider-Man 2002',
    description: 'Weighty, slower steering with long pendulum arcs and fewer flips.',
    tuning: {
      maximumSpeed: 99,
      swingMaximumLength: 132,
      anchorMaximumDistance: 152,
      swingPumpAcceleration: 48,
      swingSteerAcceleration: 10,
      swingSpring: 74,
      swingDamping: 13,
      swingReleaseForwardScale: 1.12,
      swingReleaseLiftScale: 0.82,
      maximumFov: 91,
      cameraMotionScale: 0.86,
    },
    animation: {
      swingVariants: ['swing-a', 'swing-b'],
      tricks: ['Front Flip', 'Running Forward Flip'],
      releaseTrickChance: 0.18,
      trickInterval: 3.1,
    },
  },
  {
    id: 'symbiote-ps5',
    label: 'Symbiote Surge',
    character: 'Symbiote Suit',
    description: 'The fastest, most aggressive line with hard pumps and violent releases.',
    tuning: {
      maximumSpeed: 126,
      swingMaximumLength: 122,
      anchorMaximumDistance: 152,
      swingPumpAcceleration: 72,
      swingSteerAcceleration: 14,
      swingSpring: 78,
      swingDamping: 9,
      swingReleaseForwardScale: 1.3,
      swingReleaseLiftScale: 0.9,
      maximumFov: 100,
      cameraMotionScale: 1.22,
    },
    animation: {
      swingVariants: ['swing-style', 'swing-a'],
      tricks: ['Corkscrew Evade', 'Front Twist Flip', 'Running Forward Flip'],
      releaseTrickChance: 0.38,
      trickInterval: 2.2,
    },
  },
  {
    id: 'amazing',
    label: 'Amazing Long Arc',
    character: 'The Amazing Spider-Man',
    description: 'Maximum reach and forward release distance with broad graceful turns.',
    tuning: {
      maximumSpeed: 121,
      swingMaximumLength: 142,
      anchorMaximumDistance: 164,
      swingPumpAcceleration: 64,
      swingSteerAcceleration: 15,
      swingSpring: 62,
      swingDamping: 8,
      swingReleaseForwardScale: 1.34,
      swingReleaseLiftScale: 0.94,
      maximumFov: 97,
      cameraMotionScale: 1.12,
    },
    animation: {
      swingVariants: ['swing-b', 'swing-style', 'swing-a'],
      tricks: ['Running Forward Flip', 'Front Twist Flip', 'Butterfly Twirl'],
      releaseTrickChance: 0.64,
      trickInterval: 1.35,
    },
  },
  {
    id: 'pavitr-prabhakar',
    label: 'Mumbattan Acrobat',
    character: 'Pavitr Prabhakar',
    description: 'Bouncy rhythmic releases, fast steering, and near-constant acrobatics.',
    tuning: {
      maximumSpeed: 112,
      swingMaximumLength: 96,
      anchorMaximumDistance: 126,
      swingPumpAcceleration: 63,
      swingSteerAcceleration: 24,
      swingSpring: 57,
      swingDamping: 7,
      swingReleaseForwardScale: 0.9,
      swingReleaseLiftScale: 1.3,
      maximumFov: 95,
      cameraMotionScale: 1.14,
    },
    animation: {
      swingVariants: ['swing-style', 'swing-b', 'swing-style'],
      tricks: ['Backflip', 'Butterfly Twirl', 'Corkscrew Evade', 'Front Twist Flip'],
      releaseTrickChance: 1,
      trickInterval: 0.62,
    },
  },
  {
    id: 'spider-woman-atsv',
    label: 'Spider-Woman Glide',
    character: 'Spider-Woman',
    description: 'Smooth, stable speed with long hang time and minimal oversteer.',
    tuning: {
      maximumSpeed: 113,
      swingMaximumLength: 124,
      anchorMaximumDistance: 146,
      swingPumpAcceleration: 54,
      swingSteerAcceleration: 17,
      swingSpring: 60,
      swingDamping: 11,
      swingReleaseForwardScale: 1.08,
      swingReleaseLiftScale: 1.1,
      maximumFov: 93,
      cameraMotionScale: 0.9,
    },
    animation: {
      swingVariants: ['swing-b', 'swing-a', 'swing-b'],
      tricks: ['Aerial Evade', 'Butterfly Twirl', 'Front Flip'],
      releaseTrickChance: 0.42,
      trickInterval: 2,
    },
  },
  {
    id: 'classic-suit',
    label: 'Classic Balance',
    character: 'Classic Spider-Man',
    description: 'The iconic all-rounder: readable arcs, balanced height, speed, and tricks.',
    tuning: {
      maximumSpeed: 108,
      swingMaximumLength: 120,
      anchorMaximumDistance: 145,
      swingPumpAcceleration: 58,
      swingSteerAcceleration: 17,
      swingSpring: 64,
      swingDamping: 10,
      swingReleaseForwardScale: 1,
      swingReleaseLiftScale: 1,
      maximumFov: 94,
      cameraMotionScale: 1,
    },
    animation: {
      swingVariants: ['swing-a', 'swing-b', 'swing-style'],
      tricks: ['Backflip', 'Front Flip', 'Front Twist Flip', 'Running Forward Flip'],
      releaseTrickChance: 0.58,
      trickInterval: 1.45,
    },
  },
] as const;

const styles = new Map(SWING_STYLES.map((style) => [style.id, style]));

export const isSwingStyleId = (value: unknown): value is SwingStyleId =>
  typeof value === 'string' && styles.has(value as SwingStyleId);

export const swingStyleForSuit = (suitId: SuitId): SwingStyleId =>
  isSwingStyleId(suitId) ? suitId : 'classic-suit';

export const getSwingStyle = (id: SwingStyleId): SwingStyleProfile =>
  styles.get(id) ?? styles.get('classic-suit')!;
