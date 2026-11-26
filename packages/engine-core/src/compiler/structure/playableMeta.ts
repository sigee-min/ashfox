import type { Vec3 } from '../../model/identity';
import type { CardinalFacing, IntVec3 } from '../../project/structure/contract';
import { parseBlockState } from '../../project/structure/state';
import { describeBlockState, type BlockDescriptor } from './blocks';
import type {
  PlayableCollider,
  PlayableInteractable,
  PlayableLight,
  PlayableStructureMeta,
  PlayableZone,
  StructureGrid,
  StructureSocketMeta,
} from './contract';

type ColliderMaterial = PlayableCollider['material'];

const NON_COLLIDING_SHAPES = new Set<BlockDescriptor['shape']>(['torch', 'carpet', 'pot', 'door']);

const classifyMaterial = (stateName: string): ColliderMaterial => {
  if (
    stateName.includes('leaves') ||
    stateName.includes('grass') ||
    stateName.includes('dirt') ||
    stateName.includes('hay')
  ) {
    return 'foliage';
  }
  if (stateName.includes('glass')) return 'glass';
  if (
    stateName.includes('iron') ||
    stateName.includes('anvil') ||
    stateName.includes('chain') ||
    stateName.includes('lantern') ||
    stateName.includes('cauldron')
  ) {
    return 'metal';
  }
  if (
    stateName.includes('oak') ||
    stateName.includes('spruce') ||
    stateName.includes('birch') ||
    stateName.includes('plank') ||
    stateName.includes('timber') ||
    stateName.includes('log') ||
    stateName.includes('wood') ||
    stateName.includes('chest') ||
    stateName.includes('barrel') ||
    stateName.includes('bed') ||
    stateName.includes('bookshelf') ||
    stateName.includes('table') ||
    stateName.includes('ladder')
  ) {
    return 'wood';
  }
  return 'stone';
};

const mergeColliders = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
): readonly PlayableCollider[] => {
  const [w, h, d] = grid.size;
  const hw = w / 2;
  const hd = d / 2;
  const mats: (ColliderMaterial | null)[] = grid.states.map((s, idx) => {
    if (idx === 0) return null;
    const desc = descriptors[idx]!;
    return NON_COLLIDING_SHAPES.has(desc.shape) ? null : classifyMaterial(parseBlockState(s).name);
  });
  const visited = new Uint8Array(w * h * d);
  const colliders: PlayableCollider[] = [];
  for (let idx = 0; idx < visited.length; idx += 1) {
    if (visited[idx]) continue;
    const v = grid.voxels[idx]!;
    const mat = v > 0 ? mats[v]! : null;
    if (!mat) continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const box = expandColliderBox(grid, mats, visited, x, y, z, mat);
    colliders.push({
      from: [box.x0 - hw, box.y0, box.z0 - hd],
      to: [box.x1 - hw, box.y1, box.z1 - hd],
      material: mat,
    });
  }
  return colliders;
};

const cellMatches = (
  grid: StructureGrid,
  mats: readonly (ColliderMaterial | null)[],
  visited: Uint8Array,
  x: number,
  y: number,
  z: number,
  mat: ColliderMaterial,
): boolean => {
  const [w, _h, d] = grid.size;
  const i = (y * d + z) * w + x;
  return !visited[i] && grid.voxels[i]! > 0 && mats[grid.voxels[i]!] === mat;
};

const rowMatches = (
  grid: StructureGrid,
  mats: readonly (ColliderMaterial | null)[],
  visited: Uint8Array,
  x0: number,
  x1: number,
  y: number,
  z: number,
  mat: ColliderMaterial,
): boolean => {
  for (let x = x0; x < x1; x += 1) {
    if (!cellMatches(grid, mats, visited, x, y, z, mat)) return false;
  }
  return true;
};

const sliceMatches = (
  grid: StructureGrid,
  mats: readonly (ColliderMaterial | null)[],
  visited: Uint8Array,
  x0: number,
  x1: number,
  y: number,
  z0: number,
  z1: number,
  mat: ColliderMaterial,
): boolean => {
  for (let z = z0; z < z1; z += 1) {
    if (!rowMatches(grid, mats, visited, x0, x1, y, z, mat)) return false;
  }
  return true;
};

const expandColliderBox = (
  grid: StructureGrid,
  mats: readonly (ColliderMaterial | null)[],
  visited: Uint8Array,
  x0: number,
  y0: number,
  z0: number,
  mat: ColliderMaterial,
) => {
  const [w, h, d] = grid.size;
  let x1 = x0 + 1;
  while (x1 < w && cellMatches(grid, mats, visited, x1, y0, z0, mat)) x1 += 1;
  let z1 = z0 + 1;
  while (z1 < d && rowMatches(grid, mats, visited, x0, x1, y0, z1, mat)) z1 += 1;
  let y1 = y0 + 1;
  while (y1 < h && sliceMatches(grid, mats, visited, x0, x1, y1, z0, z1, mat)) y1 += 1;
  for (let y = y0; y < y1; y += 1) {
    for (let z = z0; z < z1; z += 1) {
      for (let x = x0; x < x1; x += 1) visited[(y * d + z) * w + x] = 1;
    }
  }
  return { x0, y0, z0, x1, y1, z1 };
};

const buildZones = (grid: StructureGrid): readonly PlayableZone[] => {
  const [w, _h, d] = grid.size;
  const hw = w / 2;
  const hd = d / 2;
  return grid.rooms.map((r) => ({
    id: r.name,
    kind: r.kind,
    from: [r.from[0] - hw, r.from[1], r.from[2] - hd],
    to: [r.to[0] + 1 - hw, r.to[1] + 1, r.to[2] + 1 - hd],
    enclosed: r.enclosed,
    acousticSpace: r.acousticSpace,
  }));
};

const hingePivotForDoor = (
  wx: number,
  wy: number,
  wz: number,
  facing: CardinalFacing,
  hinge: string | undefined,
): Vec3 => {
  const left = hinge !== 'right';
  if (facing === 'north') return [wx + (left ? -0.5 : 0.5), wy, wz - 0.5];
  if (facing === 'south') return [wx + (left ? 0.5 : -0.5), wy, wz + 0.5];
  if (facing === 'east') return [wx + 0.5, wy, wz + (left ? -0.5 : 0.5)];
  return [wx - 0.5, wy, wz + (left ? 0.5 : -0.5)];
};

const interactableKindFor = (
  name: string,
  props: Readonly<Record<string, string>>,
): PlayableInteractable['kind'] | null => {
  if (name.includes('_door') && !name.includes('trapdoor')) {
    return props.half === 'upper' ? null : 'door';
  }
  if (name.includes('chest')) return 'chest';
  if (name.includes('furnace')) return 'furnace';
  if (name.includes('anvil')) return 'anvil';
  if (name.includes('_bed')) return props.part === 'foot' ? null : 'bed';
  if (
    name.includes('table') ||
    name.includes('barrel') ||
    name.includes('cauldron') ||
    name.includes('lectern')
  ) {
    return 'workstation';
  }
  return null;
};

interface InteractablePaletteEntry {
  readonly kind: PlayableInteractable['kind'];
  readonly facing: CardinalFacing;
  readonly hinge: string | undefined;
}

const buildInteractablePalette = (
  states: readonly string[],
): readonly (InteractablePaletteEntry | null)[] =>
  states.map((s, idx) => {
    if (idx === 0) return null;
    const parsed = parseBlockState(s);
    const kind = interactableKindFor(parsed.name, parsed.properties);
    if (!kind) return null;
    const rawF = parsed.properties.facing;
    const facing: CardinalFacing =
      rawF === 'south' || rawF === 'east' || rawF === 'west' ? rawF : 'north';
    return { kind, facing, hinge: parsed.properties.hinge };
  });

const makeInteractable = (
  grid: StructureGrid,
  meta: InteractablePaletteEntry,
  x: number,
  y: number,
  z: number,
  seq: number,
): PlayableInteractable => {
  const [w, _h, d] = grid.size;
  const wx = x - w / 2 + 0.5;
  const wz = z - d / 2 + 0.5;
  const opening =
    meta.kind === 'door'
      ? grid.openings.find(
          (o) =>
            o.kind === 'door' && x >= o.from[0] && x <= o.to[0] && z >= o.from[2] && z <= o.to[2],
        )
      : undefined;
  return {
    id: `${meta.kind}_${seq}`,
    kind: meta.kind,
    position: [wx, y, wz],
    facing: meta.facing,
    ...(meta.kind === 'door'
      ? {
          hingePivot: hingePivotForDoor(wx, y, wz, meta.facing, meta.hinge),
        }
      : {}),
    ...(opening?.connectsRooms ? { connectsZones: opening.connectsRooms } : {}),
  };
};

const buildInteractables = (grid: StructureGrid): readonly PlayableInteractable[] => {
  const [w, h, d] = grid.size;
  const palette = buildInteractablePalette(grid.states);
  const out: PlayableInteractable[] = [];
  for (let idx = 0; idx < w * h * d; idx += 1) {
    const v = grid.voxels[idx]!;
    const meta = v > 0 ? palette[v]! : null;
    if (!meta) continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    out.push(makeInteractable(grid, meta, x, y, z, out.length));
  }
  return out;
};

const isPassableVoxel = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, h, d] = grid.size;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) return false;
  const v = grid.voxels[(y * d + z) * w + x]!;
  if (v <= 0) return true;
  const desc = descriptors[v]!;
  return (
    desc.shape === 'door' ||
    desc.shape === 'carpet' ||
    desc.shape === 'torch' ||
    desc.shape === 'lantern'
  );
};

const isWalkableNavCell = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, _h, d] = grid.size;
  const below = grid.voxels[((y - 1) * d + z) * w + x]!;
  return (
    below > 0 &&
    isPassableVoxel(grid, descriptors, x, y, z) &&
    isPassableVoxel(grid, descriptors, x, y + 1, z)
  );
};

const buildNavigation = (
  grid: StructureGrid,
  descriptors: readonly BlockDescriptor[],
): PlayableStructureMeta['navigation'] => {
  const [w, h, d] = grid.size;
  const entryCells: IntVec3[] = [];
  const floorSet = new Set<number>(grid.floors.map((f) => f.y));
  let walkableCellCount = 0;
  for (let idx = w * d; idx < (h - 1) * w * d; idx += 1) {
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const v = grid.voxels[idx]!;
    if (v > 0 && descriptors[v]!.shape === 'door' && !grid.states[v]!.includes('half=upper')) {
      entryCells.push([x, y, z]);
    }
    if (isWalkableNavCell(grid, descriptors, x, y, z)) {
      walkableCellCount += 1;
      if (grid.floors.length === 0) floorSet.add(y - 1);
    }
  }
  if (floorSet.size === 0) floorSet.add(0);
  return {
    entryCells,
    walkableCellCount,
    floorLevels: [...floorSet].sort((a, b) => a - b),
  };
};

const transformSockets = (grid: StructureGrid): readonly StructureSocketMeta[] => {
  const [w, _h, d] = grid.size;
  const hw = w / 2;
  const hd = d / 2;
  return grid.sockets.map((s) => ({
    ...s,
    position: [s.position[0] - hw + 0.5, s.position[1], s.position[2] - hd + 0.5],
  }));
};

const NON_COLLIDING_INTERIOR_TAGS =
  'drapery:,floor_,baseboard_,wainscot_,molding_,ceiling_,window_pane_,partition_door,story_'.split(
    ',',
  );

const isCollidingInteriorBox = (tag: string): boolean =>
  !NON_COLLIDING_INTERIOR_TAGS.some((p) => tag.startsWith(p));

const rotatedBoxBounds16 = (
  box: NonNullable<StructureGrid['interiors']>[number]['ir']['boxes'][number],
): readonly [number, number, number, number] => {
  const [x0, , z0] = box.from_16;
  const [x1, , z1] = box.to_16;
  const rad = ((box.rotation_y_deg ?? 0) * Math.PI) / 180;
  if (!box.pivot_16 || Math.abs(rad) <= 1e-4) return [x0, z0, x1, z1];
  const [px, , pz] = box.pivot_16;
  const [cos, sin] = [Math.cos(rad), Math.sin(rad)];
  let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const cx of [x0, x1]) {
    for (const cz of [z0, z1]) {
      const rx = px + (cx - px) * cos - (cz - pz) * sin;
      const rz = pz + (cx - px) * sin + (cz - pz) * cos;
      minX = Math.min(minX, rx);
      minZ = Math.min(minZ, rz);
      maxX = Math.max(maxX, rx);
      maxZ = Math.max(maxZ, rz);
    }
  }
  return [minX, minZ, maxX, maxZ];
};

const collectInteriorColliders = (grid: StructureGrid): readonly PlayableCollider[] => {
  const [w, , d] = grid.size;
  const [hw, hd] = [w / 2, d / 2];
  const out: PlayableCollider[] = [];
  for (const room of grid.interiors ?? []) {
    for (const box of room.ir.boxes) {
      if (!isCollidingInteriorBox(box.semantic_tag ?? '')) continue;
      const material: ColliderMaterial =
        box.layer === 'translucent' ? 'glass' : classifyMaterial(box.tile_id);
      const [x0, z0, x1, z1] = rotatedBoxBounds16(box);
      out.push({
        from: [x0 / 16 - hw, box.from_16[1] / 16, z0 / 16 - hd],
        to: [x1 / 16 - hw, box.to_16[1] / 16, z1 / 16 - hd],
        material,
      });
    }
  }
  return out;
};

export const buildPlayableStructureMeta = (
  grid: StructureGrid,
  lights: readonly PlayableLight[],
  descriptors: readonly BlockDescriptor[] = grid.states.map(describeBlockState),
): PlayableStructureMeta => {
  const [w, h, d] = grid.size;
  return {
    schemaVersion: 1,
    id: grid.id,
    unitsPerBlock: 1,
    bounds: { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] },
    colliders: [...mergeColliders(grid, descriptors), ...collectInteriorColliders(grid)],
    zones: buildZones(grid),
    lights,
    interactables: buildInteractables(grid),
    sockets: transformSockets(grid),
    navigation: buildNavigation(grid, descriptors),
    ...(grid.interiors && grid.interiors.length > 0
      ? { interiors: grid.interiors.map((i) => i.playable_meta) }
      : {}),
  };
};
