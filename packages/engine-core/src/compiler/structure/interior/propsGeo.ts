import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing } from '../../../project/structure/contract';
import type { InteriorRenderLayer, StyleDnaArch, SubVoxelBoxIR } from './contract';

export interface StyleMaterials {
  readonly wood: string;
  readonly darkWood: string;
  readonly trim: string;
  readonly metal: string;
  readonly stone: string;
  readonly fabric: string;
  readonly accent: string;
  readonly emissiveColor: string;
}

export interface JoinEdges {
  readonly left: boolean;
  readonly right: boolean;
  readonly front: boolean;
  readonly back: boolean;
}

export const NO_JOINS: JoinEdges = { left: false, right: false, front: false, back: false };

const STYLE_MATERIALS: Readonly<Record<StyleDnaArch, StyleMaterials>> = {
  rustic: {
    wood: 'oak_planks',
    darkWood: 'spruce_planks',
    trim: 'timber_trim',
    metal: 'iron_flue',
    stone: 'cobblestone',
    fabric: 'carpet_red',
    accent: 'gold_block',
    emissiveColor: '#ff9e3d',
  },
  japanese: {
    wood: 'birch_planks',
    darkWood: 'dark_oak_planks',
    trim: 'timber_trim',
    metal: 'iron_flue',
    stone: 'smooth_stone',
    fabric: 'carpet_moss',
    accent: 'plaster_cream',
    emissiveColor: '#ffe29a',
  },
  modern: {
    wood: 'birch_planks',
    darkWood: 'dark_oak_planks',
    trim: 'plaster_white',
    metal: 'iron_flue',
    stone: 'smooth_stone',
    fabric: 'carpet_blue',
    accent: 'iron_block',
    emissiveColor: '#fff4d6',
  },
  scifi: {
    wood: 'iron_block',
    darkWood: 'deepslate_tiles',
    trim: 'iron_flue',
    metal: 'iron_flue',
    stone: 'deepslate_bricks',
    fabric: 'carpet_blue',
    accent: 'window_glow',
    emissiveColor: '#4ce8ff',
  },
  gothic: {
    wood: 'dark_oak_planks',
    darkWood: 'spruce_planks',
    trim: 'timber_trim',
    metal: 'iron_flue',
    stone: 'deepslate_bricks',
    fabric: 'carpet_red',
    accent: 'gold_block',
    emissiveColor: '#a855f7',
  },
  desert: {
    wood: 'terracotta',
    darkWood: 'oak_planks',
    trim: 'plaster_cream',
    metal: 'gold_block',
    stone: 'terracotta',
    fabric: 'carpet_red',
    accent: 'gold_block',
    emissiveColor: '#ffb84d',
  },
  industrial: {
    wood: 'spruce_planks',
    darkWood: 'deepslate_tiles',
    trim: 'iron_flue',
    metal: 'iron_flue',
    stone: 'bricks',
    fabric: 'carpet_moss',
    accent: 'iron_block',
    emissiveColor: '#ff8c3a',
  },
  nordic: {
    wood: 'birch_planks',
    darkWood: 'oak_planks',
    trim: 'plaster_white',
    metal: 'iron_flue',
    stone: 'stone_bricks',
    fabric: 'carpet_blue',
    accent: 'plaster_cream',
    emissiveColor: '#ffe9b8',
  },
};

export const materialsForStyle = (arch: StyleDnaArch): StyleMaterials => STYLE_MATERIALS[arch];

/** Deterministic 32-bit FNV-1a hash normalized to [0, 1). */
export const hashSeed01 = (seed: number, salt: string): number => {
  let h = (2166136261 ^ (seed | 0)) >>> 0;
  for (let i = 0; i < salt.length; i += 1) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h / 4294967296;
};

export const signedSeed = (seed: number, salt: string): number => hashSeed01(seed, salt) * 2 - 1;

export interface LocalBoxDraft {
  readonly tag: string;
  readonly from: Vec3;
  readonly to: Vec3;
  readonly tile: string;
  readonly layer?: InteriorRenderLayer;
  readonly colorTint?: string;
}

export const box16 = (
  tag: string,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  tile: string,
  layer: InteriorRenderLayer = 'opaque',
  colorTint?: string,
): LocalBoxDraft => ({
  tag,
  from: [x0, y0, z0],
  to: [x1, y1, z1],
  tile,
  layer,
  ...(colorTint ? { colorTint } : {}),
});

const rotatePt = ([x, y, z]: Vec3, w16: number, d16: number, facing: CardinalFacing): Vec3 => {
  if (facing === 'east') return [d16 - z, y, x];
  if (facing === 'south') return [w16 - x, y, d16 - z];
  if (facing === 'west') return [z, y, w16 - x];
  return [x, y, z];
};

export const finalizeLocalBoxes = (
  id: string,
  drafts: readonly LocalBoxDraft[],
  origin16: Vec3,
  w16: number,
  d16: number,
  facing: CardinalFacing,
  rotationYDeg = 0,
  zoneId?: string,
): readonly SubVoxelBoxIR[] => {
  const rotW = facing === 'east' || facing === 'west' ? d16 : w16;
  const rotD = facing === 'east' || facing === 'west' ? w16 : d16;
  const pivot: Vec3 = [origin16[0] + rotW / 2, origin16[1], origin16[2] + rotD / 2];
  return drafts.map((b, idx) => {
    const a = rotatePt(b.from, w16, d16, facing);
    const c = rotatePt(b.to, w16, d16, facing);
    const from16: Vec3 = [
      origin16[0] + Math.min(a[0], c[0]),
      origin16[1] + Math.min(a[1], c[1]),
      origin16[2] + Math.min(a[2], c[2]),
    ];
    const to16: Vec3 = [
      origin16[0] + Math.max(a[0], c[0]),
      origin16[1] + Math.max(a[1], c[1]),
      origin16[2] + Math.max(a[2], c[2]),
    ];
    return {
      id: `${id}:${b.tag}:${idx}`,
      from_16: from16,
      to_16: to16,
      tile_id: b.tile,
      layer: b.layer ?? 'opaque',
      ...(b.colorTint ? { color_tint: b.colorTint } : {}),
      ...(Math.abs(rotationYDeg) > 0.01 ? { rotation_y_deg: rotationYDeg, pivot_16: pivot } : {}),
      ...(from16[1] === origin16[1] ? { contact_ao: 0.7 } : {}),
      semantic_tag: `prop:${b.tag}`,
      ...(zoneId ? { zone_id: zoneId } : {}),
    };
  });
};

const tableStyleDims = (isLow: boolean, style: StyleDnaArch, mat: StyleMaterials) => {
  const metalLeg = style === 'modern' || style === 'scifi';
  return {
    h: isLow ? 8 : 16,
    topThick: isLow ? 1.5 : 2.5,
    legTile: metalLeg ? mat.metal : mat.trim,
    legW: isLow ? 2 : style === 'modern' ? 1.5 : 2.5,
    inset: isLow ? 2 : 1.5,
  };
};

export const buildTableBoxes = (
  w16: number,
  d16: number,
  mat: StyleMaterials,
  joins: JoinEdges,
  isLow: boolean,
  style: StyleDnaArch,
): readonly LocalBoxDraft[] => {
  const { h, topThick, legTile, legW, inset } = tableStyleDims(isLow, style, mat);
  const out: LocalBoxDraft[] = [
    box16('top', 0, h - topThick, 0, w16, h, d16, mat.wood),
    box16(
      'apron',
      joins.left ? 0 : 1,
      h - topThick - 1.5,
      joins.front ? 0 : 1,
      joins.right ? w16 : w16 - 1,
      h - topThick,
      joins.back ? d16 : d16 - 1,
      mat.darkWood,
    ),
  ];
  const corners: readonly [boolean, number, number][] = [
    [!joins.left && !joins.front, inset, inset],
    [!joins.right && !joins.front, w16 - inset - legW, inset],
    [!joins.left && !joins.back, inset, d16 - inset - legW],
    [!joins.right && !joins.back, w16 - inset - legW, d16 - inset - legW],
  ];
  for (const [place, lx, lz] of corners) {
    if (place) out.push(box16('leg', lx, 0, lz, lx + legW, h - topThick - 1.5, lz + legW, legTile));
  }
  if (!isLow && style === 'scifi') {
    out.push(
      box16(
        'trim_glow',
        1,
        h - topThick,
        0,
        w16 - 1,
        h - topThick + 0.5,
        0.5,
        mat.accent,
        'emissive',
        mat.emissiveColor,
      ),
    );
  }
  return out;
};

export const buildCounterBoxes = (
  w16: number,
  d16: number,
  mat: StyleMaterials,
  isL: boolean,
  style: StyleDnaArch,
): readonly LocalBoxDraft[] => {
  const out: LocalBoxDraft[] = [
    box16('toe_kick', 1, 0, 2, w16 - 1, 2, 15, mat.darkWood),
    box16('body', 0.5, 2, 1, w16 - 0.5, 12, 15.5, mat.darkWood),
    box16('top', 0, 12, 0, w16, 14, 16, mat.wood),
  ];
  if (isL && d16 > 16) {
    out.push(
      box16('l_toe', 1, 0, 15, 15, 2, d16 - 1, mat.darkWood),
      box16('l_body', 0.5, 2, 15.5, 15.5, 12, d16 - 0.5, mat.darkWood),
      box16('l_top', 0, 12, 16, 16, 14, d16, mat.wood),
    );
  }
  if (style === 'rustic' || style === 'industrial') {
    out.push(box16('footrail', 0, 2.5, 0, w16, 3.5, 1, mat.metal));
  } else if (style === 'scifi' || style === 'modern') {
    out.push(
      box16('under_led', 1, 11.4, 0.2, w16 - 1, 12, 0.8, mat.accent, 'emissive', mat.emissiveColor),
    );
  }
  return out;
};

export const buildSofaBoxes = (
  w16: number,
  mat: StyleMaterials,
  joins: JoinEdges,
): readonly LocalBoxDraft[] => {
  const x0 = joins.left ? 0 : 2.5;
  const x1 = joins.right ? w16 : w16 - 2.5;
  const out: LocalBoxDraft[] = [
    box16('plinth', 1, 0, 2, w16 - 1, 2, 15, mat.trim),
    box16('base', x0, 2, 2, x1, 6, 15, mat.darkWood),
    box16('cushion', x0, 6, 2.5, x1, 8.5, 13.5, mat.fabric),
    box16('back', x0, 6, 13, x1, 15, 15.5, mat.fabric),
  ];
  if (!joins.left) out.push(box16('arm_l', 0, 2, 2, 2.5, 11, 15.5, mat.wood));
  if (!joins.right) out.push(box16('arm_r', w16 - 2.5, 2, 2, w16, 11, 15.5, mat.wood));
  return out;
};

export const buildChairBoxes = (
  mat: StyleMaterials,
  isSwivel: boolean,
): readonly LocalBoxDraft[] => {
  if (isSwivel) {
    return [
      box16('base_x', 3, 0, 7, 13, 1.5, 9, mat.metal),
      box16('base_z', 7, 0, 3, 9, 1.5, 13, mat.metal),
      box16('stem', 7, 1.5, 7, 9, 7, 9, mat.metal),
      box16('seat', 3, 7, 3, 13, 9, 13, mat.fabric),
      box16('back', 3.5, 9, 11.5, 12.5, 18.5, 13, mat.fabric),
      box16('arm_l', 2.5, 8.5, 4.5, 3.5, 11.5, 12, mat.metal),
      box16('arm_r', 12.5, 8.5, 4.5, 13.5, 11.5, 12, mat.metal),
    ];
  }
  return [
    box16('leg_fl', 3, 0, 3, 4.5, 7, 4.5, mat.trim),
    box16('leg_fr', 11.5, 0, 3, 13, 7, 4.5, mat.trim),
    box16('leg_bl', 3, 0, 11.5, 4.5, 18, 13, mat.trim),
    box16('leg_br', 11.5, 0, 11.5, 13, 18, 13, mat.trim),
    box16('seat', 2.5, 7, 2.5, 13.5, 8.5, 13.5, mat.wood),
    box16('slat_lo', 4.5, 11, 11.8, 11.5, 13, 12.8, mat.wood),
    box16('slat_hi', 4.5, 15, 11.8, 11.5, 17, 12.8, mat.wood),
  ];
};

export const buildCushionBoxes = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('pad', 2, 0, 2, 14, 2, 14, mat.fabric),
  box16('tuft', 3, 2, 3, 13, 2.8, 13, mat.accent),
];

export const buildShelvingBoxes = (
  w16: number,
  mat: StyleMaterials,
  isWallShelf: boolean,
  seed: number,
): readonly LocalBoxDraft[] => {
  if (isWallShelf) {
    return [
      box16('plank', 0, 0, 9, w16, 1.5, 16, mat.wood),
      box16('bracket_l', 2, -3, 11, 3.5, 0, 16, mat.metal),
      box16('bracket_r', w16 - 3.5, -3, 11, w16 - 2, 0, 16, mat.metal),
    ];
  }
  const out: LocalBoxDraft[] = [
    box16('side_l', 0, 0, 9, 1.5, 28, 16, mat.trim),
    box16('side_r', w16 - 1.5, 0, 9, w16, 28, 16, mat.trim),
    box16('back', 1.5, 2, 15, w16 - 1.5, 28, 16, mat.darkWood),
  ];
  for (const sy of [2, 10, 18, 26.5]) {
    out.push(box16('shelf', 1.5, sy, 9.5, w16 - 1.5, sy + 1.5, 15, mat.wood));
    if (sy < 20) {
      const bw = 2 + Math.floor(hashSeed01(seed, `bk_${sy}`) * 3);
      out.push(box16('books', 2.5, sy + 1.5, 10.5, 2.5 + bw, sy + 6, 14.5, mat.fabric));
    }
  }
  return out;
};

export const buildTerminalBoxes = (
  w16: number,
  mat: StyleMaterials,
  joins: JoinEdges,
): readonly LocalBoxDraft[] => {
  const x0 = joins.left ? 0 : 1;
  const x1 = joins.right ? w16 : w16 - 1;
  return [
    box16('pedestal', x0 + 1, 0, 4, x1 - 1, 10, 15, mat.darkWood),
    box16('desk', 0, 10, 1, w16, 12, 15.5, mat.metal),
    box16('keybank', 2, 12, 2.5, w16 - 2, 13.5, 8, mat.darkWood),
    box16('bezel', 1, 12, 11, w16 - 1, 24, 14, mat.metal),
    box16('screen', 2, 13.5, 10.4, w16 - 2, 22.5, 11.2, mat.accent, 'emissive', mat.emissiveColor),
  ];
};

export const buildFireplaceBoxes = (w16: number, mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('hearth', 0, 0, 0, w16, 3, 15, mat.stone),
  box16('jamb_l', 0, 3, 4, 4, 22, 16, mat.stone),
  box16('jamb_r', w16 - 4, 3, 4, w16, 22, 16, mat.stone),
  box16('fireback', 4, 3, 12, w16 - 4, 22, 16, mat.darkWood),
  box16('embers', 5, 3, 6, w16 - 5, 5.5, 12, 'hearth_ember', 'emissive', '#ff6a1a'),
  box16('flame', 6.5, 5.5, 7.5, w16 - 6.5, 11.5, 11, 'hearth_ember', 'emissive', '#ffb338'),
  box16('mantle', 0, 22, 2, w16, 25, 16, mat.wood),
  box16('hood', 2, 25, 6, w16 - 2, 32, 16, mat.stone),
];

export const buildStorageBoxes = (
  kind: 'barrel_rack' | 'display_case' | 'cabinet' | 'holo_screen',
  w16: number,
  mat: StyleMaterials,
): readonly LocalBoxDraft[] => {
  if (kind === 'barrel_rack') {
    return [
      box16('cradle_l', 1, 0, 2, 3, 14, 14, mat.trim),
      box16('cradle_r', w16 - 3, 0, 2, w16 - 1, 14, 14, mat.trim),
      box16('barrel_lo', 3, 2, 3, w16 - 3, 11, 13, 'barrel_side'),
      box16('hoop_l', 4, 1.8, 2.8, 5.5, 11.2, 13.2, mat.metal),
      box16('hoop_r', w16 - 5.5, 1.8, 2.8, w16 - 4, 11.2, 13.2, mat.metal),
      box16('spigot', w16 / 2 - 1, 5, 1, w16 / 2 + 1, 7, 3, mat.accent),
    ];
  }
  if (kind === 'display_case') {
    return [
      box16('plinth', 1, 0, 1, w16 - 1, 10, 15, mat.darkWood),
      box16('liner', 2, 10, 2, w16 - 2, 11.5, 14, mat.fabric),
      box16(
        'relic',
        w16 / 2 - 2,
        11.5,
        6,
        w16 / 2 + 2,
        16,
        10,
        mat.accent,
        'emissive',
        mat.emissiveColor,
      ),
      box16('glass', 1.5, 10, 1.5, w16 - 1.5, 24, 14.5, 'glass', 'translucent'),
      box16('cap', 1, 24, 1, w16 - 1, 25.5, 15, mat.trim),
    ];
  }
  if (kind === 'holo_screen') {
    return [
      box16('emitter', 2, 0, 6, w16 - 2, 3, 10, mat.metal),
      box16('beam', 2, 3, 7.5, w16 - 2, 22, 8.5, mat.accent, 'translucent', mat.emissiveColor),
      box16('scan_hi', 3, 15, 7.2, w16 - 3, 18, 8.8, mat.accent, 'emissive', mat.emissiveColor),
      box16('scan_lo', 4, 8, 7.2, w16 - 4, 10.5, 8.8, mat.accent, 'emissive', mat.emissiveColor),
    ];
  }
  return [
    box16('plinth', 1, 0, 2, w16 - 1, 2, 15, mat.trim),
    box16('carcass', 0.5, 2, 2, w16 - 0.5, 22, 15.5, mat.darkWood),
    box16('door_l', 1.5, 3, 1.2, w16 / 2 - 0.3, 21, 2, mat.wood),
    box16('door_r', w16 / 2 + 0.3, 3, 1.2, w16 - 1.5, 21, 2, mat.wood),
    box16('crown', 0, 22, 1, w16, 24, 16, mat.trim),
  ];
};
