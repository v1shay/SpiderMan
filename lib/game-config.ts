export type SuitId = 'advanced' | 'classic' | 'miles' | 'miguel' | 'original' | 'ps4' | 'symbiote';

export type SuitConfig = {
  id: SuitId;
  name: string;
  universe: string;
  model: string;
  /** Rotation that makes the imported model face Three.js -Z. */
  modelYaw: number;
  /** Corrects exporters whose skinned bind-pose bounds disagree with rendered bounds. */
  visualScale?: number;
};

export const SUITS: readonly SuitConfig[] = [
  { id: 'advanced', name: 'Advanced', universe: 'Earth-616', model: '/assets/suits/advanced.glb', modelYaw: Math.PI },
  { id: 'classic', name: 'Classic', universe: 'Amazing Era', model: '/assets/suits/classic.glb', modelYaw: Math.PI },
  { id: 'miles', name: 'Miles Morales', universe: 'Earth-1610', model: '/assets/suits/miles.glb', modelYaw: Math.PI },
  { id: 'miguel', name: 'Spider-Man 2099', universe: 'Nueva York', model: '/assets/suits/miguel-2099.glb', modelYaw: Math.PI },
  { id: 'original', name: 'Webbed Suit', universe: 'The Original', model: '/assets/suits/original.glb', modelYaw: Math.PI },
  { id: 'ps4', name: 'PS4 Suit', universe: 'Insomniac', model: '/assets/suits/ps4.glb', modelYaw: Math.PI, visualScale: .68 },
  { id: 'symbiote', name: 'Symbiote', universe: 'Black Suit', model: '/assets/suits/symbiote.glb', modelYaw: Math.PI },
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
  targetWidth: number;
  rotation?: number;
  accent: 'red' | 'blue' | 'green';
  map: [number, number];
};

/** Measured placements for each supplied city asset on one connected grid. */
export const DISTRICTS: readonly DistrictConfig[] = [
  { id: 'times-square', name: 'Times Square', subtitle: 'The Crossroads', model: '/assets/districts/times-square.glb', position: [205, 0, -310], targetWidth: 190, rotation: -.16, accent: 'red', map: [49, 43] },
  { id: 'street-city', name: 'Midtown', subtitle: 'Street City', model: '/assets/districts/street-city.glb', position: [-330, 0, -170], targetWidth: 230, rotation: Math.PI * .5, accent: 'blue', map: [38, 36] },
  { id: 'new-york-buildings', name: "Hell's Kitchen", subtitle: 'West Side', model: '/assets/districts/new-york-buildings.glb', position: [330, 0, -170], targetWidth: 230, rotation: -Math.PI * .35, accent: 'green', map: [60, 36] },
  { id: 'manhattan', name: 'Manhattan', subtitle: 'Central Grid', model: '/assets/districts/manhattan.glb', position: [0, 0, -520], targetWidth: 340, rotation: Math.PI * .5, accent: 'blue', map: [49, 23] },
  { id: 'manhattan-bridge', name: 'Manhattan Bridge', subtitle: 'East River', model: '/assets/districts/manhattan-bridge.glb', position: [500, 0, -510], targetWidth: 380, rotation: -Math.PI * .1, accent: 'red', map: [72, 29] },
  { id: 'city-night', name: 'Brooklyn Night', subtitle: 'Neon Borough', model: '/assets/districts/city-night.glb', position: [-500, 0, -510], targetWidth: 360, rotation: Math.PI * .72, accent: 'green', map: [25, 28] },
  { id: 'downtown', name: 'Downtown', subtitle: 'Financial District', model: '/assets/districts/downtown.glb', position: [-500, 0, 460], targetWidth: 520, rotation: Math.PI * .05, accent: 'red', map: [29, 73] },
  { id: 'uptown', name: 'Uptown', subtitle: 'Upper Manhattan', model: '/assets/districts/uptown.glb', position: [500, 0, 460], targetWidth: 520, rotation: Math.PI * 1.03, accent: 'blue', map: [69, 72] },
  { id: 'backstreet', name: 'Backstreet', subtitle: 'Warehouse Row', model: '/assets/districts/backstreet.glb', position: [0, 0, 330], targetWidth: 220, rotation: Math.PI, accent: 'green', map: [49, 62] },
] as const;

export const getDistrict = (id: DistrictId) => DISTRICTS.find((district) => district.id === id) ?? DISTRICTS[0];
export const getSuit = (id: SuitId) => SUITS.find((suit) => suit.id === id) ?? SUITS[0];
