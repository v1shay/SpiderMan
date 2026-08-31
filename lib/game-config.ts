export type SuitId =
  | 'tobey'
  | 'spider-rigged'
  | 'miles'
  | 'miguel'
  | 'pavitr'
  | 'playstation'
  | 'symbiote'
  | 'iron-spider'
  | 'spider-woman'
  | 'ironman';

export type SuitConfig = {
  id: SuitId;
  name: string;
  universe: string;
  model: string;
  /** Rotation that makes the imported model face Three.js -Z. */
  modelYaw: number;
  /** Optional full exporter correction, applied to the non-animated model root. */
  modelRotation?: [number, number, number];
  /** Corrects exporters whose skinned bind-pose bounds disagree with rendered bounds. */
  visualScale?: number;
  /** Corrects exporter-local skinned pivots after bounds normalization. */
  visualOffsetX?: number;
  /** Corrects animation-space foot height after bounds normalization. */
  visualOffsetY?: number;
  /** Rest-pose correction used when an asset ships in a rigid T-pose. */
  rigPreset?: 't-pose';
  /** A rigged traversal library used only to fill missing authored states. */
  animationSource?: string;
  /** Removes an exporter-authored static duplicate of the skinned character. */
  discardRigidMeshes?: boolean;
  /** Measure the human silhouette instead of exporter props/appendages. */
  normalizationMesh?: string;
  normalizationExcludeBones?: string;
  hiddenMeshes?: readonly string[];
  unlockSwings?: number;
  traversal: 'spider' | 'ironman';
};

const traversalLibrary = '/assets/suits/spider-rigged.glb';

export const SUITS: readonly SuitConfig[] = [
  { id: 'tobey', name: 'Tobey Maguire', universe: 'Raimi Trilogy', model: '/assets/suits/tobey.glb', modelYaw: Math.PI, animationSource: traversalLibrary, traversal: 'spider' },
  { id: 'spider-rigged', name: 'Spider-Man', universe: 'Classic Rigged', model: traversalLibrary, modelYaw: Math.PI, traversal: 'spider' },
  { id: 'miles', name: 'Miles Morales', universe: 'Earth-1610', model: '/assets/suits/miles.glb', modelYaw: Math.PI, animationSource: traversalLibrary, discardRigidMeshes: true, traversal: 'spider' },
  { id: 'miguel', name: 'Spider-Man 2099', universe: 'Nueva York', model: '/assets/suits/miguel-2099.glb', modelYaw: Math.PI, animationSource: traversalLibrary, traversal: 'spider' },
  // Pavitr must use his own animation pack, never the shared retargeted library.
  { id: 'pavitr', name: 'Pavitr Prabhakar', universe: 'Mumbattan', model: '/assets/suits/pavitr.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'playstation', name: 'PlayStation Spider-Man', universe: 'Insomniac', model: '/assets/suits/playstation.glb', modelYaw: Math.PI, animationSource: traversalLibrary, traversal: 'spider' },
  { id: 'symbiote', name: 'Symbiote', universe: 'Black Suit', model: '/assets/suits/symbiote.glb', modelYaw: Math.PI, traversal: 'spider' },
  { id: 'iron-spider', name: 'Iron Spider', universe: 'Armored Suit', model: '/assets/suits/iron-spider.glb', modelYaw: Math.PI, normalizationMesh: 'Object_6', normalizationExcludeBones: 'bone180|shengzi', hiddenMeshes: ['Object_8', 'Object_9', 'Object_10'], animationSource: traversalLibrary, traversal: 'spider' },
  { id: 'spider-woman', name: 'Spider-Woman', universe: 'Spider-Verse', model: '/assets/suits/spider-woman.glb', modelYaw: Math.PI, animationSource: traversalLibrary, unlockSwings: 50, traversal: 'spider' },
  { id: 'ironman', name: 'Iron Man', universe: 'Ultimate Alliance', model: '/assets/suits/ironman-mua.glb', modelYaw: Math.PI / 2, traversal: 'ironman' },
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
  /** Minimum horizontal clearance around the authored spawn, in game meters. */
  spawnClearance?: number;
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
    id: 'new-york-buildings', name: 'New York Buildings', subtitle: 'Landmark Swing District',
    model: '/assets/districts/new-york-buildings.glb', collisionData: '/assets/districts/new-york-buildings-collisions.json',
    position: [0, 0, 0], spawn: [0, -205], targetWidth: 280, sourceGroundY: 0.0045, rotation: 0,
    spawnYaw: Math.PI, spawnClearance: 5, accent: 'blue', map: [56, 50],
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
    // This source file has enormous/corrupt bounds. A 12 m normalized width
    // makes its authored doors roughly human scale; the previous 120 m value
    // made a doorway read like a multi-storey wall.
    position: [0, 0, 0], spawn: [0, 5], targetWidth: 12, sourceGroundY: 1982.6573, rotation: 0, spawnYaw: 0, spawnPitch: .18, spawnClearance: .9, accent: 'green', map: [39, 45],
  },
] as const;

export const getDistrict = (id: DistrictId) => DISTRICTS.find((district) => district.id === id) ?? DISTRICTS[0];
export const getSuit = (id: SuitId) => SUITS.find((suit) => suit.id === id) ?? SUITS[0];
