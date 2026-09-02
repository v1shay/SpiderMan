export type WorldPoint = { x: number; y?: number; z: number };

export type InfiniteTileAddress = {
  x: number;
  z: number;
  /** Stable unsigned integer for this namespace/tile coordinate. */
  id: number;
  seed: number;
};

export type DeterministicRaceNode = {
  id: number;
  x: number;
  z: number;
  tileX: number;
  tileZ: number;
};

const hashText = (text: string) => {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mix32 = (value: number) => {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
};

export function deterministicTileId(namespace: string, x: number, z: number, channel = 0) {
  const namespaceHash = hashText(namespace);
  const coordinateHash = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca77) ^ Math.imul(channel | 0, 0xc2b2ae3d);
  return mix32(namespaceHash ^ coordinateHash);
}

export function tileCoordinateAt(
  point: WorldPoint,
  width: number,
  depth: number,
  origin: WorldPoint = { x: 0, z: 0 },
): { x: number; z: number } {
  return {
    x: Math.round((point.x - origin.x) / width),
    z: Math.round((point.z - origin.z) / depth),
  };
}

export function infiniteTileAddress(
  namespace: string,
  point: WorldPoint,
  width: number,
  depth: number,
  origin: WorldPoint = { x: 0, z: 0 },
): InfiniteTileAddress {
  const coordinate = tileCoordinateAt(point, width, depth, origin);
  const id = deterministicTileId(namespace, coordinate.x, coordinate.z);
  return { ...coordinate, id, seed: deterministicTileId(namespace, coordinate.x, coordinate.z, 1) };
}

const unit = (seed: number) => seed / 0xffffffff;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/**
 * Produces a closed, non-self-intersecting course around a permanent world
 * address. Only x/z are generated here; the rendered mesh query supplies the
 * equally deterministic rooftop/street height when a course is configured.
 */
export function deterministicRaceNodes(
  namespace: string,
  start: WorldPoint,
  width: number,
  depth: number,
  options: { count?: number; minimumRadius?: number; maximumRadius?: number } = {},
): DeterministicRaceNode[] {
  const count = Math.max(4, Math.floor(options.count ?? 8));
  const minimum = options.minimumRadius ?? 24;
  const maximum = options.maximumRadius ?? 108;
  const radiusX = clamp(width * .34, minimum, maximum);
  const radiusZ = clamp(depth * .34, minimum, maximum);
  const origin = { x: 0, z: 0 };
  const home = infiniteTileAddress(namespace, start, width, depth, origin);
  const phase = (unit(deterministicTileId(namespace, home.x, home.z, 9)) - .5) * .18;
  const nodes: DeterministicRaceNode[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = -Math.PI / 2 + phase + index / count * Math.PI * 2;
    const radialSeed = unit(deterministicTileId(namespace, home.x, home.z, index + 20));
    const radial = .9 + radialSeed * .16;
    const x = start.x + Math.cos(angle) * radiusX * radial;
    const z = start.z + Math.sin(angle) * radiusZ * radial;
    const tile = tileCoordinateAt({ x, z }, width, depth, origin);
    nodes.push({
      id: deterministicTileId(`${namespace}:race`, home.x, home.z, index),
      x,
      z,
      tileX: tile.x,
      tileZ: tile.z,
    });
  }
  return nodes;
}
