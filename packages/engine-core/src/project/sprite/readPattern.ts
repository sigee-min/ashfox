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
    readRecord(file, p, pointer, ['kind', 'axis'], ['toMaterial', 'dither', 'seed']);
    return {
      kind,
      axis: readChoice(file, p.axis, `${pointer}/axis`, ['x', 'y', 'radial']),
      toMaterial: optMat(file, p.toMaterial, materials, `${pointer}/toMaterial`),
      dither: p.dither === undefined ? false : readBool(file, p.dither, `${pointer}/dither`),
      seed: p.seed === undefined ? 0 : readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
    };
  }
  if (kind === 'blotch') {
    readRecord(file, p, pointer, ['kind', 'scale', 'density', 'seed'], ['toMaterial']);
    return {
      kind,
      scale: readInt(file, p.scale, `${pointer}/scale`, 1, 32),
      density: readNum(file, p.density, `${pointer}/density`, 0, 1),
      seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
      toMaterial: optMat(file, p.toMaterial, materials, `${pointer}/toMaterial`),
    };
  }
  if (kind === 'stripe') {
    readRecord(file, p, pointer, ['kind', 'axis', 'period', 'width'], ['offset', 'toMaterial']);
    const period = readInt(file, p.period, `${pointer}/period`, 2, 64);
    const width = readInt(file, p.width, `${pointer}/width`, 1, period - 1);
    return {
      kind,
      axis: readChoice(file, p.axis, `${pointer}/axis`, ['x', 'y', 'diag_pos', 'diag_neg']),
      period,
      width,
      offset: p.offset === undefined ? 0 : readInt(file, p.offset, `${pointer}/offset`, -64, 64),
      toMaterial: optMat(file, p.toMaterial, materials, `${pointer}/toMaterial`),
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
      ['mortar', 'stagger', 'mortarMaterial'],
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
      mortarMaterial: optMat(file, p.mortarMaterial, materials, `${pointer}/mortarMaterial`),
    };
  }
  readRecord(file, p, pointer, ['kind', 'height', 'seed'], ['joint', 'mortarMaterial']);
  return {
    kind,
    height: readInt(file, p.height, `${pointer}/height`, 2, 32),
    joint: p.joint === undefined ? 1 : readInt(file, p.joint, `${pointer}/joint`, 0, 2),
    seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
    mortarMaterial: optMat(file, p.mortarMaterial, materials, `${pointer}/mortarMaterial`),
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
      ['jitter', 'edgeWidth', 'edgeMaterial'],
    );
    return {
      kind,
      cells: readInt(file, p.cells, `${pointer}/cells`, 2, 64),
      jitter: p.jitter === undefined ? 0.7 : readNum(file, p.jitter, `${pointer}/jitter`, 0, 1),
      edgeWidth:
        p.edgeWidth === undefined ? 1 : readInt(file, p.edgeWidth, `${pointer}/edgeWidth`, 0, 2),
      seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
      edgeMaterial: optMat(file, p.edgeMaterial, materials, `${pointer}/edgeMaterial`),
    };
  }
  if (kind === 'dither') {
    readRecord(file, p, pointer, ['kind', 'mode', 'density'], ['seed', 'toMaterial']);
    return {
      kind,
      mode: readChoice(file, p.mode, `${pointer}/mode`, ['bayer', 'cluster']),
      density: readNum(file, p.density, `${pointer}/density`, 0, 1),
      seed: p.seed === undefined ? 0 : readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
      toMaterial: optMat(file, p.toMaterial, materials, `${pointer}/toMaterial`),
    };
  }
  readRecord(file, p, pointer, ['kind', 'count', 'seed'], ['crackMaterial']);
  return {
    kind: 'crack',
    count: readInt(file, p.count, `${pointer}/count`, 1, 24),
    seed: readInt(file, p.seed, `${pointer}/seed`, 0, 0xffffffff),
    crackMaterial: optMat(file, p.crackMaterial, materials, `${pointer}/crackMaterial`),
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
