import { ItemStudy, SpriteInputError } from './contract';
import { parseSpriteJson } from './json';

type RecordValue = Record<string, unknown>;

interface StudyContext {
  readonly file: string;
  budget: number;
}

const failStudy = (file: string, pointer: string, expected: string, actual: unknown): never => {
  throw new SpriteInputError({
    code: 'sprite.contract',
    file,
    pointer,
    expected,
    actual: String(actual).slice(0, 160),
  });
};

const readRecord = (
  file: string,
  value: unknown,
  pointer: string,
  keys?: readonly string[],
): RecordValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failStudy(file, pointer, 'record', value);
  }
  const record = value as RecordValue;
  if (
    keys &&
    (Object.keys(record).length !== keys.length ||
      keys.some((key) => !Object.hasOwnProperty.call(record, key)))
  ) {
    failStudy(file, pointer, `exact keys ${keys.join(', ')}`, Object.keys(record));
  }
  return record;
};

const readList = (file: string, value: unknown, pointer: string, max: number): unknown[] => {
  if (!Array.isArray(value) || value.length > max) {
    return failStudy(file, pointer, `array <= ${max}`, value);
  }
  return value;
};

const readInteger = (
  file: string,
  value: unknown,
  pointer: string,
  min: number,
  max: number,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    return failStudy(file, pointer, `integer ${min}..${max}`, value);
  }
  return value as number;
};

const readChoice = (
  file: string,
  value: unknown,
  pointer: string,
  choices: readonly unknown[],
): void => {
  if (!choices.includes(value)) failStudy(file, pointer, choices.join(' | '), value);
};

const readId = (file: string, value: unknown, pointer: string): string => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/u.test(value)) {
    return failStudy(file, pointer, 'ASCII id <= 48', value);
  }
  return value;
};

const readPoint = (file: string, value: unknown, pointer: string): number[] => {
  const list = readList(file, value, pointer, 2);
  if (list.length !== 2) failStudy(file, pointer, '[x, y]', value);
  return list.map((entry, index) => readInteger(file, entry, `${pointer}/${index}`, 0, 15));
};

const readColor = (file: string, value: unknown, pointer: string): void => {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/iu.test(value)) {
    failStudy(file, pointer, '#RRGGBB', value);
  }
};

const readRows = (
  file: string,
  value: unknown,
  pointer: string,
  pattern = /^[.a-zA-Z]+$/u,
): string[] => {
  const list = readList(file, value, pointer, 16);
  if (!list.length) return failStudy(file, pointer, 'nonempty rows', value);
  let width = 0;
  list.forEach((row, index) => {
    if (
      typeof row !== 'string' ||
      !pattern.test(row) ||
      row.length > 16 ||
      (index > 0 && row.length !== width)
    ) {
      failStudy(file, `${pointer}/${index}`, 'rectangular ASCII rows, width 1..16', row);
    }
    width = (row as string).length;
  });
  return list as string[];
};

const readCollection = (
  file: string,
  value: unknown,
  pointer: string,
  max: number,
): RecordValue[] => {
  const seen = new Set<string>();
  return readList(file, value, pointer, max).map((entry, index) => {
    const entryPointer = `${pointer}/${index}`;
    const record = readRecord(file, entry, entryPointer);
    const name = readId(file, record.id, `${entryPointer}/id`);
    if (seen.has(name)) failStudy(file, `${entryPointer}/id`, 'unique id', name);
    seen.add(name);
    return record;
  });
};

const readRef = (
  file: string,
  group: readonly RecordValue[],
  value: unknown,
  pointer: string,
): RecordValue =>
  group.find((entry) => entry.id === value) ??
  failStudy(file, pointer, 'declared reference', value);

const checkBounds = (
  context: StudyContext,
  grid: readonly string[],
  at: readonly number[],
  pointer: string,
): void => {
  context.budget += grid.length * grid[0]!.length;
  if (at[0]! + grid[0]!.length > 16 || at[1]! + grid.length > 16) {
    failStudy(context.file, pointer, 'rectangle inside canvas', at);
  }
};

const readBindings = (
  file: string,
  value: unknown,
  grid: readonly string[],
  palette: RecordValue,
  pointer: string,
): void => {
  const chars = [...new Set(grid.join('').replace(/\./g, ''))];
  const map = readRecord(file, value, pointer, chars);
  for (const [key, colorId] of Object.entries(map)) {
    if (typeof colorId !== 'string' || !Object.hasOwnProperty.call(palette, colorId)) {
      failStudy(file, `${pointer}/${key}`, 'palette reference', colorId);
    }
  }
};

const hexLuminance = (hex: string): number =>
  [2126, 7152, 722].reduce(
    (sum, weight, index) => sum + weight * parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16),
    0,
  );

const readMasks = (file: string, raw: unknown): RecordValue[] => {
  const masks = readCollection(file, raw, '/masks', 64);
  masks.forEach((mask, index) => {
    const pointer = `/masks/${index}`;
    readRecord(file, mask, pointer, ['id', 'rows']);
    if (
      !readRows(file, mask.rows, `${pointer}/rows`, /^[.1]+$/u)
        .join('')
        .includes('1')
    ) {
      failStudy(file, pointer, 'occupied mask', 'empty');
    }
  });
  return masks;
};

const readMaterials = (file: string, raw: unknown): RecordValue[] => {
  const materials = readCollection(file, raw, '/materials', 64);
  materials.forEach((material, index) => {
    const pointer = `/materials/${index}`;
    readRecord(file, material, pointer, ['id', 'ramp']);
    const ramp = readRecord(file, material.ramp, `${pointer}/ramp`);
    readChoice(file, ramp.mode, `${pointer}/ramp/mode`, ['explicit', 'generated']);
    if (ramp.mode !== 'explicit') {
      readRecord(file, ramp, `${pointer}/ramp`, ['mode', 'base', 'preset']);
      readColor(file, ramp.base, `${pointer}/ramp/base`);
      readChoice(file, ramp.preset, `${pointer}/ramp/preset`, ['warm-v1', 'neutral-v1']);
      return;
    }
    readRecord(file, ramp, `${pointer}/ramp`, ['mode', 'colors']);
    const colors = readList(file, ramp.colors, `${pointer}/ramp/colors`, 3);
    if (colors.length !== 3) failStudy(file, `${pointer}/ramp/colors`, 'three colors', colors);
    colors.forEach((entry, colorIndex) =>
      readColor(file, entry, `${pointer}/ramp/colors/${colorIndex}`),
    );
    const luminance = colors.map((entry) => hexLuminance(entry as string));
    if (
      luminance[0]! > luminance[1]! ||
      luminance[1]! > luminance[2]! ||
      luminance[0] === luminance[2]
    ) {
      failStudy(
        file,
        `${pointer}/ramp/colors`,
        'shadow <= base <= light with distinct endpoints',
        colors,
      );
    }
  });
  return materials;
};

const readStamps = (file: string, raw: unknown): RecordValue[] => {
  const stamps = readCollection(file, raw, '/stamps', 64);
  stamps.forEach((stamp, index) => {
    const pointer = `/stamps/${index}`;
    readRecord(file, stamp, pointer, ['id', 'rows', 'slots']);
    const used = new Set(readRows(file, stamp.rows, `${pointer}/rows`).join('').replace(/\./g, ''));
    const slots = readList(file, stamp.slots, `${pointer}/slots`, 52);
    if (
      slots.length !== used.size ||
      new Set(slots).size !== slots.length ||
      slots.some((slot) => typeof slot !== 'string' || !used.has(slot))
    ) {
      failStudy(file, `${pointer}/slots`, 'exact used characters', slots);
    }
  });
  return stamps;
};

const readShade = (file: string, raw: unknown, mask: readonly string[], pointer: string): void => {
  const shade = readRecord(file, raw, pointer);
  readChoice(file, shade.form, `${pointer}/form`, ['flat', 'round', 'bevel']);
  const keys =
    shade.form === 'bevel' ? ['form', 'light', 'contrast', 'axis'] : ['form', 'light', 'contrast'];
  readRecord(file, shade, pointer, keys);
  readChoice(file, shade.light, `${pointer}/light`, ['top_left']);
  readInteger(file, shade.contrast, `${pointer}/contrast`, 0, 2);
  if (shade.form !== 'bevel') return;
  const axis = readList(file, shade.axis, `${pointer}/axis`, 2);
  if (axis.length !== 2) failStudy(file, `${pointer}/axis`, 'two points', axis);
  const points = axis.map((entry, index) => readPoint(file, entry, `${pointer}/axis/${index}`));
  if (
    points[0]!.join() === points[1]!.join() ||
    points.some((pt) => pt[0]! >= mask[0]!.length || pt[1]! >= mask.length)
  ) {
    failStudy(file, `${pointer}/axis`, 'distinct points inside mask rectangle', axis);
  }
};

const readPatch = (
  context: StudyContext,
  patch: RecordValue,
  mask: readonly string[],
  palette: RecordValue,
  pointer: string,
): void => {
  const { file } = context;
  readRecord(file, patch, pointer, ['id', 'at', 'rows', 'colors', 'protect']);
  const grid = readRows(file, patch.rows, `${pointer}/rows`);
  const at = readPoint(file, patch.at, `${pointer}/at`);
  checkBounds(context, grid, at, pointer);
  readBindings(file, patch.colors, grid, palette, `${pointer}/colors`);
  readInteger(file, patch.protect, `${pointer}/protect`, 0, 2);
  if (at[0]! + grid[0]!.length > mask[0]!.length || at[1]! + grid.length > mask.length) {
    failStudy(file, pointer, 'patch inside part rectangle', at);
  }
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch !== '.' && mask[y + at[1]!]![x + at[0]!] !== '1') {
        failStudy(file, `${pointer}/rows/${y}/${x}`, 'patch inside mask', ch);
      }
    });
  });
};

const readPartLayer = (
  context: StudyContext,
  layer: RecordValue,
  at: readonly number[],
  masks: readonly RecordValue[],
  materials: readonly RecordValue[],
  palette: RecordValue,
  pointer: string,
): void => {
  const { file } = context;
  readRecord(file, layer, pointer, [
    'id',
    'op',
    'mask',
    'material',
    'at',
    'shade',
    'grain',
    'patches',
  ]);
  const mask = readRef(file, masks, layer.mask, `${pointer}/mask`).rows as string[];
  readRef(file, materials, layer.material, `${pointer}/material`);
  checkBounds(context, mask, at, pointer);
  readShade(file, layer.shade, mask, `${pointer}/shade`);
  const grain = readRecord(file, layer.grain, `${pointer}/grain`, ['mode', 'amount', 'seed']);
  readChoice(file, grain.mode, `${pointer}/grain/mode`, ['clustered-v1']);
  readInteger(file, grain.amount, `${pointer}/grain/amount`, 0, 1);
  readInteger(file, grain.seed, `${pointer}/grain/seed`, 0, 4294967295);
  readCollection(file, layer.patches, `${pointer}/patches`, 16).forEach((patch, index) =>
    readPatch(context, patch, mask, palette, `${pointer}/patches/${index}`),
  );
};

const readDirectLayer = (
  context: StudyContext,
  layer: RecordValue,
  at: readonly number[],
  stamps: readonly RecordValue[],
  palette: RecordValue,
  pointer: string,
): void => {
  const { file } = context;
  const keys =
    layer.op === 'stamp'
      ? ['id', 'op', 'stamp', 'at', 'flip', 'colors']
      : layer.op === 'paint'
        ? ['id', 'op', 'at', 'rows', 'colors']
        : ['id', 'op', 'at', 'rows'];
  readRecord(file, layer, pointer, keys);
  const grid =
    layer.op === 'stamp'
      ? (readRef(file, stamps, layer.stamp, `${pointer}/stamp`).rows as string[])
      : readRows(
          file,
          layer.rows,
          `${pointer}/rows`,
          layer.op === 'erase' ? /^[.1]+$/u : /^[.a-zA-Z]+$/u,
        );
  checkBounds(context, grid, at, pointer);
  if (layer.op !== 'erase') readBindings(file, layer.colors, grid, palette, `${pointer}/colors`);
  if (layer.op === 'stamp')
    readChoice(file, layer.flip, `${pointer}/flip`, ['none', 'x', 'y', 'xy']);
};

const readItem = (
  context: StudyContext,
  item: RecordValue,
  index: number,
  masks: readonly RecordValue[],
  materials: readonly RecordValue[],
  stamps: readonly RecordValue[],
): void => {
  const { file } = context;
  const pointer = `/items/${index}`;
  readRecord(file, item, pointer, ['id', 'profile', 'canvas', 'palette', 'layers']);
  readChoice(file, item.profile, `${pointer}/profile`, ['minecraft-item-v1']);
  const canvas = readList(file, item.canvas, `${pointer}/canvas`, 2);
  if (canvas.length !== 2 || canvas.some((entry) => entry !== 16)) {
    failStudy(file, `${pointer}/canvas`, '[16,16]', canvas);
  }
  const palette = readRecord(file, item.palette, `${pointer}/palette`);
  if (Object.keys(palette).length > 32)
    failStudy(file, `${pointer}/palette`, '<= 32 colors', 'too many');
  Object.entries(palette).forEach(([key, color]) => {
    readId(file, key, `${pointer}/palette/${key}`);
    readColor(file, color, `${pointer}/palette/${key}`);
  });
  readCollection(file, item.layers, `${pointer}/layers`, 64).forEach((layer, layerIndex) => {
    const layerPointer = `${pointer}/layers/${layerIndex}`;
    readChoice(file, layer.op, `${layerPointer}/op`, ['stamp', 'paint', 'erase', 'part']);
    const at = readPoint(file, layer.at, `${layerPointer}/at`);
    if (layer.op === 'part')
      readPartLayer(context, layer, at, masks, materials, palette, layerPointer);
    else readDirectLayer(context, layer, at, stamps, palette, layerPointer);
  });
};

const freeze = (value: unknown): unknown => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

/** Validates and freezes a parsed item study specification. */
export const readItemStudy = (source: string, file = 'study.items.json'): ItemStudy => {
  const root = readRecord(file, parseSpriteJson(source, file), '', [
    'format',
    'version',
    'masks',
    'materials',
    'stamps',
    'items',
  ]);
  readChoice(file, root.format, '/format', ['ashfox-item-study']);
  readChoice(file, root.version, '/version', [1]);
  const masks = readMasks(file, root.masks);
  const materials = readMaterials(file, root.materials);
  const stamps = readStamps(file, root.stamps);
  const items = readCollection(file, root.items, '/items', 32);
  if (!items.length) failStudy(file, '/items', 'at least one item', 'empty');
  const context: StudyContext = { file, budget: 0 };
  items.forEach((item, index) => readItem(context, item, index, masks, materials, stamps));
  if (context.budget > 524288) failStudy(file, '', 'total cells <= 524288', context.budget);
  // All discriminated variants and references have been checked above.
  return freeze(root) as ItemStudy;
};
