export type SuitId = 'advanced' | 'classic' | 'miles' | 'miguel' | 'original';

export const SUITS = [
  { id: 'advanced', name: 'Advanced', universe: 'Earth-616', image: '/assets/previews/spiderman_rigged.png', model: '/assets/suits/advanced.glb' },
  { id: 'classic', name: 'Classic', universe: 'Amazing Era', image: '/assets/previews/spiderman_classic_textured_rigged.png', model: '/assets/suits/classic.glb' },
  { id: 'miles', name: 'Miles Morales', universe: 'Earth-1610', image: '/assets/previews/miles_morales_spiderman_rigged.png', model: '/assets/suits/miles.glb' },
  { id: 'miguel', name: 'Spider-Man 2099', universe: 'Nueva York', image: '/assets/previews/miguel_ohara_spiderman_2099_rigged_textured.png', model: '/assets/suits/miguel-2099.glb' },
  { id: 'original', name: 'Webbed Suit', universe: 'The Original', image: '/assets/previews/spiderman_original.png', model: '/assets/suits/original.glb' },
] as const;

export type DistrictId =
  | 'times-square'
  | 'street-city'
  | 'new-york-buildings'
  | 'manhattan'
  | 'manhattan-bridge'
  | 'city-night'
  | 'downtown'
  | 'uptown';

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

export const DISTRICTS: readonly DistrictConfig[] = [
  { id: 'times-square', name: 'Times Square', subtitle: 'The Crossroads', model: '/assets/districts/times-square.glb', position: [0, 0, -180], targetWidth: 430, accent: 'red', map: [49, 47] },
  { id: 'street-city', name: 'Midtown', subtitle: 'Street City', model: '/assets/districts/street-city.glb', position: [-470, 0, -70], targetWidth: 430, rotation: Math.PI * .5, accent: 'blue', map: [40, 39] },
  { id: 'new-york-buildings', name: "Hell's Kitchen", subtitle: 'West Side', model: '/assets/districts/new-york-buildings.glb', position: [440, 0, -90], targetWidth: 380, rotation: -Math.PI * .35, accent: 'green', map: [56, 38] },
  { id: 'manhattan', name: 'Manhattan', subtitle: 'Central Grid', model: '/assets/districts/manhattan.glb', position: [0, 0, -610], targetWidth: 610, rotation: Math.PI * .5, accent: 'blue', map: [49, 27] },
  { id: 'manhattan-bridge', name: 'Manhattan Bridge', subtitle: 'East River', model: '/assets/districts/manhattan-bridge.glb', position: [620, 0, -570], targetWidth: 650, rotation: -Math.PI * .1, accent: 'red', map: [71, 30] },
  { id: 'city-night', name: 'Brooklyn Night', subtitle: 'Neon Borough', model: '/assets/districts/city-night.glb', position: [-630, 0, -610], targetWidth: 520, rotation: Math.PI * .72, accent: 'green', map: [26, 26] },
  { id: 'downtown', name: 'Downtown', subtitle: 'Financial District', model: '/assets/districts/downtown.glb', position: [-580, 0, 580], targetWidth: 1050, rotation: Math.PI * .05, accent: 'red', map: [34, 68] },
  { id: 'uptown', name: 'Uptown', subtitle: 'Upper Manhattan', model: '/assets/districts/uptown.glb', position: [590, 0, 590], targetWidth: 1050, rotation: Math.PI * 1.03, accent: 'blue', map: [65, 70] },
] as const;

export const getDistrict = (id: DistrictId) => DISTRICTS.find((district) => district.id === id) ?? DISTRICTS[0];
export const getSuit = (id: SuitId) => SUITS.find((suit) => suit.id === id) ?? SUITS[0];
