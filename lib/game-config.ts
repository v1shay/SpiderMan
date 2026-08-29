export type SuitId = 'advanced' | 'classic' | 'miles' | 'miguel' | 'original' | 'ps4' | 'symbiote' | 'ironman';

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
  traversal: 'spider' | 'ironman';
};

export const SUITS: readonly SuitConfig[] = [
  { id: 'advanced', name: 'Advanced', universe: 'Earth-616', model: '/assets/suits/advanced.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'classic', name: 'Classic', universe: 'Amazing Era', model: '/assets/suits/classic.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'miles', name: 'Miles Morales', universe: 'Earth-1610', model: '/assets/suits/miles.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'miguel', name: 'Spider-Man 2099', universe: 'Nueva York', model: '/assets/suits/miguel-2099.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'original', name: 'Webbed Suit', universe: 'The Original', model: '/assets/suits/original.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'ps4', name: 'PS4 Suit', universe: 'Insomniac', model: '/assets/suits/ps4.glb', modelYaw: Math.PI * .5, visualOffsetX: -1.48, traversal: 'spider' },
  { id: 'symbiote', name: 'Symbiote', universe: 'Black Suit', model: '/assets/suits/symbiote.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'ironman', name: 'Iron Man', universe: 'Mark 85', model: '/assets/suits/ironman.glb', modelYaw: Math.PI, traversal: 'ironman' },
] as const;

export type DistrictId =
  | 'times-square'
  | 'street-city'
  | 'new-york-buildings'
  | 'manhattan'
  | 'manhattan-bridge'
  | 'city-night'
  | 'downtown'
  | 'uptown'
  | 'backstreet';

export type DistrictConfig = {
  id: DistrictId;
  name: string;
  subtitle: string;
  model: string;
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

/**
 * The supplied full-city scan is the traversal world. Its original 15.5 km
 * footprint was previously normalized to 520 units, which reduced even the
 * tallest buildings to roughly 15 units. At 6000 units the same geometry has
 * believable 40–175 unit buildings and several kilometres of swing space.
 */
export const DISTRICTS: readonly DistrictConfig[] = [
  { id: 'backstreet', name: 'New York City', subtitle: 'Full-Scale Manhattan', model: '/assets/districts/downtown.glb', position: [0, 0, 0], spawn: [0, 0], targetWidth: 6000, sourceGroundY: 29.92676, rotation: 0, accent: 'green', map: [49, 52] },
] as const;

export const getDistrict = (id: DistrictId) => DISTRICTS.find((district) => district.id === id) ?? DISTRICTS[0];
export const getSuit = (id: SuitId) => SUITS.find((suit) => suit.id === id) ?? SUITS[0];
