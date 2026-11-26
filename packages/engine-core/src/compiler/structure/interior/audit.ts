import {
  DEFAULT_AUDIT_THRESHOLD,
  auditSubmetric,
  clamp01,
  gradeForAudit,
  ramp,
  round4,
  type AuditSubmetricShape,
} from '@ashfox/internal-contracts';
import { deepFreeze } from '../../../immutable';
import type { IntVec3 } from '../../../project/structure/contract';
import {
  DEFAULT_ORGANIC_BY_ARCH,
  MIN_VANILLA_HEADROOM_BLOCKS,
  SUBVOXEL_UNITS_PER_BLOCK,
  type InteriorAuditGate,
  type InteriorAuditMetrics,
  type InteriorAuditReport,
  type InteriorOpeningSpan,
  type InteriorRadiosityField,
  type InteriorRoomInput,
  type InteriorSubVoxelIR,
  type InteriorSunShaftQuad,
  type PlayableInteriorMeta,
  type SubVoxelBoxIR,
  type VanillaNbtLoweringIR,
} from './contract';
import { computeRadiosityColorContrast } from './radiosity';

export interface InteriorAuditInput {
  readonly room: InteriorRoomInput;
  readonly ir: InteriorSubVoxelIR;
  readonly radiosity: InteriorRadiosityField;
  readonly sunShafts: readonly InteriorSunShaftQuad[];
  readonly playableMeta: PlayableInteriorMeta;
  readonly nbt?: VanillaNbtLoweringIR;
}

const cellKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;

const countShellLayers = (room: InteriorRoomInput): number => {
  const a = room.architecture;
  return (
    1 +
    (a.baseboard !== 'none' ? 1 : 0) +
    (a.wainscot !== 'none' ? 1 : 0) +
    (a.molding && a.molding !== 'none' ? 1 : 0) +
    (a.ceiling !== 'flat' ? 1 : 0)
  );
};

const findOpeningSeedCell = (
  op: InteriorOpeningSpan,
  clearSet: ReadonlyMap<string, IntVec3>,
): IntVec3 | null => {
  for (let z = op.from[2] - 1; z <= op.to[2] + 1; z += 1) {
    for (let x = op.from[0] - 1; x <= op.to[0] + 1; x += 1) {
      const hit =
        clearSet.get(cellKey(x, op.from[1], z)) ?? clearSet.get(cellKey(x, op.from[1] + 1, z));
      if (hit) return hit;
    }
  }
  return null;
};

const findBfsSeedCell = (
  room: InteriorRoomInput,
  clearSet: ReadonlyMap<string, IntVec3>,
): IntVec3 | null => {
  for (const op of room.openings) {
    if (op.kind !== 'door' && op.kind !== 'arch') continue;
    const hit = findOpeningSeedCell(op, clearSet);
    if (hit) return hit;
  }
  const first = clearSet.values().next();
  return first.done ? null : first.value;
};

const BFS_STEPS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const expandClearNeighbors = (
  cur: IntVec3,
  clearSet: ReadonlyMap<string, IntVec3>,
  visited: Set<string>,
  queue: IntVec3[],
): void => {
  const [cx, cy, cz] = cur;
  for (const [dx, dz] of BFS_STEPS) {
    for (let dy = -1; dy <= 1; dy += 1) {
      const key = cellKey(cx + dx, cy + dy, cz + dz);
      if (visited.has(key)) continue;
      const next = clearSet.get(key);
      if (!next) continue;
      visited.add(key);
      queue.push(next);
    }
  }
};

const computeClearPathRatio = (room: InteriorRoomInput, ir: InteriorSubVoxelIR): number => {
  if (ir.clear_path_cells.length === 0) return 0;
  const clearSet = new Map<string, IntVec3>();
  for (const c of ir.clear_path_cells) clearSet.set(cellKey(c[0], c[1], c[2]), c);
  const seed = findBfsSeedCell(room, clearSet);
  if (!seed) return 0;
  const visited = new Set<string>([cellKey(seed[0], seed[1], seed[2])]);
  const queue: IntVec3[] = [seed];
  for (let head = 0; head < queue.length; head += 1)
    expandClearNeighbors(queue[head]!, clearSet, visited, queue);
  const w = Math.max(1, room.bounds_to[0] - room.bounds_from[0] + 1);
  const d = Math.max(1, room.bounds_to[2] - room.bounds_from[2] + 1);
  const connectivity = visited.size / clearSet.size;
  const coverage = Math.min(1, clearSet.size / Math.max(1, w * d * 0.45));
  return round4(clamp01(connectivity * coverage));
};

const isOverheadObstruction = (box: SubVoxelBoxIR): boolean => {
  const tag = (box.semantic_tag ?? '').toLowerCase();
  return (
    box.layer === 'opaque' &&
    !tag.includes('floor') &&
    !tag.includes('carpet') &&
    !tag.includes('rug')
  );
};

const cellHeadroom = (
  cell: IntVec3,
  overheadBoxes: readonly SubVoxelBoxIR[],
  ceilingY: number,
): number => {
  const [cx, cy, cz] = cell;
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  let localTop = ceilingY;
  for (const box of overheadBoxes) {
    if (box.to_16[0] <= cx * u + 2 || box.from_16[0] >= (cx + 1) * u - 2) continue;
    if (box.to_16[2] <= cz * u + 2 || box.from_16[2] >= (cz + 1) * u - 2) continue;
    const bottomB = box.from_16[1] / u;
    if (bottomB > cy && bottomB < localTop) localTop = bottomB;
  }
  return localTop - cy;
};

const computeMinHeadroom = (room: InteriorRoomInput, ir: InteriorSubVoxelIR): number => {
  if (ir.clear_path_cells.length === 0) return 0;
  const ceilingY = room.bounds_to[1] + 1;
  const overhead = ir.boxes.filter(isOverheadObstruction);
  let minHeadroom = ceilingY - room.bounds_from[1];
  for (const cell of ir.clear_path_cells) {
    minHeadroom = Math.min(minHeadroom, cellHeadroom(cell, overhead, ceilingY));
  }
  return round4(Math.max(0, minHeadroom));
};

const EXEMPT_TAGS = [
  'floor',
  'wall',
  'ceiling',
  'truss',
  'beam',
  'molding',
  'drape',
  'curtain',
  'noren',
  'banner',
  'cable',
  'pipe',
  'pendant',
  'chandelier',
  'shelf',
  'sconce',
] as const;

const isSupportedExempt = (box: SubVoxelBoxIR): boolean => {
  if (box.layer === 'translucent') return true;
  const tag = (box.semantic_tag ?? '').toLowerCase();
  return EXEMPT_TAGS.some((t) => tag.includes(t));
};

const boxesTouchOrSupport = (upper: SubVoxelBoxIR, lower: SubVoxelBoxIR): boolean => {
  if (upper.id === lower.id) return false;
  const eps = 1.5;
  const overlapX =
    upper.to_16[0] >= lower.from_16[0] - eps && upper.from_16[0] <= lower.to_16[0] + eps;
  const overlapZ =
    upper.to_16[2] >= lower.from_16[2] - eps && upper.from_16[2] <= lower.to_16[2] + eps;
  return (
    overlapX &&
    overlapZ &&
    upper.from_16[1] <= lower.to_16[1] + eps &&
    upper.to_16[1] >= lower.from_16[1] - eps
  );
};

const countFloatingBoxes = (room: InteriorRoomInput, ir: InteriorSubVoxelIR): number => {
  const floor16 = (room.bounds_from[1] + 1) * SUBVOXEL_UNITS_PER_BLOCK;
  let floating = 0;
  for (const box of ir.boxes) {
    if (isSupportedExempt(box) || box.from_16[1] <= floor16 + 2) continue;
    if (!ir.boxes.some((other) => boxesTouchOrSupport(box, other))) floating += 1;
  }
  return floating;
};

const openingBlockedByBox = (op: InteriorOpeningSpan, box: SubVoxelBoxIR): boolean => {
  if (box.layer === 'translucent') return false;
  const tag = (box.semantic_tag ?? '').toLowerCase();
  if (
    tag.includes('door') ||
    tag.includes('pane') ||
    tag.includes('noren') ||
    tag.includes('curtain') ||
    tag.includes('frame') ||
    tag.includes('wall')
  ) {
    return false;
  }
  const u = SUBVOXEL_UNITS_PER_BLOCK;
  return (
    box.to_16[0] > op.from[0] * u + 2 &&
    box.from_16[0] < (op.to[0] + 1) * u - 2 &&
    box.to_16[1] > op.from[1] * u + 2 &&
    box.from_16[1] < (op.to[1] + 1) * u - 2 &&
    box.to_16[2] > op.from[2] * u + 2 &&
    box.from_16[2] < (op.to[2] + 1) * u - 2
  );
};

const countBlockedOpenings = (room: InteriorRoomInput, ir: InteriorSubVoxelIR): number =>
  room.openings.filter((op) => ir.boxes.some((box) => openingBlockedByBox(op, box))).length;

const computeOrganicDelta = (room: InteriorRoomInput): number => {
  const target =
    0.5 *
    (DEFAULT_ORGANIC_BY_ARCH[room.style_dna.arch] + DEFAULT_ORGANIC_BY_ARCH[room.style_dna.furn]);
  return round4(Math.abs(room.style_dna.organic - target));
};

const hookDiversityRatio = (meta: PlayableInteriorMeta): number => {
  const kinds = new Set<string>();
  for (const h of meta.hooks) kinds.add(h.kind === 'slide' ? 'hinge' : h.kind);
  return clamp01(kinds.size / 4);
};

const makeGate = (
  id: string,
  passed: boolean,
  message: string,
  fix: string,
): InteriorAuditGate => ({ id, passed, message, fix });

const buildGates = (
  metrics: InteriorAuditMetrics,
  input: InteriorAuditInput,
): readonly InteriorAuditGate[] => {
  const nbtOk = input.nbt ? input.nbt.clearance.passed : true;
  return [
    makeGate(
      'vanilla_headroom',
      metrics.min_headroom_b >= MIN_VANILLA_HEADROOM_BLOCKS && nbtOk,
      `Minimum interior headroom is ${metrics.min_headroom_b.toFixed(2)}b (min ${MIN_VANILLA_HEADROOM_BLOCKS}b).`,
      'Raise low beams, mezzanine soffits, or hanging props to keep >= 2 blocks of headroom.',
    ),
    makeGate(
      'no_floating_blocks',
      metrics.floating_block_count === 0,
      metrics.floating_block_count === 0
        ? 'All non-hanging interior props are grounded or supported.'
        : `Detected ${metrics.floating_block_count} floating interior box(es).`,
      'Seat all furniture, tabletop stories, and props onto floor or surface_y_16.',
    ),
    makeGate(
      'unblocked_openings',
      metrics.blocked_opening_count === 0,
      metrics.blocked_opening_count === 0
        ? 'All doors, arches, and windows are unobstructed.'
        : `Detected ${metrics.blocked_opening_count} blocked opening(s).`,
      'Keep furniture and counters clear of door/window opening spans.',
    ),
    makeGate(
      'clear_path_bfs',
      metrics.clear_path_ratio >= 0.25 && input.ir.clear_path_cells.length > 0,
      `BFS clear_path ratio is ${Math.round(metrics.clear_path_ratio * 100)}%.`,
      'Maintain a continuous 1x2x1 BFS-reachable path between doors and room stations.',
    ),
    makeGate(
      'playable_hooks_present',
      metrics.playable_hook_count >= 1,
      `Emitted ${metrics.playable_hook_count} playable/audio interior hook(s).`,
      'Emit sit, hinge/slide, toggle_light, station, and spatial audio emitter hooks.',
    ),
  ];
};

const buildSubmetrics = (
  m: InteriorAuditMetrics,
  hookDiv: number,
): readonly AuditSubmetricShape[] => [
  auditSubmetric(
    'interior.volume',
    'Spatial Volume & 5-Layer Shell',
    0.6 * ramp(m.volume_feature_count, 1, 3) + 0.4 * ramp(m.shell_layer_count, 2, 5),
    20,
    m.volume_feature_count,
    3,
    `${m.volume_feature_count} volume feature(s), ${m.shell_layer_count}/5 shell layers`,
  ),
  auditSubmetric(
    'interior.radiosity',
    '2-Bounce Radiosity & Sun Shafts',
    0.65 * ramp(m.bounce_color_contrast, 0.08, 0.45) + 0.35 * ramp(m.sun_shaft_count, 1, 3),
    20,
    m.bounce_color_contrast,
    0.35,
    `contrast ${m.bounce_color_contrast.toFixed(2)}, ${m.sun_shaft_count} sun shaft(s)`,
  ),
  auditSubmetric(
    'interior.organic',
    'Style DNA Organic Calibration',
    clamp01(1 - ramp(m.organic_calibration_delta, 0.1, 0.55)),
    15,
    m.organic_calibration_delta,
    0,
    `delta ${m.organic_calibration_delta.toFixed(2)} from style_dna target`,
  ),
  auditSubmetric(
    'interior.circulation',
    'BFS Clear Path & Headroom',
    0.65 * ramp(m.clear_path_ratio, 0.25, 0.65) + 0.35 * ramp(m.min_headroom_b, 2.0, 3.5),
    20,
    m.clear_path_ratio,
    0.6,
    `${Math.round(m.clear_path_ratio * 100)}% BFS clear_path, ${m.min_headroom_b.toFixed(1)}b headroom`,
  ),
  auditSubmetric(
    'interior.playable',
    'Playable & Spatial Audio Hooks',
    0.5 * ramp(m.playable_hook_count, 2, 6) + 0.5 * hookDiv,
    15,
    m.playable_hook_count,
    5,
    `${m.playable_hook_count} hook(s), ${Math.round(hookDiv * 100)}% kind diversity`,
  ),
  auditSubmetric(
    'interior.integrity',
    'Vanilla MC Structural Integrity',
    (m.floating_block_count === 0 ? 0.5 : 0) + (m.blocked_opening_count === 0 ? 0.5 : 0),
    10,
    m.floating_block_count + m.blocked_opening_count,
    0,
    `${m.floating_block_count} floating, ${m.blocked_opening_count} blocked opening(s)`,
  ),
];

/** Evaluates interior quality audit across spatial volume, 2-bounce GI, organic DNA, BFS clear_path, and hooks. */
export const evaluateInteriorAudit = (input: InteriorAuditInput): InteriorAuditReport => {
  const { room, ir, radiosity, sunShafts, playableMeta, nbt } = input;
  const metrics: InteriorAuditMetrics = {
    volume_feature_count: room.volumes.length,
    shell_layer_count: countShellLayers(room),
    bounce_color_contrast: computeRadiosityColorContrast(radiosity),
    sun_shaft_count: sunShafts.length,
    organic_calibration_delta: computeOrganicDelta(room),
    clear_path_ratio: computeClearPathRatio(room, ir),
    min_headroom_b: nbt ? nbt.clearance.min_headroom_b : computeMinHeadroom(room, ir),
    floating_block_count: nbt ? nbt.clearance.floating_block_count : countFloatingBoxes(room, ir),
    blocked_opening_count: nbt
      ? nbt.clearance.blocked_opening_count
      : countBlockedOpenings(room, ir),
    playable_hook_count: playableMeta.hooks.length,
  };
  const hard_gates = buildGates(metrics, input);
  const submetrics = buildSubmetrics(metrics, hookDiversityRatio(playableMeta));
  const allGatesPass = hard_gates.every((g) => g.passed);
  const rawScore = Math.round(submetrics.reduce((sum, s) => sum + s.score, 0));
  const score = Math.max(0, Math.min(allGatesPass ? 100 : 45, rawScore));
  const passed = allGatesPass && score >= DEFAULT_AUDIT_THRESHOLD;
  return deepFreeze({
    schema_version: 1 as const,
    passed,
    score,
    grade: gradeForAudit(allGatesPass, score, passed, DEFAULT_AUDIT_THRESHOLD),
    hard_gates,
    submetrics,
    metrics,
  });
};
