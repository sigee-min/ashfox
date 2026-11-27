import { RAMP_PRESETS, type RampPreset } from '../../textures/oklch';
import { docsHint, formatDidYouMean } from '../source/suggest';
import {
  LIGHTS,
  SPRITE_SIZES,
  SpriteInputError,
  type LightDirection,
  type MirrorMode,
  type Point,
  type ShapeSpec,
  type SpriteGrain,
  type SpriteMaterial,
  type SpriteNineSlice,
  type SpriteProfile,
  type SpriteShade,
} from './contract';

export type RecordValue = Record<string, unknown>;

export const failSprite = (
  file: string,
  pointer: string,
  expected: string,
  actual: unknown,
  candidates?: readonly string[],
): never => {
  const actualText = String(actual).slice(0, 160);
  const suggestion =
    typeof actual === 'string' && candidates ? formatDidYouMean(actual, candidates) : '';
  throw new SpriteInputError({
    code: 'sprite.contract',
    file,
    pointer,
    expected,
    actual: `${actualText}${suggestion}`,
    hint: docsHint('sprite'),
  });
};

export const readRecord = (
  file: string,
  value: unknown,
  pointer: string,
  required?: readonly string[],
  optional: readonly string[] = [],
): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failSprite(file, pointer, 'record', value);
  }
  const record = value as RecordValue;
  if (!required) return record;
  const allowedList = [...required, ...optional];
  const allowed = new Set(allowedList);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) failSprite(file, `${pointer}/${key}`, 'allowed key', key, allowedList);
  }
  for (const key of required) {
    if (!Object.hasOwnProperty.call(record, key)) {
      failSprite(file, pointer, `required key ${key}`, Object.keys(record));
    }
  }
  return record;
};

export const readList = (file: string, value: unknown, pointer: string, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) {
    return failSprite(file, pointer, `array <= ${max}`, value);
  }
  return value;
};

export const readInt = (
  file: string,
  value: unknown,
  pointer: string,
  min: number,
  max: number,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    return failSprite(file, pointer, `integer ${min}..${max}`, value);
  }
  return value as number;
};

export const readNum = (
  file: string,
  value: unknown,
  pointer: string,
  min: number,
  max: number,
): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    return failSprite(file, pointer, `number ${min}..${max}`, value);
  }
  return value;
};

export const readBool = (file: string, value: unknown, pointer: string): boolean => {
  if (typeof value !== 'boolean') return failSprite(file, pointer, 'boolean', value);
  return value;
};

export const readChoice = <T extends string>(
  file: string,
  value: unknown,
  pointer: string,
  choices: readonly T[],
): T => {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    return failSprite(file, pointer, choices.join(' | '), value, choices);
  }
  return value as T;
};

export const readId = (file: string, value: unknown, pointer: string): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/u.test(value)) {
    return failSprite(file, pointer, 'ASCII id <= 48', value);
  }
  return value;
};

export const readPoint = (
  file: string,
  value: unknown,
  pointer: string,
  min = 0,
  maxX = 63,
  maxY = maxX,
): Point => {
  const list = readList(file, value, pointer, 2);
  if (list.length !== 2) failSprite(file, pointer, '[x, y]', value);
  return [
    readInt(file, list[0], `${pointer}/0`, min, maxX),
    readInt(file, list[1], `${pointer}/1`, min, maxY),
  ];
};

export const readMirror = (file: string, raw: unknown, pointer: string): MirrorMode =>
  raw === undefined ? 'none' : readChoice(file, raw, pointer, ['none', 'x', 'y', 'xy']);

const readPolygonOrLine = (
  file: string,
  r: RecordValue,
  kind: 'polygon' | 'line',
  width: number,
  height: number,
  pointer: string,
): ShapeSpec => {
  if (kind === 'line') {
    readRecord(file, r, pointer, ['kind', 'x1', 'y1', 'x2', 'y2', 'thickness']);
    return {
      kind,
      x1: readInt(file, r.x1, `${pointer}/x1`, 0, width - 1),
      y1: readInt(file, r.y1, `${pointer}/y1`, 0, height - 1),
      x2: readInt(file, r.x2, `${pointer}/x2`, 0, width - 1),
      y2: readInt(file, r.y2, `${pointer}/y2`, 0, height - 1),
      thickness: readInt(file, r.thickness, `${pointer}/thickness`, 1, 8),
    };
  }
  const maxDim = Math.max(width, height);
  readRecord(file, r, pointer, ['kind', 'points']);
  const pts = readList(file, r.points, `${pointer}/points`, 16);
  if (pts.length < 3) failSprite(file, `${pointer}/points`, '>= 3 points', pts.length);
  return {
    kind,
    points: pts.map((pt, i) => readPoint(file, pt, `${pointer}/points/${i}`, 0, maxDim - 1)),
  };
};

export const readShape = (
  file: string,
  raw: unknown,
  width: number,
  height: number,
  pointer: string,
): ShapeSpec => {
  const r = readRecord(file, raw, pointer);
  const kind = readChoice(file, r.kind, `${pointer}/kind`, [
    'rect',
    'ellipse',
    'capsule',
    'polygon',
    'line',
  ]);
  const maxDim = Math.max(width, height);
  if (kind === 'rect') {
    readRecord(file, r, pointer, ['kind', 'x', 'y', 'width', 'height']);
    return {
      kind,
      x: readInt(file, r.x, `${pointer}/x`, 0, width - 1),
      y: readInt(file, r.y, `${pointer}/y`, 0, height - 1),
      width: readInt(file, r.width, `${pointer}/width`, 1, width),
      height: readInt(file, r.height, `${pointer}/height`, 1, height),
    };
  }
  if (kind === 'ellipse') {
    readRecord(file, r, pointer, ['kind', 'cx', 'cy', 'rx', 'ry']);
    return {
      kind,
      cx: readNum(file, r.cx, `${pointer}/cx`, -maxDim, maxDim * 2),
      cy: readNum(file, r.cy, `${pointer}/cy`, -maxDim, maxDim * 2),
      rx: readNum(file, r.rx, `${pointer}/rx`, 0.5, maxDim),
      ry: readNum(file, r.ry, `${pointer}/ry`, 0.5, maxDim),
    };
  }
  if (kind === 'capsule') {
    readRecord(file, r, pointer, ['kind', 'x1', 'y1', 'x2', 'y2', 'radius']);
    return {
      kind,
      x1: readNum(file, r.x1, `${pointer}/x1`, 0, width - 1),
      y1: readNum(file, r.y1, `${pointer}/y1`, 0, height - 1),
      x2: readNum(file, r.x2, `${pointer}/x2`, 0, width - 1),
      y2: readNum(file, r.y2, `${pointer}/y2`, 0, height - 1),
      radius: readNum(file, r.radius, `${pointer}/radius`, 0.5, maxDim),
    };
  }
  return readPolygonOrLine(file, r, kind, width, height, pointer);
};

export const readShade = (
  file: string,
  raw: unknown,
  maxW: number,
  maxH: number,
  pointer: string,
): SpriteShade => {
  const s = readRecord(file, raw, pointer);
  const form = readChoice(file, s.form, `${pointer}/form`, [
    'flat',
    'round',
    'bevel',
    'cylinder',
    'facet',
  ]);
  const axisReq = form === 'bevel' || form === 'cylinder';
  readRecord(
    file,
    s,
    pointer,
    axisReq ? ['form', 'light', 'contrast', 'axis'] : ['form', 'light', 'contrast'],
    ['specular'],
  );
  const light = readChoice(
    file,
    s.light,
    `${pointer}/light`,
    Object.keys(LIGHTS) as LightDirection[],
  );
  const contrast = readInt(file, s.contrast, `${pointer}/contrast`, 0, 3);
  const specular =
    s.specular === undefined ? 0 : readInt(file, s.specular, `${pointer}/specular`, 0, 2);
  if (!axisReq) return { form, light, contrast, specular };
  const axis = readList(file, s.axis, `${pointer}/axis`, 2);
  if (axis.length !== 2) failSprite(file, `${pointer}/axis`, 'two points', axis);
  const points = [
    readPoint(file, axis[0], `${pointer}/axis/0`, 0, maxW - 1, maxH - 1),
    readPoint(file, axis[1], `${pointer}/axis/1`, 0, maxW - 1, maxH - 1),
  ] as const;
  if (points[0][0] === points[1][0] && points[0][1] === points[1][1]) {
    failSprite(file, `${pointer}/axis`, 'distinct points', axis);
  }
  return { form, light, contrast, specular, axis: points };
};

export const readGrain = (file: string, raw: unknown, pointer: string): SpriteGrain => {
  if (raw === undefined) return { mode: 'none', amount: 0, seed: 0 };
  const g = readRecord(file, raw, pointer);
  const mode = readChoice(file, g.mode, `${pointer}/mode`, [
    'none',
    'clustered',
    'soft',
    'directional',
  ]);
  readRecord(
    file,
    g,
    pointer,
    mode === 'directional' ? ['mode', 'axis', 'amount', 'seed'] : ['mode', 'amount', 'seed'],
  );
  const axis =
    mode === 'directional'
      ? readChoice(file, g.axis, `${pointer}/axis`, ['horizontal', 'vertical', 'diagonal'])
      : undefined;
  return {
    mode,
    ...(axis ? { axis } : {}),
    amount: readInt(file, g.amount, `${pointer}/amount`, 0, 2),
    seed: readInt(file, g.seed, `${pointer}/seed`, 0, 0xffffffff),
  };
};

export const readColor = (file: string, value: unknown, pointer: string): string => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value)) {
    failSprite(file, pointer, '#RRGGBB', value);
  }
  return (value as string).toLowerCase();
};

export const readRgbaColor = (file: string, value: unknown, pointer: string): string => {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/iu.test(value)) {
    failSprite(file, pointer, '#RRGGBB or #RRGGBBAA', value);
  }
  return (value as string).toLowerCase();
};

export const readAlphaOpt = (file: string, value: unknown, pointer: string): number | undefined =>
  value === undefined ? undefined : readNum(file, value, pointer, 0, 1);

export const readFeatherOpt = (
  file: string,
  value: unknown,
  pointer: string,
): number | undefined => (value === undefined ? undefined : readNum(file, value, pointer, 0, 16));

const hexLuminance = (hex: string): number =>
  [2126, 7152, 722].reduce(
    (sum, weight, index) => sum + weight * parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16),
    0,
  );

const readMaterialRamp = (file: string, raw: unknown, pointer: string): SpriteMaterial['ramp'] => {
  const ramp = readRecord(file, raw, pointer);
  const mode = readChoice(file, ramp.mode, `${pointer}/mode`, ['explicit', 'auto']);
  if (mode === 'auto') {
    readRecord(file, ramp, pointer, ['mode', 'base', 'preset']);
    return {
      mode: 'auto',
      base: readColor(file, ramp.base, `${pointer}/base`),
      preset: readChoice(file, ramp.preset, `${pointer}/preset`, RAMP_PRESETS) as RampPreset,
    };
  }
  readRecord(file, ramp, pointer, ['mode', 'colors']);
  const colors = readList(file, ramp.colors, `${pointer}/colors`, 5).map((entry, idx) =>
    readColor(file, entry, `${pointer}/colors/${idx}`),
  );
  if (colors.length !== 3 && colors.length !== 5) {
    failSprite(file, `${pointer}/colors`, '3 or 5 colors', colors.length);
  }
  const lums = colors.map(hexLuminance);
  for (let i = 1; i < lums.length; i += 1) {
    if (lums[i]! < lums[i - 1]!) {
      failSprite(file, `${pointer}/colors`, 'nondecreasing luminance', colors);
    }
  }
  if (lums[0] === lums[lums.length - 1]) {
    failSprite(file, `${pointer}/colors`, 'distinct shadow and highlight luminance', colors);
  }
  return {
    mode: 'explicit',
    colors:
      colors.length === 3
        ? ([colors[0]!, colors[1]!, colors[2]!] as const)
        : ([colors[0]!, colors[1]!, colors[2]!, colors[3]!, colors[4]!] as const),
  };
};

export const readMaterials = (file: string, raw: unknown): readonly SpriteMaterial[] => {
  const seen = new Set<string>();
  return readList(file, raw, '/materials', 64).map((entry, index) => {
    const pointer = `/materials/${index}`;
    const r = readRecord(file, entry, pointer, ['id', 'ramp']);
    const id = readId(file, r.id, `${pointer}/id`);
    if (seen.has(id)) failSprite(file, `${pointer}/id`, 'unique id', id);
    seen.add(id);
    return { id, ramp: readMaterialRamp(file, r.ramp, `${pointer}/ramp`) };
  });
};

export const freezeSpriteDoc = <T>(value: T): T => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeSpriteDoc);
    Object.freeze(value);
  }
  return value;
};

export const readCanvasDims = (file: string, raw: unknown): readonly [number, number] => {
  const list = readList(file, raw, '/item/canvas', 2);
  if (
    list.length !== 2 ||
    !SPRITE_SIZES.has(list[0] as number) ||
    !SPRITE_SIZES.has(list[1] as number) ||
    list[0] !== list[1]
  ) {
    failSprite(file, '/item/canvas', 'square [16,16] | [32,32] | [64,64]', raw);
  }
  return [list[0] as number, list[1] as number];
};

export const readNineSlice = (
  file: string,
  raw: unknown,
  profile: SpriteProfile,
  width: number,
  height: number,
): SpriteNineSlice | undefined => {
  if (raw === undefined) return undefined;
  if (profile !== 'ui_9slice') {
    failSprite(file, '/item/slice', 'slice only allowed when profile = ui_9slice', profile);
  }
  const [lRaw, rRaw, tRaw, bRaw] = Array.isArray(raw)
    ? raw.length === 4
      ? raw
      : failSprite(file, '/item/slice', '(left, right, top, bottom)', raw)
    : (() => {
        const rec = readRecord(file, raw, '/item/slice', ['left', 'right', 'top', 'bottom']);
        return [rec.left, rec.right, rec.top, rec.bottom];
      })();
  const left = readInt(file, lRaw, '/item/slice/left', 0, width - 1);
  const right = readInt(file, rRaw, '/item/slice/right', 0, width - 1);
  const top = readInt(file, tRaw, '/item/slice/top', 0, height - 1);
  const bottom = readInt(file, bRaw, '/item/slice/bottom', 0, height - 1);
  if (left + right >= width || top + bottom >= height) {
    failSprite(file, '/item/slice', 'non-empty center stretch region', [left, right, top, bottom]);
  }
  return { left, right, top, bottom };
};

export const readPaletteMap = (
  file: string,
  raw: unknown,
): { readonly map: Map<string, string>; readonly out: Record<string, string> } => {
  const rec = readRecord(file, raw, '/item/palette');
  if (Object.keys(rec).length > 32) failSprite(file, '/item/palette', '<= 32 colors', 'too many');
  const map = new Map<string, string>();
  const out: Record<string, string> = {};
  for (const [key, color] of Object.entries(rec)) {
    readId(file, key, `/item/palette/${key}`);
    const normalized = readRgbaColor(file, color, `/item/palette/${key}`);
    map.set(key, normalized);
    out[key] = normalized;
  }
  return { map, out };
};
