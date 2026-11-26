import type {
  BlockRotation,
  CardinalFacing,
  IntVec3,
  StructureOp,
  StructureSourceUnit,
} from '../../project/structure/contract';
import { rotateBlockState } from '../../project/structure/state';
import type {
  StructureCustomPlacement,
  StructureFloorMeta,
  StructureGrid,
  StructureOpeningMeta,
  StructureRoomMeta,
  StructureSemanticStats,
  StructureSocketMeta,
} from './contract';

const CLOCKWISE: readonly CardinalFacing[] = ['north', 'east', 'south', 'west'];

const rotateFacing = (facing: CardinalFacing, rotate: BlockRotation): CardinalFacing =>
  CLOCKWISE[(CLOCKWISE.indexOf(facing) + rotate / 90) % 4]!;

const transformPoint = (
  [x, y, z]: IntVec3,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): IntVec3 => {
  const [cw, _ch, cd] = childSize;
  const [ox, oy, oz] = origin;
  if (rotate === 90) return [ox + (cd - 1 - z), oy + y, oz + x];
  if (rotate === 180) return [ox + (cw - 1 - x), oy + y, oz + (cd - 1 - z)];
  if (rotate === 270) return [ox + z, oy + y, oz + (cw - 1 - x)];
  return [ox + x, oy + y, oz + z];
};

const transformBox = (
  from: IntVec3,
  to: IntVec3,
  childSize: IntVec3,
  origin: IntVec3,
  rotate: BlockRotation,
): readonly [IntVec3, IntVec3] => {
  const a = transformPoint(from, childSize, origin, rotate);
  const b = transformPoint(to, childSize, origin, rotate);
  return [
    [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  ];
};

export interface CompoundMergeTarget {
  readonly size: IntVec3;
  readonly put: (x: number, y: number, z: number, state: string, assetAlias: string | null) => void;
  readonly carve: (x: number, y: number, z: number) => void;
  readonly floors: StructureFloorMeta[];
  readonly rooms: StructureRoomMeta[];
  readonly openings: StructureOpeningMeta[];
  readonly sockets: StructureSocketMeta[];
  readonly stats: {
    roomCount: number;
    facadeCount: number;
    stairCount: number;
    furnishCount: number;
    weatheringCount: number;
    rawSetCount: number;
    roofCount: number;
    dormerCount: number;
    chimneyCount: number;
    hasRoofTrim: boolean;
  };
}

const mergeVoxels = (
  target: CompoundMergeTarget,
  child: StructureGrid,
  origin: IntVec3,
  rotate: BlockRotation,
): void => {
  const [cw, _ch, cd] = child.size;
  const rotatedStates = child.states.map((s) => rotateBlockState(s, rotate));
  for (let idx = 0; idx < child.voxels.length; idx += 1) {
    const v = child.voxels[idx]!;
    if (v < 0) continue;
    const x = idx % cw;
    const z = Math.floor(idx / cw) % cd;
    const y = Math.floor(idx / (cw * cd));
    const [tx, ty, tz] = transformPoint([x, y, z], child.size, origin, rotate);
    if (v === 0) target.carve(tx, ty, tz);
    else target.put(tx, ty, tz, rotatedStates[v]!, child.customTags[idx] ?? null);
  }
};

const mergeStats = (
  target: CompoundMergeTarget,
  s: StructureSemanticStats,
  child: StructureGrid,
): void => {
  target.stats.roomCount += s.roomCount;
  target.stats.facadeCount += s.facadeCount;
  target.stats.stairCount += s.stairCount;
  target.stats.furnishCount += s.furnishCount;
  target.stats.weatheringCount += s.weatheringCount;
  target.stats.rawSetCount += s.rawSetCount;
  target.stats.roofCount += child.roofCount;
  target.stats.dormerCount += child.dormerCount;
  target.stats.chimneyCount += child.chimneyCount;
  if (child.hasRoofTrim) target.stats.hasRoofTrim = true;
};

export const mergeChildStructure = (
  target: CompoundMergeTarget,
  alias: string,
  child: StructureGrid,
  origin: IntVec3,
  rotate: BlockRotation,
): void => {
  mergeVoxels(target, child, origin, rotate);
  for (const f of child.floors) {
    target.floors.push({ name: `${alias}.${f.name}`, y: f.y + origin[1], height: f.height });
  }
  for (const r of child.rooms) {
    const [from, to] = transformBox(r.from, r.to, child.size, origin, rotate);
    target.rooms.push({
      name: `${alias}.${r.name}`,
      kind: r.kind,
      acousticSpace: r.acousticSpace,
      from,
      to,
      enclosed: r.enclosed,
    });
  }
  for (const o of child.openings) {
    const [from, to] = transformBox(o.from, o.to, child.size, origin, rotate);
    target.openings.push({
      kind: o.kind,
      room: `${alias}.${o.room}`,
      wall: rotateFacing(o.wall, rotate),
      from,
      to,
      ...(o.hinge ? { hinge: o.hinge } : {}),
      ...(o.connectsRooms
        ? { connectsRooms: [`${alias}.${o.connectsRooms[0]}`, `${alias}.${o.connectsRooms[1]}`] }
        : {}),
    });
  }
  for (const s of child.sockets) {
    const pos = transformPoint(
      [Math.floor(s.position[0]), Math.floor(s.position[1]), Math.floor(s.position[2])],
      child.size,
      origin,
      rotate,
    );
    target.sockets.push({
      id: `${alias}.${s.id}`,
      position: pos,
      normal: rotateFacing(s.normal, rotate),
      kind: s.kind,
      ...(s.pool ? { pool: s.pool } : {}),
      ...(s.target ? { target: s.target } : {}),
    });
  }
  mergeStats(target, child.semanticStats, child);
};

export const buildCustomPlacementsFromTags = (
  size: IntVec3,
  voxels: Int32Array,
  states: readonly string[],
  customTags: readonly (string | null)[],
  parseFacing: (state: string) => CardinalFacing,
): readonly StructureCustomPlacement[] => {
  const [w, _h, d] = size;
  const placements: StructureCustomPlacement[] = [];
  for (let idx = 0; idx < customTags.length; idx += 1) {
    const alias = customTags[idx];
    if (!alias) continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const fallbackState = states[voxels[idx]!] ?? 'minecraft:air';
    placements.push({
      x,
      y,
      z,
      assetAlias: alias,
      fallbackState,
      facing: parseFacing(fallbackState),
    });
  }
  return placements;
};

const addDefined = (keys: Set<string>, items: readonly (string | undefined)[]): void => {
  for (const item of items) if (item) keys.add(item);
};

const collectFacadeRefs = (op: Extract<StructureOp, { op: 'facade' }>, keys: Set<string>): void => {
  for (const o of op.openings) {
    addDefined(keys, [
      o.block,
      o.glass,
      o.frame,
      o.sill,
      o.shutter,
      o.lintel,
      o.porch?.floor,
      o.porch?.pillars,
      o.porch?.lamps,
      o.porch?.steps,
    ]);
  }
};

const collectFurnishRefs = (
  op: Extract<StructureOp, { op: 'furnish' }>,
  keys: Set<string>,
  imports: Set<string>,
): void => {
  for (const it of op.items) {
    if (it.kind === 'hang') keys.add(it.block);
    else if (it.prefab.includes('.')) imports.add(it.prefab.split('.')[0]!);
  }
};

const collectWeatheringRefs = (
  op: Extract<StructureOp, { op: 'weathering' }>,
  keys: Set<string>,
): void => {
  for (const r of op.rules) {
    if ('target' in r) keys.add(r.target);
    if ('into' in r) keys.add(r.into);
    if ('corners' in r) keys.add(r.corners);
  }
};

const collectSimpleOpRefs = (op: StructureOp, keys: Set<string>, imports: Set<string>): boolean => {
  if (op.op === 'place') {
    const [head, tail] = op.prefab.split('.');
    if (tail) imports.add(head!);
  } else if (op.op === 'compound_place') imports.add(op.alias);
  else if (op.op === 'layer') Object.values(op.map).forEach((b) => keys.add(b));
  else if (op.op === 'roof') addDefined(keys, [op.stair, op.ridge, op.trim, op.gable]);
  else if (op.op === 'room') addDefined(keys, [op.plinth, op.floor, op.wall, op.frame, op.ceiling]);
  else if (op.op === 'staircase') addDefined(keys, [op.stair, op.landing, op.rail]);
  else if ('block' in op && typeof op.block === 'string') keys.add(op.block);
  else return false;
  return true;
};

const collectOpStaticRefs = (op: StructureOp, keys: Set<string>, imports: Set<string>): void => {
  if (op.op === 'repeat' || op.op === 'mirror' || op.op === 'floor') {
    for (const child of op.ops) collectOpStaticRefs(child, keys, imports);
  } else if (op.op === 'facade') collectFacadeRefs(op, keys);
  else if (op.op === 'furnish') collectFurnishRefs(op, keys, imports);
  else if (op.op === 'weathering') collectWeatheringRefs(op, keys);
  else collectSimpleOpRefs(op, keys, imports);
};

const collectExportedModuleRefs = (
  unit: StructureSourceUnit,
  paletteKeys: Set<string>,
  imports: Set<string>,
): void => {
  for (const prefab of unit.prefabs) {
    if (!prefab.exported) continue;
    for (const op of prefab.ops) collectOpStaticRefs(op, paletteKeys, imports);
  }
  for (const key of paletteKeys) {
    const entry = unit.palette[key];
    if (entry?.kind === 'asset') imports.add(entry.alias);
  }
};

export const checkStructureUnitHygiene = (
  filePath: string,
  rootPath: string,
  unit: StructureSourceUnit,
  usedImports: ReadonlyMap<string, Set<string>>,
  usedPaletteKeys: ReadonlyMap<string, Set<string>>,
  usedPrefabs: ReadonlyMap<string, Set<string>>,
  fail: (file: string, code: string, message: string) => never,
): void => {
  const imports = new Set(usedImports.get(filePath));
  const paletteKeys = new Set(usedPaletteKeys.get(filePath));
  if (filePath !== rootPath) collectExportedModuleRefs(unit, paletteKeys, imports);
  const badImport = unit.imports.find((imp) => !imports.has(imp.alias));
  if (badImport) fail(filePath, 'structure.unused-import', `Unused import "${badImport.alias}"`);
  const badKey = Object.keys(unit.palette).find((key) => !paletteKeys.has(key));
  if (badKey) fail(filePath, 'structure.unused-palette', `Unused palette key "${badKey}"`);
  const prefabs = usedPrefabs.get(filePath) ?? new Set<string>();
  const badPrefab = unit.prefabs.find(
    (p) => !prefabs.has(p.id) && (filePath === rootPath || !p.exported),
  );
  if (badPrefab) fail(filePath, 'structure.unused-prefab', `Unused prefab "${badPrefab.id}"`);
};

export const resolveStructurePrefab = (
  units: ReadonlyMap<string, StructureSourceUnit>,
  relative: (owner: string, spec: string) => string,
  ownerPath: string,
  ref: string,
  usedImports: ReadonlyMap<string, Set<string>>,
  usedPrefabs: ReadonlyMap<string, Set<string>>,
  fail: (file: string, code: string, msg: string) => never,
): { readonly targetPath: string; readonly ops: readonly StructureOp[] } => {
  const dot = ref.indexOf('.');
  if (dot === -1) {
    const found = units.get(ownerPath)?.prefabs.find((p) => p.id === ref);
    if (!found) return fail(ownerPath, 'structure.unknown-prefab', `Unknown prefab "${ref}"`);
    usedPrefabs.get(ownerPath)?.add(found.id);
    return { targetPath: ownerPath, ops: found.ops };
  }
  const alias = ref.slice(0, dot);
  const name = ref.slice(dot + 1);
  const imp = units.get(ownerPath)?.imports.find((i) => i.alias === alias);
  if (!imp) return fail(ownerPath, 'structure.unknown-import', `Unknown import alias "${alias}"`);
  usedImports.get(ownerPath)?.add(alias);
  const targetPath = relative(ownerPath, imp.path);
  const found = units.get(targetPath)?.prefabs.find((p) => p.id === name && p.exported);
  if (!found)
    return fail(ownerPath, 'structure.unknown-prefab', `Unknown exported prefab "${ref}"`);
  usedPrefabs.get(targetPath)?.add(found.id);
  return { targetPath, ops: found.ops };
};

export interface CompoundEvalTarget {
  readonly size: IntVec3;
  readonly floors: StructureFloorMeta[];
  readonly rooms: Map<string, StructureRoomMeta>;
  readonly openings: StructureOpeningMeta[];
  readonly sockets: StructureSocketMeta[];
  readonly stats: {
    roomCount: number;
    facadeCount: number;
    stairCount: number;
    furnishCount: number;
    weatheringCount: number;
    rawSetCount: number;
  };
  roofCount: number;
  dormerCount: number;
  chimneyCount: number;
  hasRoofTrim: boolean;
  prefabUses: number;
  put: (x: number, y: number, z: number, state: string, assetAlias: string | null) => void;
  carve: (x: number, y: number, z: number) => void;
}

export const applyCompoundChild = (
  state: CompoundEvalTarget,
  alias: string,
  childResult: { readonly grid: StructureGrid; readonly prefabUses: number },
  origin: IntVec3,
  rotate: BlockRotation,
): void => {
  const target: CompoundMergeTarget = {
    size: state.size,
    put: state.put,
    carve: state.carve,
    floors: state.floors,
    rooms: [...state.rooms.values()],
    openings: state.openings,
    sockets: state.sockets,
    stats: {
      ...state.stats,
      roofCount: state.roofCount,
      dormerCount: state.dormerCount,
      chimneyCount: state.chimneyCount,
      hasRoofTrim: state.hasRoofTrim,
    },
  };
  const prevLen = target.rooms.length;
  mergeChildStructure(target, alias, childResult.grid, origin, rotate);
  for (let i = prevLen; i < target.rooms.length; i += 1) {
    state.rooms.set(target.rooms[i]!.name, target.rooms[i]!);
  }
  Object.assign(state.stats, {
    roomCount: target.stats.roomCount,
    facadeCount: target.stats.facadeCount,
    stairCount: target.stats.stairCount,
    furnishCount: target.stats.furnishCount,
    weatheringCount: target.stats.weatheringCount,
    rawSetCount: target.stats.rawSetCount,
  });
  state.roofCount = target.stats.roofCount;
  state.dormerCount = target.stats.dormerCount;
  state.chimneyCount = target.stats.chimneyCount;
  state.hasRoofTrim = target.stats.hasRoofTrim;
  state.prefabUses += childResult.prefabUses;
};

export const collectReachableUnits = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  relative: (owner: string, spec: string) => string,
): ReadonlySet<string> => {
  const visited = new Set<string>();
  const stack = [rootPath];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    const unit = units.get(cur);
    if (!unit) continue;
    for (const imp of unit.imports) {
      const target = relative(cur, imp.path);
      const targetUnit = units.get(target);
      if (targetUnit && targetUnit.kind === 'module' && !visited.has(target)) stack.push(target);
    }
  }
  return visited;
};
