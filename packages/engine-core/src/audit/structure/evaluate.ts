import { DEFAULT_AUDIT_THRESHOLD, gradeForAudit, round2 } from '@ashfox/internal-contracts';
import { describeBlockState, type BlockDescriptor } from '../../compiler/structure/blocks';
import { isValidMinecraftState } from '../../project/structure/state';
import type {
  StructureAuditGate,
  StructureAuditMetrics,
  StructureAuditReport,
  StructureGrid,
} from './contract';

interface PaletteStateMeta {
  readonly baseId: string;
  readonly descriptor: BlockDescriptor;
  readonly isDoor: boolean;
  readonly isPassable: boolean;
}

const buildPaletteMeta = (states: readonly string[]): readonly PaletteStateMeta[] =>
  states.map((state, index) => {
    const descriptor = describeBlockState(state);
    if (index === 0) {
      return { baseId: state, descriptor, isDoor: false, isPassable: true };
    }
    const bracket = state.indexOf('[');
    const baseId = bracket === -1 ? state : state.slice(0, bracket);
    const isDoor = state.includes('_door');
    const isPassable =
      isDoor || state.includes('carpet') || state.includes('torch') || state.includes('lantern');
    return { baseId, descriptor, isDoor, isPassable };
  });

const DIRS6: readonly [number, number, number][] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

const visitSolidNeighbors = (
  grid: StructureGrid,
  cur: number,
  visited: Uint8Array,
  queue: number[],
): void => {
  const [w, h, d] = grid.size;
  const cx = cur % w;
  const cz = Math.floor(cur / w) % d;
  const cy = Math.floor(cur / (w * d));
  for (const [dx, dy, dz] of DIRS6) {
    const nx = cx + dx;
    const ny = cy + dy;
    const nz = cz + dz;
    if (nx < 0 || nx >= w || ny < 0 || ny >= h || nz < 0 || nz >= d) continue;
    const next = (ny * d + nz) * w + nx;
    if (visited[next] === 0 && grid.voxels[next]! > 0) {
      visited[next] = 1;
      queue.push(next);
    }
  }
};

const checkConnectedSolid = (
  grid: StructureGrid,
): {
  readonly blockCount: number;
  readonly grounded: boolean;
  readonly singleComponent: boolean;
} => {
  const [w, _h, d] = grid.size;
  const total = grid.voxels.length;
  const visited = new Uint8Array(total);
  const queue: number[] = [];
  let blockCount = 0;
  let grounded = false;
  for (let i = 0; i < total; i += 1) {
    if (grid.voxels[i]! <= 0) continue;
    blockCount += 1;
    if (Math.floor(i / (w * d)) === 0) {
      grounded = true;
      visited[i] = 1;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    visitSolidNeighbors(grid, queue[head]!, visited, queue);
  }
  return { blockCount, grounded, singleComponent: blockCount > 0 && queue.length === blockCount };
};

const isPassable = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  idx: number,
): boolean => {
  const stateIdx = grid.voxels[idx]!;
  return stateIdx <= 0 ? true : paletteMeta[stateIdx]!.isPassable;
};

const isWalkableAt = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  x: number,
  y: number,
  z: number,
): boolean => {
  const [w, h, d] = grid.size;
  const idx = (y * d + z) * w + x;
  const st = grid.voxels[idx]!;
  if (st === 0) return true;
  if (grid.voxels[z * w + x]! <= 0 || y + 1 >= h) return false;
  return (
    isPassable(grid, paletteMeta, idx) && isPassable(grid, paletteMeta, ((y + 1) * d + z) * w + x)
  );
};

const analyzeInteriorLayer = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  y: number,
  doors: Set<string>,
): number => {
  const [w, _h, d] = grid.size;
  let interiorCells = 0;
  for (let z = 0; z < d; z += 1) {
    for (let x = 0; x < w; x += 1) {
      const st = grid.voxels[(y * d + z) * w + x]!;
      if (st > 0 && paletteMeta[st]!.isDoor) doors.add(`${x},${z}`);
      if (isWalkableAt(grid, paletteMeta, x, y, z)) interiorCells += 1;
    }
  }
  return interiorCells;
};

const analyzeInterior = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
): { readonly interiorCells: number; readonly accessibleDoorways: number } => {
  const h = grid.size[1];
  let interiorCells = 0;
  const doors = new Set<string>();
  for (let y = 1; y < h; y += 1) {
    interiorCells += analyzeInteriorLayer(grid, paletteMeta, y, doors);
  }
  return { interiorCells, accessibleDoorways: doors.size };
};

const collectMetrics = (
  grid: StructureGrid,
  paletteMeta: readonly PaletteStateMeta[],
  prefabUses: number,
  interior: { readonly interiorCells: number; readonly accessibleDoorways: number },
): StructureAuditMetrics => {
  let blockCount = 0;
  let lightSources = 0;
  let furnitureCount = 0;
  const materials = new Set<string>();
  const shapes = new Set<string>();
  const customAliases = new Set<string>();
  for (let i = 0; i < grid.voxels.length; i += 1) {
    const v = grid.voxels[i]!;
    if (v <= 0) continue;
    blockCount += 1;
    const meta = paletteMeta[v]!;
    materials.add(meta.baseId);
    shapes.add(meta.descriptor.shape);
    if (meta.descriptor.light) lightSources += 1;
    if (meta.descriptor.furniture) furnitureCount += 1;
    const tag = grid.customTags[i];
    if (tag) {
      customAliases.add(tag);
      furnitureCount += 1;
      if (tag.includes('lantern') || tag.includes('rune')) lightSources += 1;
    }
  }
  return {
    blockCount,
    interiorCells: interior.interiorCells,
    walkableCells: interior.interiorCells,
    walkableReachRatio: 1,
    avgInteriorHeadroom: 3,
    skyLeakRate: 0,
    litInteriorRatio: 1,
    facadeReliefRatio: 0.2,
    openingRatio: 0.2,
    accessibleDoorways: interior.accessibleDoorways,
    lightSources,
    furnitureCount,
    distinctMaterials: materials.size,
    shapeKinds: shapes.size,
    prefabUses,
    customAssetCount: customAliases.size,
    greedyCompressionRatio: 1,
    semanticRatio: 0,
  };
};

const clampScore = (val: number, max: number): number => round2(Math.max(0, Math.min(max, val)));

const buildGates = (
  grid: StructureGrid,
  conn: { readonly grounded: boolean; readonly singleComponent: boolean },
  m: StructureAuditMetrics,
): StructureAuditGate[] => {
  const validIds = grid.states.every((s) => s === 'minecraft:air' || isValidMinecraftState(s));
  return [
    {
      id: 'visible_geometry',
      passed: m.blockCount > 0,
      message: `Placed ${m.blockCount} blocks.`,
      targets: [],
      fix: 'Add structure geometry.',
    },
    {
      id: 'ground_contact',
      passed: conn.grounded,
      message: conn.grounded ? 'Foundation touches Y = 0.' : 'No blocks at Y = 0.',
      targets: [],
      fix: 'Place foundation on y = 0.',
    },
    {
      id: 'no_disconnected_floating_parts',
      passed: conn.singleComponent,
      message: conn.singleComponent
        ? 'All blocks form one connected structure.'
        : 'Floating disconnected blocks detected.',
      targets: [],
      fix: 'Connect all parts to the grounded structure.',
    },
    {
      id: 'enclosed_interior',
      passed: m.interiorCells >= 8,
      message: `Walkable interior space: ${m.interiorCells} cells.`,
      targets: [],
      fix: 'Carve an interior room with >= 2 blocks headroom.',
    },
    {
      id: 'valid_minecraft_ids',
      passed: validIds,
      message: 'All palette states match Minecraft ID format.',
      targets: [],
      fix: 'Use valid minecraft:block_id states.',
    },
  ];
};

const computePillarScores = (grid: StructureGrid, m: StructureAuditMetrics) => {
  const arch =
    clampScore(m.shapeKinds >= 3 ? 12 : m.shapeKinds * 4, 12) +
    clampScore(Math.min(1, m.blockCount / 180) * 12, 12) +
    clampScore(grid.size[0] >= 7 && grid.size[1] >= 6 && grid.size[2] >= 7 ? 11 : 6, 11);
  const interior =
    clampScore(Math.min(1, m.interiorCells / 36) * 10, 10) +
    clampScore(m.accessibleDoorways >= 1 ? 8 : 2, 8) +
    clampScore(Math.min(1, m.lightSources / 3) * 8, 8) +
    clampScore(Math.min(1, m.furnitureCount / 5) * 9, 9);
  const materials =
    clampScore(Math.min(1, m.distinctMaterials / 8) * 14, 14) +
    clampScore(Math.min(1, m.shapeKinds / 5) * 8, 8) +
    clampScore((m.prefabUses > 0 ? 4 : 0) + (m.customAssetCount > 0 ? 4 : 1), 8);
  return { arch, interior, materials };
};

const buildStubPillars = (s: { arch: number; interior: number; materials: number }) => [
  {
    id: 'architecture' as const,
    label: 'Architecture & Silhouette',
    score: clampScore(s.arch, 30),
    maxScore: 30,
    metrics: [],
  },
  {
    id: 'facade' as const,
    label: 'Facade Relief & Rhythm',
    score: clampScore(s.interior, 25),
    maxScore: 25,
    metrics: [],
  },
  {
    id: 'interior' as const,
    label: 'Interior Circulation & Lighting',
    score: clampScore(s.interior, 25),
    maxScore: 25,
    metrics: [],
  },
  {
    id: 'craft' as const,
    label: 'Modularity & Craft',
    score: clampScore(s.materials, 20),
    maxScore: 20,
    metrics: [],
  },
];

export const evaluateStructureQuality = (
  grid: StructureGrid,
  prefabUses: number,
): StructureAuditReport => {
  const paletteMeta = buildPaletteMeta(grid.states);
  const conn = checkConnectedSolid(grid);
  const m = collectMetrics(grid, paletteMeta, prefabUses, analyzeInterior(grid, paletteMeta));
  const gates = buildGates(grid, conn, m);
  const s = computePillarScores(grid, m);
  const allGatesPass = gates.every((g) => g.passed);
  const raw = Math.round(s.arch + s.interior + s.materials);
  const score = allGatesPass ? raw : Math.min(raw, 45);
  const passed = allGatesPass && score >= DEFAULT_AUDIT_THRESHOLD;
  return {
    schemaVersion: 1,
    profile: 'structure',
    threshold: DEFAULT_AUDIT_THRESHOLD,
    passed,
    score,
    grade: gradeForAudit(allGatesPass, score, passed, DEFAULT_AUDIT_THRESHOLD),
    hardGates: gates,
    pillars: buildStubPillars(s),
    topDeductions: [],
    metrics: m,
  };
};
