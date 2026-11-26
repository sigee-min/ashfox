import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing } from '../../../project/structure/contract';
import type { InteriorDraperySpec, InteriorRenderLayer, SubVoxelBoxIR } from './contract';

/** Computes a true hyperbolic catenary sag displacement at t in [0, 1]. */
export const catenarySagFactor = (t: number, stiffness = 1.6): number => {
  const u = Math.max(0, Math.min(1, t));
  if (stiffness <= 0.05) return 4 * u * (1 - u);
  const denom = Math.cosh(stiffness) - 1;
  return denom <= 1e-6
    ? 4 * u * (1 - u)
    : (Math.cosh(stiffness) - Math.cosh(stiffness * (2 * u - 1))) / denom;
};

/** Samples a 3D point in 1/16 coordinates along a catenary curve sagging downward in -Y. */
export const sampleCatenaryPoint = (from16: Vec3, to16: Vec3, sag16: number, t: number): Vec3 => {
  const u = Math.max(0, Math.min(1, t));
  const drop = Math.max(0, sag16) * catenarySagFactor(u);
  return [
    from16[0] + (to16[0] - from16[0]) * u,
    from16[1] + (to16[1] - from16[1]) * u - drop,
    from16[2] + (to16[2] - from16[2]) * u,
  ];
};

const makeBox = (
  id: string,
  from: Vec3,
  to: Vec3,
  tile: string,
  tag: string,
  color?: string,
  layer: InteriorRenderLayer = 'opaque',
): SubVoxelBoxIR => ({
  id,
  from_16: [Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.min(from[2], to[2])],
  to_16: [Math.max(from[0], to[0]), Math.max(from[1], to[1]), Math.max(from[2], to[2])],
  tile_id: tile,
  layer,
  ...(color ? { color_tint: color } : {}),
  semantic_tag: tag,
});

const spanAxes = (from16: Vec3, to16: Vec3, facing?: CardinalFacing) => {
  const dx = Math.abs(to16[0] - from16[0]);
  const dz = Math.abs(to16[2] - from16[2]);
  const alongX = facing ? facing === 'north' || facing === 'south' : dx >= dz;
  const u0 = alongX ? Math.min(from16[0], to16[0]) : Math.min(from16[2], to16[2]);
  const u1 = alongX ? Math.max(from16[0], to16[0]) : Math.max(from16[2], to16[2]);
  const fixed = alongX ? (from16[2] + to16[2]) / 2 : (from16[0] + to16[0]) / 2;
  const yTop = Math.max(from16[1], to16[1]);
  const yBot = Math.min(from16[1], to16[1]);
  return { alongX, u0, u1, fixed, yTop, yBot, width: Math.max(4, u1 - u0) };
};

const axisBox = (
  id: string,
  alongX: boolean,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  n0: number,
  n1: number,
  tile: string,
  tag: string,
  color?: string,
): SubVoxelBoxIR =>
  alongX
    ? makeBox(id, [u0, y0, n0], [u1, y1, n1], tile, tag, color)
    : makeBox(id, [n0, y0, u0], [n1, y1, u1], tile, tag, color);

const buildCurtainPanel = (
  spec: InteriorDraperySpec,
  p: number,
  baseU: number,
  panelW: number,
  alongX: boolean,
  fixed: number,
  yTop: number,
  drop: number,
  tile: string,
): readonly SubVoxelBoxIR[] => {
  const rows = 4;
  const isLeft = p === 0;
  const out: SubVoxelBoxIR[] = [];
  for (let r = 0; r < rows; r += 1) {
    const y0 = yTop - 1 - ((r + 1) * drop) / rows;
    const y1 = yTop - 1 - (r * drop) / rows;
    const pinch = spec.tieback && r === 2 ? (isLeft ? -1.5 : 1.5) : 0;
    const wScale = spec.tieback && r === 2 ? 0.65 : 1;
    const pleat = Math.sin((r + p) * 1.6) * 0.8;
    const pu0 = baseU + (isLeft ? 0 : panelW * (1 - wScale)) + pinch;
    out.push(
      axisBox(
        `${spec.id}:p${p}_${r}`,
        alongX,
        pu0,
        pu0 + panelW * wScale,
        y0,
        y1,
        fixed - 1 + pleat,
        fixed + 1 + pleat,
        tile,
        'drapery:curtains',
        spec.color,
      ),
    );
  }
  return out;
};

const buildCurtains = (spec: InteriorDraperySpec): readonly SubVoxelBoxIR[] => {
  const { alongX, u0, u1, fixed, yTop, yBot, width } = spanAxes(
    spec.from_16,
    spec.to_16,
    spec.facing,
  );
  const drop = Math.max(12, yTop - yBot);
  const tile = spec.tile_id ?? 'carpet_red';
  const out: SubVoxelBoxIR[] = [
    axisBox(
      `${spec.id}:rod`,
      alongX,
      u0 - 1,
      u1 + 1,
      yTop - 1,
      yTop,
      fixed - 0.5,
      fixed + 0.5,
      'iron_flue',
      'drapery:curtains',
    ),
  ];
  const panels = Math.max(1, spec.split_panels ?? 2);
  const panelW = Math.max(3, Math.min(8, width / (panels + 1)));
  for (let p = 0; p < panels; p += 1) {
    const baseU = p === 0 ? u0 : u1 - panelW;
    out.push(...buildCurtainPanel(spec, p, baseU, panelW, alongX, fixed, yTop, drop, tile));
  }
  return out;
};

const buildNoren = (spec: InteriorDraperySpec): readonly SubVoxelBoxIR[] => {
  const { alongX, u0, u1, fixed, yTop, width } = spanAxes(spec.from_16, spec.to_16, spec.facing);
  const panels = Math.max(2, spec.split_panels ?? 3);
  const tile = spec.tile_id ?? 'carpet_blue';
  const drop = Math.max(8, Math.min(14, Math.abs(spec.from_16[1] - spec.to_16[1]) || 10));
  const out: SubVoxelBoxIR[] = [
    axisBox(
      `${spec.id}:pole`,
      alongX,
      u0 - 0.5,
      u1 + 0.5,
      yTop - 1,
      yTop,
      fixed - 0.6,
      fixed + 0.6,
      'timber_trim',
      'drapery:noren',
    ),
  ];
  const gap = 0.8;
  const pw = (width - gap * (panels - 1)) / panels;
  for (let i = 0; i < panels; i += 1) {
    const pu0 = u0 + i * (pw + gap);
    const flutter = ((i % 2) * 2 - 1) * 0.4;
    const hemDip = catenarySagFactor((i + 0.5) / panels) * Math.min(2, spec.sag_16 * 0.3);
    out.push(
      axisBox(
        `${spec.id}:slit_${i}`,
        alongX,
        pu0,
        pu0 + pw,
        yTop - 1 - drop - hemDip,
        yTop - 1,
        fixed - 0.5 + flutter,
        fixed + 0.5 + flutter,
        tile,
        'drapery:noren',
        spec.color,
      ),
    );
  }
  return out;
};

const buildTrailingVine = (spec: InteriorDraperySpec): readonly SubVoxelBoxIR[] => {
  const { alongX, u0, fixed, yTop, width } = spanAxes(spec.from_16, spec.to_16, spec.facing);
  const strands = Math.max(3, Math.floor(width / 4));
  const tile = spec.tile_id ?? 'leaves';
  const out: SubVoxelBoxIR[] = [];
  for (let s = 0; s < strands; s += 1) {
    const u = u0 + ((s + 0.5) * width) / strands;
    const len = 6 + ((s * 7) % Math.max(4, Math.round(spec.sag_16 + 6)));
    const steps = Math.max(3, Math.ceil(len / 3));
    for (let k = 0; k < steps; k += 1) {
      const y1 = yTop - (k * len) / steps;
      const y0 = yTop - ((k + 1) * len) / steps;
      const sway = Math.sin(s * 1.7 + k * 0.9) * 0.9;
      out.push(
        axisBox(
          `${spec.id}:v${s}_${k}`,
          alongX,
          u - 0.9 + sway,
          u + 0.9 + sway,
          y0,
          y1,
          fixed - 0.9,
          fixed + 0.9,
          tile,
          'drapery:trailing_vine',
          spec.color,
        ),
      );
    }
  }
  return out;
};

const buildWallHanging = (
  spec: InteriorDraperySpec,
  isBanner: boolean,
): readonly SubVoxelBoxIR[] => {
  const { alongX, u0, u1, fixed, yTop, yBot, width } = spanAxes(
    spec.from_16,
    spec.to_16,
    spec.facing,
  );
  const drop = Math.max(12, yTop - yBot);
  const tile = spec.tile_id ?? (isBanner ? 'carpet_blue' : 'carpet_red');
  const out: SubVoxelBoxIR[] = [
    axisBox(
      `${spec.id}:bar`,
      alongX,
      u0 - 1,
      u1 + 1,
      yTop - 1,
      yTop,
      fixed - 0.7,
      fixed + 0.7,
      'timber_trim',
      `drapery:${spec.kind}`,
    ),
  ];
  const segs = 4;
  for (let i = 0; i < segs; i += 1) {
    const t = (i + 0.5) / segs;
    const billow = catenarySagFactor(t) * Math.min(2.5, spec.sag_16 * 0.4);
    const y1 = yTop - 1 - (i * drop) / segs;
    const y0 = yTop - 1 - ((i + 1) * drop) / segs;
    const inset = isBanner && i === segs - 1 ? width * 0.2 : 0;
    out.push(
      axisBox(
        `${spec.id}:seg_${i}`,
        alongX,
        u0 + inset,
        u1 - inset,
        y0,
        y1,
        fixed - 0.6 + billow,
        fixed + 0.6 + billow,
        tile,
        `drapery:${spec.kind}`,
        spec.color,
      ),
    );
  }
  return out;
};

const buildCatenaryStrand = (
  id: string,
  from16: Vec3,
  to16: Vec3,
  sag16: number,
  radius: number,
  tile: string,
  tag: string,
  color?: string,
): readonly SubVoxelBoxIR[] => {
  const dx = to16[0] - from16[0];
  const dy = to16[1] - from16[1];
  const dz = to16[2] - from16[2];
  const span = Math.hypot(dx, dy, dz);
  const steps = Math.max(4, Math.min(24, Math.ceil(span / 2.5)));
  const out: SubVoxelBoxIR[] = [];
  for (let i = 0; i < steps; i += 1) {
    const p0 = sampleCatenaryPoint(from16, to16, sag16, i / steps);
    const p1 = sampleCatenaryPoint(from16, to16, sag16, (i + 1) / steps);
    const r = tag === 'drapery:chains' && i % 2 === 1 ? radius * 1.25 : radius;
    out.push(
      makeBox(
        `${id}_${i}`,
        [Math.min(p0[0], p1[0]) - r, Math.min(p0[1], p1[1]) - r, Math.min(p0[2], p1[2]) - r],
        [Math.max(p0[0], p1[0]) + r, Math.max(p0[1], p1[1]) + r, Math.max(p0[2], p1[2]) + r],
        tile,
        tag,
        color,
      ),
    );
  }
  return out;
};

const buildCables = (spec: InteriorDraperySpec): readonly SubVoxelBoxIR[] => {
  const tile = spec.tile_id ?? 'iron_flue';
  const main = buildCatenaryStrand(
    `${spec.id}:main`,
    spec.from_16,
    spec.to_16,
    spec.sag_16,
    0.9,
    tile,
    'drapery:cables',
  );
  const subFrom: Vec3 = [spec.from_16[0], spec.from_16[1] - 0.5, spec.from_16[2] + 1];
  const subTo: Vec3 = [spec.to_16[0], spec.to_16[1] - 0.5, spec.to_16[2] + 1];
  const sub = buildCatenaryStrand(
    `${spec.id}:sub`,
    subFrom,
    subTo,
    spec.sag_16 + 1.5,
    0.6,
    'window_glow',
    'drapery:cables',
    spec.color ?? '#4ce8ff',
  );
  return [...main, ...sub];
};

const buildPipes = (spec: InteriorDraperySpec): readonly SubVoxelBoxIR[] => {
  const tile = spec.tile_id ?? 'iron_flue';
  const midX = (spec.from_16[0] + spec.to_16[0]) / 2;
  return [
    makeBox(
      `${spec.id}:run_a`,
      [spec.from_16[0] - 1, spec.from_16[1] - 1, spec.from_16[2] - 1],
      [midX + 1, spec.from_16[1] + 1, spec.from_16[2] + 1],
      tile,
      'drapery:pipes',
      spec.color,
    ),
    makeBox(
      `${spec.id}:elbow`,
      [
        midX - 1.3,
        Math.min(spec.from_16[1], spec.to_16[1]) - 1.3,
        Math.min(spec.from_16[2], spec.to_16[2]) - 1.3,
      ],
      [
        midX + 1.3,
        Math.max(spec.from_16[1], spec.to_16[1]) + 1.3,
        Math.max(spec.from_16[2], spec.to_16[2]) + 1.3,
      ],
      'iron_block',
      'drapery:pipes',
    ),
    makeBox(
      `${spec.id}:run_b`,
      [midX - 1, spec.to_16[1] - 1, spec.to_16[2] - 1],
      [spec.to_16[0] + 1, spec.to_16[1] + 1, spec.to_16[2] + 1],
      tile,
      'drapery:pipes',
      spec.color,
    ),
  ];
};

const buildCablesOrPipes = (spec: InteriorDraperySpec): readonly SubVoxelBoxIR[] =>
  spec.kind === 'cables' ? buildCables(spec) : buildPipes(spec);

/** Generates 1/16 sub-voxel catenary drapery, vines, chains, cables, or pipes. */
export const compileDrapery = (spec: InteriorDraperySpec): readonly SubVoxelBoxIR[] => {
  if (spec.kind === 'curtains') return buildCurtains(spec);
  if (spec.kind === 'noren') return buildNoren(spec);
  if (spec.kind === 'trailing_vine') return buildTrailingVine(spec);
  if (spec.kind === 'tapestry' || spec.kind === 'banner') {
    return buildWallHanging(spec, spec.kind === 'banner');
  }
  if (spec.kind === 'chains') {
    return buildCatenaryStrand(
      spec.id,
      spec.from_16,
      spec.to_16,
      spec.sag_16,
      0.85,
      spec.tile_id ?? 'iron_flue',
      'drapery:chains',
      spec.color,
    );
  }
  return buildCablesOrPipes(spec);
};

/** Compiles all drapery specs in deterministic order. */
export const compileAllDraperies = (
  specs: readonly InteriorDraperySpec[],
): readonly SubVoxelBoxIR[] => specs.flatMap((s) => compileDrapery(s));
