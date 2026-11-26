import type { SpritePatternSpec } from './contract';
import {
  failSprite,
  readBool,
  readChoice,
  readInt,
  readNum,
  readRecord,
  type RecordValue,
} from './readLayer';

const optMat = (
  file: string,
  val: unknown,
  materials: ReadonlySet<string>,
  pointer: string,
): string | undefined => {
  if (val === undefined) return undefined;
  if (typeof val !== 'string' || !materials.has(val)) {
    failSprite(file, pointer, 'declared material', val);
  }
  return val as string;
};

const readPatternFirst = (
  file: string,
  p: RecordValue,
  kind: string,
  materials: ReadonlySet<string>,
  pointer: string,
): SpritePatternSpec | null => {
  if (kind === 'solid') {
    readRecord(file, p, pointer, ['kind']);
    return { kind };
  }
  if (kind === 'gradient') {
    readRecord(file, p, pointer, ['kind', 'axis'], ['to_material', 'dither', 'seed']);
    return {
      kind,
      axis: readChoice(file, p.axis, `${pointer}/axis`, ['x', 'y', 'radial']),
      to_material: optMat(file, p.to_material, materials, `${pointer}/to_material`),
      dither: p.dither === undefined ? false : readBool(file, p.dither, `${pointer}/dither`),
      seed: p.seed === undefined ? 0 : readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
    };
  }
  if (kind === 'blotch') {
    readRecord(file, p, pointer, ['kind', 'scale', 'density', 'seed'], ['to_material']);
    return {
      kind,
      scale: readInt(file, p.scale, `${pointer}/scale`, 1, 32),
      density: readNum(file, p.density, `${pointer}/density`, 0, 1),
      seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
      to_material: optMat(file, p.to_material, materials, `${pointer}/to_material`),
    };
  }
  if (kind === 'stripe') {
    readRecord(file, p, pointer, ['kind', 'axis', 'period', 'width'], ['offset', 'to_material']);
    const period = readInt(file, p.period, `${pointer}/period`, 2, 64);
    const width = readInt(file, p.width, `${pointer}/width`, 1, period - 1);
    return {
      kind,
      axis: readChoice(file, p.axis, `${pointer}/axis`, ['x', 'y', 'diag_pos', 'diag_neg']),
      period,
      width,
      offset: p.offset === undefined ? 0 : readInt(file, p.offset, `${pointer}/offset`, -64, 64),
      to_material: optMat(file, p.to_material, materials, `${pointer}/to_material`),
    };
  }
  return null;
};

const readBrickOrPlank = (
  file: string,
  p: RecordValue,
  kind: 'brick' | 'plank',
  materials: ReadonlySet<string>,
  pointer: string,
): SpritePatternSpec => {
  if (kind === 'brick') {
    readRecord(
      file,
      p,
      pointer,
      ['kind', 'width', 'height', 'seed'],
      ['mortar', 'stagger', 'mortar_material'],
    );
    const w = readInt(file, p.width, `${pointer}/width`, 2, 64);
    return {
      kind,
      width: w,
      height: readInt(file, p.height, `${pointer}/height`, 2, 64),
      mortar: p.mortar === undefined ? 1 : readInt(file, p.mortar, `${pointer}/mortar`, 0, 2),
      stagger:
        p.stagger === undefined
          ? Math.floor(w / 2)
          : readInt(file, p.stagger, `${pointer}/stagger`, 0, w),
      seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
      mortar_material: optMat(file, p.mortar_material, materials, `${pointer}/mortar_material`),
    };
  }
  readRecord(file, p, pointer, ['kind', 'height', 'seed'], ['joint', 'mortar_material']);
  return {
    kind,
    height: readInt(file, p.height, `${pointer}/height`, 2, 32),
    joint: p.joint === undefined ? 1 : readInt(file, p.joint, `${pointer}/joint`, 0, 2),
    seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
    mortar_material: optMat(file, p.mortar_material, materials, `${pointer}/mortar_material`),
  };
};

const readPatternSecond = (
  file: string,
  p: RecordValue,
  kind: string,
  materials: ReadonlySet<string>,
  pointer: string,
): SpritePatternSpec => {
  if (kind === 'brick' || kind === 'plank')
    return readBrickOrPlank(file, p, kind, materials, pointer);
  if (kind === 'voronoi') {
    readRecord(
      file,
      p,
      pointer,
      ['kind', 'cells', 'seed'],
      ['jitter', 'edge_width', 'edge_material'],
    );
    return {
      kind,
      cells: readInt(file, p.cells, `${pointer}/cells`, 2, 64),
      jitter: p.jitter === undefined ? 0.7 : readNum(file, p.jitter, `${pointer}/jitter`, 0, 1),
      edge_width:
        p.edge_width === undefined ? 1 : readInt(file, p.edge_width, `${pointer}/edge_width`, 0, 2),
      seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
      edge_material: optMat(file, p.edge_material, materials, `${pointer}/edge_material`),
    };
  }
  if (kind === 'dither') {
    readRecord(file, p, pointer, ['kind', 'mode', 'density'], ['seed', 'to_material']);
    return {
      kind,
      mode: readChoice(file, p.mode, `${pointer}/mode`, ['bayer', 'cluster']),
      density: readNum(file, p.density, `${pointer}/density`, 0, 1),
      seed: p.seed === undefined ? 0 : readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
      to_material: optMat(file, p.to_material, materials, `${pointer}/to_material`),
    };
  }
  readRecord(file, p, pointer, ['kind', 'count', 'seed'], ['crack_material']);
  return {
    kind: 'crack',
    count: readInt(file, p.count, `${pointer}/count`, 1, 24),
    seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
    crack_material: optMat(file, p.crack_material, materials, `${pointer}/crack_material`),
  };
};

export const readPattern = (
  file: string,
  raw: unknown,
  materials: ReadonlySet<string>,
  pointer: string,
): SpritePatternSpec => {
  const p = readRecord(file, raw, pointer);
  const kind = readChoice(file, p.kind, `${pointer}/kind`, [
    'solid',
    'gradient',
    'blotch',
    'stripe',
    'brick',
    'plank',
    'voronoi',
    'dither',
    'crack',
  ]);
  return (
    readPatternFirst(file, p, kind, materials, pointer) ??
    readPatternSecond(file, p, kind, materials, pointer)
  );
};
