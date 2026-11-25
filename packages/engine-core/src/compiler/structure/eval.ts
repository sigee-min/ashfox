import {
  MAX_STRUCTURE_OPS,
  StructureInputError,
  type BlockRotation,
  type CardinalFacing,
  type IntVec3,
  type MirrorAxis,
  type StructureOp,
  type StructureSourceUnit,
} from '../../project/structure/contract';
import {
  isValidMinecraftState,
  mirrorBlockState,
  parseBlockState,
  rotateBlockState,
  withBlockFacing,
} from '../../project/structure/state';
import type { StructureCustomPlacement, StructureGrid } from './contract';
import { emitRoof } from './roof';

interface FrameTransform {
  readonly offset: IntVec3;
  readonly rotate: BlockRotation;
  readonly mirrorAxis?: MirrorAxis;
  readonly mirrorCenter?: number;
}

const IDENTITY_FRAME: FrameTransform = { offset: [0, 0, 0], rotate: 0 };

interface EvalState {
  readonly rootPath: string;
  readonly units: ReadonlyMap<string, StructureSourceUnit>;
  readonly relative: (owner: string, specifier: string) => string;
  readonly size: IntVec3;
  readonly voxels: Int32Array;
  readonly customTags: (string | null)[];
  readonly stateToIdx: Map<string, number>;
  readonly states: string[];
  readonly usedImports: Map<string, Set<string>>;
  readonly usedPaletteKeys: Map<string, Set<string>>;
  readonly usedPrefabs: Map<string, Set<string>>;
  opCount: number;
  prefabUses: number;
}

const failEval = (file: string, code: string, message: string): never => {
  throw new StructureInputError({
    code,
    file,
    pointer: 'build',
    expected: 'valid structure operation',
    actual: message,
  });
};

const stateIndex = (state: EvalState, blockState: string): number => {
  const existing = state.stateToIdx.get(blockState);
  if (existing !== undefined) return existing;
  const idx = state.states.length;
  state.states.push(blockState);
  state.stateToIdx.set(blockState, idx);
  return idx;
};

const resolvePaletteEntry = (
  state: EvalState,
  keyOrState: string,
  ownerPath: string,
): { readonly state: string; readonly assetAlias: string | null } => {
  if (keyOrState.includes(':')) {
    if (!isValidMinecraftState(keyOrState)) {
      return failEval(ownerPath, 'structure.invalid-block', `Invalid block state "${keyOrState}"`);
    }
    return { state: keyOrState, assetAlias: null };
  }
  const ownerUnit = state.units.get(ownerPath)!;
  const rootUnit = state.units.get(state.rootPath)!;
  const targetOwner = keyOrState in ownerUnit.palette ? ownerPath : state.rootPath;
  const entry = ownerUnit.palette[keyOrState] ?? rootUnit.palette[keyOrState];
  if (!entry) {
    return failEval(ownerPath, 'structure.unknown-block', `Unknown palette key "${keyOrState}"`);
  }
  state.usedPaletteKeys.get(targetOwner)?.add(keyOrState);
  if (entry.kind === 'block') return { state: entry.state, assetAlias: null };
  state.usedImports.get(targetOwner)?.add(entry.alias);
  return { state: entry.fallback, assetAlias: entry.alias };
};

const rotatePoint = ([x, y, z]: IntVec3, rotate: BlockRotation): IntVec3 => {
  if (rotate === 90) return [-z, y, x];
  if (rotate === 180) return [-x, y, -z];
  if (rotate === 270) return [z, y, -x];
  return [x, y, z];
};

const applyFrame = (pt: IntVec3, frame: FrameTransform): IntVec3 => {
  const [rx, ry, rz] = rotatePoint(pt, frame.rotate);
  const [ox, oy, oz] = frame.offset;
  let wx = rx + ox;
  const wy = ry + oy;
  let wz = rz + oz;
  if (frame.mirrorAxis === 'x' && frame.mirrorCenter !== undefined) {
    wx = frame.mirrorCenter * 2 - wx;
  } else if (frame.mirrorAxis === 'z' && frame.mirrorCenter !== undefined) {
    wz = frame.mirrorCenter * 2 - wz;
  }
  return [wx, wy, wz];
};

const transformBlockState = (rawState: string, frame: FrameTransform): string => {
  let out = rotateBlockState(rawState, frame.rotate);
  if (frame.mirrorAxis) out = mirrorBlockState(out, frame.mirrorAxis);
  return out;
};

const putVoxel = (
  state: EvalState,
  ownerPath: string,
  pos: IntVec3,
  blockState: string,
  assetAlias: string | null,
): void => {
  const [w, h, d] = state.size;
  const [x, y, z] = pos;
  if (x < 0 || x >= w || y < 0 || y >= h || z < 0 || z >= d) {
    failEval(ownerPath, 'structure.out-of-bounds', `(${x}, ${y}, ${z}) outside (${w}, ${h}, ${d})`);
  }
  const index = (y * d + z) * w + x;
  if (blockState === 'minecraft:air') {
    state.voxels[index] = 0;
    state.customTags[index] = null;
    return;
  }
  state.voxels[index] = stateIndex(state, blockState);
  state.customTags[index] = assetAlias;
};

const fillRegion = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'box' | 'hollow' | 'walls' | 'frame' | 'carve' }>,
  frame: FrameTransform,
): void => {
  const min: IntVec3 = [
    Math.min(op.from[0], op.to[0]),
    Math.min(op.from[1], op.to[1]),
    Math.min(op.from[2], op.to[2]),
  ];
  const max: IntVec3 = [
    Math.max(op.from[0], op.to[0]),
    Math.max(op.from[1], op.to[1]),
    Math.max(op.from[2], op.to[2]),
  ];
  const resolved =
    op.op === 'carve'
      ? { state: 'minecraft:air', assetAlias: null }
      : resolvePaletteEntry(state, op.block, ownerPath);
  const transformedState = transformBlockState(resolved.state, frame);
  for (let y = min[1]; y <= max[1]; y += 1) {
    for (let z = min[2]; z <= max[2]; z += 1) {
      for (let x = min[0]; x <= max[0]; x += 1) {
        if (!regionAccepts(op.op, [x, y, z], min, max)) continue;
        putVoxel(
          state,
          ownerPath,
          applyFrame([x, y, z], frame),
          transformedState,
          resolved.assetAlias,
        );
      }
    }
  }
};

const regionAccepts = (kind: string, [x, y, z]: IntVec3, min: IntVec3, max: IntVec3): boolean => {
  if (kind === 'box' || kind === 'carve') return true;
  const onX = x === min[0] || x === max[0];
  const onY = y === min[1] || y === max[1];
  const onZ = z === min[2] || z === max[2];
  if (kind === 'hollow') return onX || onY || onZ;
  if (kind === 'walls') return onX || onZ;
  return (onX && onY) || (onY && onZ) || (onX && onZ);
};

const evalLayer = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'layer' }>,
  frame: FrameTransform,
): void => {
  for (let rowIdx = 0; rowIdx < op.rows.length; rowIdx += 1) {
    const row = op.rows[rowIdx]!;
    for (let colIdx = 0; colIdx < row.length; colIdx += 1) {
      const ch = row[colIdx]!;
      if (ch === '.' || ch === ' ') continue;
      const key = op.map[ch];
      if (!key) failEval(ownerPath, 'structure.unknown-layer-key', `Unmapped layer char "${ch}"`);
      const resolved = resolvePaletteEntry(state, key, ownerPath);
      const pos = applyFrame([op.origin[0] + colIdx, op.y, op.origin[1] + rowIdx], frame);
      putVoxel(
        state,
        ownerPath,
        pos,
        transformBlockState(resolved.state, frame),
        resolved.assetAlias,
      );
    }
  }
};

const composeFrames = (outer: FrameTransform, inner: FrameTransform): FrameTransform => {
  const [rx, ry, rz] = rotatePoint(inner.offset, outer.rotate);
  return {
    offset: [outer.offset[0] + rx, outer.offset[1] + ry, outer.offset[2] + rz],
    rotate: ((outer.rotate + inner.rotate) % 360) as BlockRotation,
    mirrorAxis: outer.mirrorAxis,
    mirrorCenter: outer.mirrorCenter,
  };
};

const resolvePrefab = (
  state: EvalState,
  ownerPath: string,
  ref: string,
): { readonly targetPath: string; readonly ops: readonly StructureOp[] } => {
  const dot = ref.indexOf('.');
  if (dot === -1) {
    const found = state.units.get(ownerPath)?.prefabs.find((p) => p.id === ref);
    if (!found) return failEval(ownerPath, 'structure.unknown-prefab', `Unknown prefab "${ref}"`);
    state.usedPrefabs.get(ownerPath)?.add(found.id);
    return { targetPath: ownerPath, ops: found.ops };
  }
  const alias = ref.slice(0, dot);
  const name = ref.slice(dot + 1);
  const imp = state.units.get(ownerPath)?.imports.find((i) => i.alias === alias);
  if (!imp)
    return failEval(ownerPath, 'structure.unknown-import', `Unknown import alias "${alias}"`);
  state.usedImports.get(ownerPath)?.add(alias);
  const targetPath = state.relative(ownerPath, imp.path);
  const found = state.units.get(targetPath)?.prefabs.find((p) => p.id === name && p.exported);
  if (!found)
    return failEval(ownerPath, 'structure.unknown-prefab', `Unknown exported prefab "${ref}"`);
  state.usedPrefabs.get(targetPath)?.add(found.id);
  return { targetPath, ops: found.ops };
};

const stepOffset = (axis: 'x' | 'y' | 'z', delta: number): IntVec3 =>
  axis === 'x' ? [delta, 0, 0] : axis === 'y' ? [0, delta, 0] : [0, 0, delta];

const evalRepeat = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'repeat' }>,
  frame: FrameTransform,
  depth: number,
): void => {
  for (let i = 0; i < op.count; i += 1) {
    const sub = composeFrames(frame, { offset: stepOffset(op.axis, i * op.step), rotate: 0 });
    for (const child of op.ops) evalOp(state, ownerPath, child, sub, depth + 1);
  }
};

const evalMirror = (
  state: EvalState,
  ownerPath: string,
  op: Extract<StructureOp, { op: 'mirror' }>,
  frame: FrameTransform,
  depth: number,
): void => {
  for (const child of op.ops) evalOp(state, ownerPath, child, frame, depth + 1);
  const mirrored: FrameTransform = { ...frame, mirrorAxis: op.axis, mirrorCenter: op.center };
  for (const child of op.ops) evalOp(state, ownerPath, child, mirrored, depth + 1);
};

const evalOp = (
  state: EvalState,
  ownerPath: string,
  op: StructureOp,
  frame: FrameTransform,
  depth: number,
): void => {
  if (++state.opCount > MAX_STRUCTURE_OPS || depth > 24) {
    failEval(ownerPath, 'structure.budget', 'Structure evaluation exceeded operation budget');
  }
  if (op.op === 'set') {
    const resolved = resolvePaletteEntry(state, op.block, ownerPath);
    const raw = op.facing ? withBlockFacing(resolved.state, op.facing) : resolved.state;
    putVoxel(
      state,
      ownerPath,
      applyFrame(op.at, frame),
      transformBlockState(raw, frame),
      resolved.assetAlias,
    );
  } else if (op.op === 'layer') evalLayer(state, ownerPath, op, frame);
  else if (op.op === 'roof') {
    emitRoof(
      op,
      (x, y, z, block, alias) =>
        putVoxel(
          state,
          ownerPath,
          applyFrame([x, y, z], frame),
          transformBlockState(block, frame),
          alias,
        ),
      (k, owner) => resolvePaletteEntry(state, k, owner),
      ownerPath,
    );
  } else if (op.op === 'repeat') evalRepeat(state, ownerPath, op, frame, depth);
  else if (op.op === 'mirror') evalMirror(state, ownerPath, op, frame, depth);
  else if (op.op === 'place') {
    state.prefabUses += 1;
    const target = resolvePrefab(state, ownerPath, op.prefab);
    const sub = composeFrames(frame, { offset: op.at, rotate: op.rotate });
    for (const child of target.ops) evalOp(state, target.targetPath, child, sub, depth + 1);
  } else fillRegion(state, ownerPath, op, frame);
};

const collectOpStaticRefs = (op: StructureOp, keys: Set<string>, imports: Set<string>): void => {
  if (op.op === 'repeat' || op.op === 'mirror') {
    for (const child of op.ops) collectOpStaticRefs(child, keys, imports);
    return;
  }
  if (op.op === 'place') {
    const [head, tail] = op.prefab.split('.');
    if (tail) imports.add(head!);
    return;
  }
  if (op.op === 'layer') {
    for (const block of Object.values(op.map)) keys.add(block);
    return;
  }
  if (op.op === 'roof') {
    keys.add(op.stair);
    keys.add(op.ridge);
    if (op.gable) keys.add(op.gable);
    return;
  }
  if (op.op !== 'carve') keys.add(op.block);
};

const collectUnitStaticRefs = (
  unit: StructureSourceUnit,
  keys: Set<string>,
  imports: Set<string>,
): void => {
  for (const prefab of unit.prefabs) {
    if (!prefab.exported) continue;
    for (const op of prefab.ops) collectOpStaticRefs(op, keys, imports);
  }
  for (const key of keys) {
    const entry = unit.palette[key];
    if (entry?.kind === 'asset') imports.add(entry.alias);
  }
};

const checkUnitHygiene = (state: EvalState, filePath: string, unit: StructureSourceUnit): void => {
  const imports = new Set(state.usedImports.get(filePath));
  const paletteKeys = new Set(state.usedPaletteKeys.get(filePath));
  if (filePath !== state.rootPath) collectUnitStaticRefs(unit, paletteKeys, imports);
  const badImport = unit.imports.find((imp) => !imports.has(imp.alias));
  if (badImport)
    failEval(filePath, 'structure.unused-import', `Unused import "${badImport.alias}"`);
  const badKey = Object.keys(unit.palette).find((key) => !paletteKeys.has(key));
  if (badKey) failEval(filePath, 'structure.unused-palette', `Unused palette key "${badKey}"`);
  const prefabs = state.usedPrefabs.get(filePath) ?? new Set<string>();
  const badPrefab = unit.prefabs.find(
    (p) => !prefabs.has(p.id) && (filePath === state.rootPath || !p.exported),
  );
  if (badPrefab) failEval(filePath, 'structure.unused-prefab', `Unused prefab "${badPrefab.id}"`);
};

const checkHygiene = (state: EvalState): void => {
  for (const [filePath, unit] of state.units) checkUnitHygiene(state, filePath, unit);
};

const collectCustomPlacements = (state: EvalState): readonly StructureCustomPlacement[] => {
  const [w, _h, d] = state.size;
  const placements: StructureCustomPlacement[] = [];
  for (let idx = 0; idx < state.customTags.length; idx += 1) {
    const alias = state.customTags[idx];
    if (!alias) continue;
    const x = idx % w;
    const z = Math.floor(idx / w) % d;
    const y = Math.floor(idx / (w * d));
    const fallbackState = state.states[state.voxels[idx]!] ?? 'minecraft:air';
    const rawFacing = parseBlockState(fallbackState).properties.facing;
    const facing: CardinalFacing =
      rawFacing === 'south' || rawFacing === 'east' || rawFacing === 'west' ? rawFacing : 'north';
    placements.push({ x, y, z, assetAlias: alias, fallbackState, facing });
  }
  return placements;
};

export const evaluateStructure = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  relative: (owner: string, specifier: string) => string,
): { readonly grid: StructureGrid; readonly prefabUses: number } => {
  const root = units.get(rootPath)!;
  const size = root.size!;
  const volume = size[0] * size[1] * size[2];
  const voxels = new Int32Array(volume).fill(-1);
  const customTags = new Array<string | null>(volume).fill(null);
  const state: EvalState = {
    rootPath,
    units,
    relative,
    size,
    voxels,
    customTags,
    stateToIdx: new Map([['minecraft:air', 0]]),
    states: ['minecraft:air'],
    usedImports: new Map([...units.keys()].map((k) => [k, new Set<string>()])),
    usedPaletteKeys: new Map([...units.keys()].map((k) => [k, new Set<string>()])),
    usedPrefabs: new Map([...units.keys()].map((k) => [k, new Set<string>()])),
    opCount: 0,
    prefabUses: 0,
  };
  for (const op of root.ops) evalOp(state, rootPath, op, IDENTITY_FRAME, 0);
  checkHygiene(state);
  return {
    grid: {
      id: root.id,
      dataVersion: root.dataVersion,
      size,
      states: state.states,
      voxels,
      customTags,
      customPlacements: collectCustomPlacements(state),
    },
    prefabUses: state.prefabUses,
  };
};
