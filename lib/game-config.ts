export type SuitId = 'advanced' | 'classic' | 'miles' | 'miguel' | 'ps4' | 'symbiote' | 'ironman';

export type SuitConfig = {
  id: SuitId;
  name: string;
  universe: string;
  model: string;
  /** Rotation that makes the imported model face Three.js -Z. */
  modelYaw: number;
  /** Corrects exporters whose skinned bind-pose bounds disagree with rendered bounds. */
  visualScale?: number;
  /** Corrects exporter-local skinned pivots after bounds normalization. */
  visualOffsetX?: number;
  /** Rest-pose correction used when an asset ships in a rigid T-pose. */
  rigPreset?: 't-pose';
  traversal: 'spider' | 'ironman';
};

export const SUITS: readonly SuitConfig[] = [
  { id: 'advanced', name: 'Advanced', universe: 'Earth-616', model: '/assets/suits/advanced.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'classic', name: 'Classic', universe: 'Amazing Era', model: '/assets/suits/classic.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'miles', name: 'Miles Morales', universe: 'Earth-1610', model: '/assets/suits/miles.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'miguel', name: 'Spider-Man 2099', universe: 'Nueva York', model: '/assets/suits/miguel-2099.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'ps4', name: 'PS4 Suit', universe: 'Insomniac', model: '/assets/suits/ps4.glb', modelYaw: Math.PI * .5, rigPreset: 't-pose', traversal: 'spider' },
  { id: 'symbiote', name: 'Symbiote', universe: 'Black Suit', model: '/assets/suits/symbiote.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'ironman', name: 'Iron Man', universe: 'Mark 85', model: '/assets/suits/ironman.glb', modelYaw: Math.PI, traversal: 'ironman' },
] as const;

export type DistrictId =
  | 'new-york-city'
  | 'new-york-buildings'
  | 'street-city'
  | 'city-night'
  | 'backstreet';

export type DistrictConfig = {
  id: DistrictId;
  name: string;
  subtitle: string;
  model: string;
  collisionData?: string;
  position: [number, number, number];
  /** Local X/Z offset for a verified street-level spawn. */
  spawn?: [number, number];
  targetWidth: number;
  /** Authored source-space Y coordinate of the walkable street/floor. */
  sourceGroundY: number;
  rotation?: number;
  spawnYaw?: number;
  spawnPitch?: number;
  accent: 'red' | 'blue' | 'green';
  map: [number, number];
};

export const DISTRICTS: readonly DistrictConfig[] = [
  {
    id: 'new-york-city', name: 'New York City', subtitle: 'City Core',
    model: '/assets/districts/new-york-city-2026.glb', collisionData: '/assets/districts/new-york-city-2026-collisions.json',
    position: [0, 0, 0], spawn: [0, 0], targetWidth: 360, sourceGroundY: 0, rotation: 0, accent: 'red', map: [47, 52],
  },
  {
    id: 'new-york-buildings', name: 'New York Buildings', subtitle: 'Skyline District',
    model: '/assets/districts/new-york-buildings.glb', collisionData: '/assets/districts/new-york-buildings-collisions.json',
    position: [0, 0, 0], spawn: [0, 0], targetWidth: 280, sourceGroundY: 0.0045, rotation: 0, accent: 'blue', map: [56, 50],
  },
  {
    id: 'street-city', name: 'Street City', subtitle: 'Tower Blocks',
    model: '/assets/districts/street-city.glb', collisionData: '/assets/districts/street-city-collisions.json',
    position: [0, 0, 0], spawn: [0, 0], targetWidth: 320, sourceGroundY: 0.011, rotation: 0, accent: 'green', map: [51, 59],
  },
  {
    id: 'city-night', name: 'Spider-Man City Night', subtitle: 'Midnight Bridge',
    model: '/assets/districts/city-night.glb', collisionData: '/assets/districts/city-night-collisions.json',
    position: [0, 0, 0], spawn: [0, 105], targetWidth: 320, sourceGroundY: 0.6761, rotation: 0, accent: 'red', map: [60, 44],
  },
  {
    id: 'backstreet', name: 'Backstreet', subtitle: 'Neon Alleys',
    model: '/assets/districts/backstreet.glb', collisionData: '/assets/districts/backstreet-collisions.json',
    position: [0, 0, 0], spawn: [0, 15], targetWidth: 120, sourceGroundY: 1982.6573, rotation: 0, spawnYaw: 0, spawnPitch: .32, accent: 'green', map: [39, 45],
  },
] as const;

export const getDistrict = (id: DistrictId) => DISTRICTS.find((district) => district.id === id) ?? DISTRICTS[0];
export const getSuit = (id: SuitId) => SUITS.find((suit) => suit.id === id) ?? SUITS[0];
