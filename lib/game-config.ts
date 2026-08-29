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

export type DistrictId = 'new-york-city' | 'new-york-blvd';

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
  accent: 'red' | 'blue' | 'green';
  map: [number, number];
};

export const DISTRICTS: readonly DistrictConfig[] = [
  {
    id: 'new-york-city', name: 'New York City', subtitle: 'City Core',
    model: '/assets/districts/new-york-city-2026.glb', collisionData: '/assets/districts/new-york-city-2026-collisions.json',
    position: [0, 0, 0], spawn: [0, 0], targetWidth: 1200, sourceGroundY: 0, rotation: 0, accent: 'red', map: [47, 52],
  },
  {
    id: 'new-york-blvd', name: 'New York BLVD', subtitle: 'Boulevard Scan',
    model: '/assets/districts/new-york-blvd.glb', collisionData: '/assets/districts/new-york-blvd-collisions.json',
    position: [0, 0, 0], spawn: [0, 0], targetWidth: 1200, sourceGroundY: 74, rotation: 0, accent: 'blue', map: [55, 47],
  },
] as const;

export const getDistrict = (id: DistrictId) => DISTRICTS.find((district) => district.id === id) ?? DISTRICTS[0];
export const getSuit = (id: SuitId) => SUITS.find((suit) => suit.id === id) ?? SUITS[0];
