import {
  SPRITE_PROFILES,
  type SpriteDocument,
  type SpriteLayer,
  type SpriteMask,
  type SpritePatch,
  type SpriteStamp,
} from './contract';
import {
  failSprite,
  freezeSpriteDoc,
  readAlphaOpt,
  readBool,
  readCanvasDims,
  readChoice,
  readFeatherOpt,
  readGrain,
  readId,
  readInt,
  readList,
  readMaterials,
  readMirror,
  readNineSlice,
  readPaletteMap,
  readPoint,
  readRecord,
  readShade,
  readShape,
  type RecordValue,
} from './readLayer';
import { readPattern } from './readPattern';

interface Context {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly masks: ReadonlyMap<string, SpriteMask>;
  readonly materials: ReadonlySet<string>;
  readonly stamps: ReadonlyMap<string, SpriteStamp>;
  readonly palette: ReadonlyMap<string, string>;
}

const readRows = (
  file: string,
  value: unknown,
  pointer: string,
  pattern = /^[.a-zA-Z]+$/u,
): string[] => {
  const list = readList(file, value, pointer, 64);
  if (!list.length) failSprite(file, pointer, 'nonempty rows', value);
  let width = 0;
  list.forEach((row, index) => {
    if (
      typeof row !== 'string' ||
      !pattern.test(row) ||
      row.length === 0 ||
      row.length > 64 ||
      (index > 0 && row.length !== width)
    ) {
      failSprite(file, `${pointer}/${index}`, 'rectangular ASCII rows, width 1..64', row);
    }
    width = (row as string).length;
  });
  return list as string[];
};

const readBindings = (
  file: string,
  value: unknown,
  grid: readonly string[],
  palette: ReadonlyMap<string, string>,
  pointer: string,
): Readonly<Record<string, string>> => {
  const chars = [...new Set(grid.join('').replace(/\./g, ''))];
  const map = readRecord(file, value, pointer, chars);
  const result: Record<string, string> = {};
  for (const [key, colorId] of Object.entries(map)) {
    if (typeof colorId !== 'string' || !palette.has(colorId)) {
      failSprite(file, `${pointer}/${key}`, 'palette reference', colorId);
    }
    result[key] = colorId as string;
  }
  return Object.freeze(result);
};

const checkBounds = (
  file: string,
  grid: readonly string[],
  at: readonly [number, number],
  width: number,
  height: number,
  pointer: string,
): void => {
  if (at[0] + grid[0]!.length > width || at[1] + grid.length > height) {
    failSprite(file, pointer, 'rectangle inside canvas', at);
  }
};

const readMasks = (file: string, raw: unknown): ReadonlyMap<string, SpriteMask> => {
  const seen = new Map<string, SpriteMask>();
  readList(file, raw, '/masks', 64).forEach((entry, index) => {
    const pointer = `/masks/${index}`;
    const r = readRecord(file, entry, pointer);
    const id = readId(file, r.id, `${pointer}/id`);
    if (seen.has(id)) failSprite(file, `${pointer}/id`, 'unique id', id);
    if ('rows' in r) {
      readRecord(file, r, pointer, ['id', 'rows']);
      const rows = readRows(file, r.rows, `${pointer}/rows`, /^[.1]+$/u);
      if (!rows.join('').includes('1')) failSprite(file, pointer, 'occupied mask', 'empty');
      seen.set(id, { id, kind: 'rows', rows });
      return;
    }
    readRecord(file, r, pointer, ['id', 'width', 'height', 'shape'], ['mirror']);
    const width = readInt(file, r.width, `${pointer}/width`, 1, 64);
    const height = readInt(file, r.height, `${pointer}/height`, 1, 64);
    seen.set(id, {
      id,
      kind: 'shape',
      width,
      height,
      shape: readShape(file, r.shape, width, height, `${pointer}/shape`),
      mirror: readMirror(file, r.mirror, `${pointer}/mirror`),
    });
  });
  return seen;
};

const readStamps = (file: string, raw: unknown): ReadonlyMap<string, SpriteStamp> => {
  const seen = new Map<string, SpriteStamp>();
  readList(file, raw, '/stamps', 64).forEach((entry, index) => {
    const pointer = `/stamps/${index}`;
    const r = readRecord(file, entry, pointer, ['id', 'rows', 'slots']);
    const id = readId(file, r.id, `${pointer}/id`);
    if (seen.has(id)) failSprite(file, `${pointer}/id`, 'unique id', id);
    const rows = readRows(file, r.rows, `${pointer}/rows`);
    const used = new Set(rows.join('').replace(/\./g, ''));
    const slots = readList(file, r.slots, `${pointer}/slots`, 52);
    if (
      slots.length !== used.size ||
      new Set(slots).size !== slots.length ||
      slots.some((slot) => typeof slot !== 'string' || !used.has(slot))
    ) {
      failSprite(file, `${pointer}/slots`, 'exact used characters', slots);
    }
    seen.set(id, { id, rows, slots: slots as string[] });
  });
  return seen;
};

const readPatch = (ctx: Context, raw: unknown, mask: SpriteMask, pointer: string): SpritePatch => {
  const patch = readRecord(ctx.file, raw, pointer, ['id', 'at', 'rows', 'colors'], ['protect']);
  const id = readId(ctx.file, patch.id, `${pointer}/id`);
  const grid = readRows(ctx.file, patch.rows, `${pointer}/rows`);
  const at = readPoint(ctx.file, patch.at, `${pointer}/at`, 0, 63);
  const mw = mask.kind === 'rows' ? mask.rows[0]!.length : mask.width;
  const mh = mask.kind === 'rows' ? mask.rows.length : mask.height;
  if (at[0] + grid[0]!.length > mw || at[1] + grid.length > mh) {
    failSprite(ctx.file, pointer, 'patch inside part rectangle', at);
  }
  if (mask.kind === 'rows') {
    grid.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== '.' && mask.rows[y + at[1]]![x + at[0]] !== '1') {
          failSprite(ctx.file, `${pointer}/rows/${y}/${x}`, 'patch inside mask', ch);
        }
      });
    });
  }
  return {
    id,
    at,
    rows: grid,
    colors: readBindings(ctx.file, patch.colors, grid, ctx.palette, `${pointer}/colors`),
    protect:
      patch.protect === undefined
        ? 1
        : readInt(ctx.file, patch.protect, `${pointer}/protect`, 0, 2),
  };
};

const readMatRef = (ctx: Context, val: unknown, pointer: string): string => {
  if (typeof val !== 'string' || !ctx.materials.has(val)) {
    failSprite(ctx.file, pointer, 'declared material', val);
  }
  return val as string;
};

const readPartLayer = (
  ctx: Context,
  layer: RecordValue,
  id: string,
  pointer: string,
): SpriteLayer => {
  readRecord(
    ctx.file,
    layer,
    pointer,
    ['id', 'op', 'mask', 'material', 'at', 'shade'],
    ['grain', 'mirror', 'pattern', 'patches', 'alpha', 'feather'],
  );
  const maskName = typeof layer.mask === 'string' ? layer.mask : '';
  const mask =
    ctx.masks.get(maskName) ?? failSprite(ctx.file, `${pointer}/mask`, 'declared mask', layer.mask);
  const mw = mask.kind === 'rows' ? mask.rows[0]!.length : mask.width;
  const mh = mask.kind === 'rows' ? mask.rows.length : mask.height;
  const at = readPoint(ctx.file, layer.at, `${pointer}/at`, 0, 63);
  if (at[0] + mw > ctx.width || at[1] + mh > ctx.height) {
    failSprite(ctx.file, pointer, 'part inside canvas', at);
  }
  const patchSeen = new Set<string>();
  const patches = readList(ctx.file, layer.patches ?? [], `${pointer}/patches`, 16).map(
    (p, idx) => {
      const parsed = readPatch(ctx, p, mask, `${pointer}/patches/${idx}`);
      if (patchSeen.has(parsed.id))
        failSprite(ctx.file, `${pointer}/patches/${idx}/id`, 'unique id', parsed.id);
      patchSeen.add(parsed.id);
      return parsed;
    },
  );
  const alpha = readAlphaOpt(ctx.file, layer.alpha, `${pointer}/alpha`);
  const feather = readFeatherOpt(ctx.file, layer.feather, `${pointer}/feather`);
  return {
    id,
    op: 'part',
    mask: maskName,
    material: readMatRef(ctx, layer.material, `${pointer}/material`),
    at,
    shade: readShade(ctx.file, layer.shade, mw, mh, `${pointer}/shade`),
    grain: readGrain(ctx.file, layer.grain, `${pointer}/grain`),
    mirror: readMirror(ctx.file, layer.mirror, `${pointer}/mirror`),
    ...(layer.pattern !== undefined
      ? { pattern: readPattern(ctx.file, layer.pattern, ctx.materials, `${pointer}/pattern`) }
      : {}),
    patches,
    ...(alpha !== undefined ? { alpha } : {}),
    ...(feather !== undefined ? { feather } : {}),
  };
};

const readShapeOrFillLayer = (
  ctx: Context,
  layer: RecordValue,
  id: string,
  op: string,
  pointer: string,
): SpriteLayer | null => {
  if (op === 'fill') {
    readRecord(ctx.file, layer, pointer, ['id', 'op', 'material', 'pattern'], ['grain', 'alpha']);
    const alpha = readAlphaOpt(ctx.file, layer.alpha, `${pointer}/alpha`);
    return {
      id,
      op: 'fill',
      material: readMatRef(ctx, layer.material, `${pointer}/material`),
      pattern: readPattern(ctx.file, layer.pattern, ctx.materials, `${pointer}/pattern`),
      grain: readGrain(ctx.file, layer.grain, `${pointer}/grain`),
      ...(alpha !== undefined ? { alpha } : {}),
    };
  }
  if (op === 'shape') {
    readRecord(
      ctx.file,
      layer,
      pointer,
      ['id', 'op', 'shape', 'material', 'shade'],
      ['grain', 'mirror', 'pattern', 'clip', 'alpha', 'feather'],
    );
    const alpha = readAlphaOpt(ctx.file, layer.alpha, `${pointer}/alpha`);
    const feather = readFeatherOpt(ctx.file, layer.feather, `${pointer}/feather`);
    return {
      id,
      op: 'shape',
      shape: readShape(ctx.file, layer.shape, ctx.width, ctx.height, `${pointer}/shape`),
      material: readMatRef(ctx, layer.material, `${pointer}/material`),
      shade: readShade(ctx.file, layer.shade, ctx.width, ctx.height, `${pointer}/shade`),
      grain: readGrain(ctx.file, layer.grain, `${pointer}/grain`),
      mirror: readMirror(ctx.file, layer.mirror, `${pointer}/mirror`),
      ...(layer.pattern !== undefined
        ? { pattern: readPattern(ctx.file, layer.pattern, ctx.materials, `${pointer}/pattern`) }
        : {}),
      clip:
        layer.clip === undefined
          ? 'canvas'
          : readChoice(ctx.file, layer.clip, `${pointer}/clip`, ['canvas', 'occupied']),
      ...(alpha !== undefined ? { alpha } : {}),
      ...(feather !== undefined ? { feather } : {}),
    };
  }
  return null;
};

const readOutlineLayer = (
  ctx: Context,
  layer: RecordValue,
  id: string,
  pointer: string,
): SpriteLayer => {
  readRecord(ctx.file, layer, pointer, ['id', 'op', 'mode'], ['color', 'strength', 'inner_rim']);
  const mode = readChoice(ctx.file, layer.mode, `${pointer}/mode`, ['sel_out', 'dark', 'colored']);
  let color: string | undefined;
  if (mode === 'colored') {
    const name = typeof layer.color === 'string' ? layer.color : '';
    if (!ctx.palette.has(name))
      failSprite(ctx.file, `${pointer}/color`, 'palette color', layer.color);
    color = name;
  } else if (layer.color !== undefined) {
    failSprite(ctx.file, `${pointer}/color`, 'omit color unless mode=colored', layer.color);
  }
  return {
    id,
    op: 'outline',
    mode,
    ...(color ? { color } : {}),
    strength:
      layer.strength === undefined
        ? 2
        : readInt(ctx.file, layer.strength, `${pointer}/strength`, 1, 3),
    inner_rim:
      layer.inner_rim === undefined
        ? false
        : readBool(ctx.file, layer.inner_rim, `${pointer}/inner_rim`),
  };
};

const readStampLayer = (
  ctx: Context,
  layer: RecordValue,
  id: string,
  pointer: string,
): SpriteLayer => {
  readRecord(ctx.file, layer, pointer, ['id', 'op', 'stamp', 'at', 'flip', 'colors'], ['alpha']);
  const at = readPoint(ctx.file, layer.at, `${pointer}/at`, 0, 63);
  const alpha = readAlphaOpt(ctx.file, layer.alpha, `${pointer}/alpha`);
  const stampName = typeof layer.stamp === 'string' ? layer.stamp : '';
  const stamp =
    ctx.stamps.get(stampName) ??
    failSprite(ctx.file, `${pointer}/stamp`, 'declared stamp', layer.stamp);
  checkBounds(ctx.file, stamp.rows, at, ctx.width, ctx.height, pointer);
  return {
    id,
    op: 'stamp',
    stamp: stampName,
    at,
    flip: readMirror(ctx.file, layer.flip, `${pointer}/flip`),
    colors: readBindings(ctx.file, layer.colors, stamp.rows, ctx.palette, `${pointer}/colors`),
    ...(alpha !== undefined ? { alpha } : {}),
  };
};

const readPaintStampOrErase = (
  ctx: Context,
  layer: RecordValue,
  id: string,
  op: 'paint' | 'stamp' | 'erase',
  pointer: string,
): SpriteLayer => {
  if (op === 'stamp') return readStampLayer(ctx, layer, id, pointer);
  if (op === 'erase' && 'shape' in layer) {
    readRecord(ctx.file, layer, pointer, ['id', 'op', 'shape']);
    return {
      id,
      op: 'erase',
      shape: readShape(ctx.file, layer.shape, ctx.width, ctx.height, `${pointer}/shape`),
    };
  }
  const req = op === 'paint' ? ['id', 'op', 'at', 'rows', 'colors'] : ['id', 'op', 'at', 'rows'];
  readRecord(ctx.file, layer, pointer, req, op === 'erase' ? [] : ['alpha']);
  const at = readPoint(ctx.file, layer.at, `${pointer}/at`, 0, 63);
  const rowPat = op === 'erase' ? /^[.1]+$/u : /^[.a-zA-Z]+$/u;
  const rows = readRows(ctx.file, layer.rows, `${pointer}/rows`, rowPat);
  checkBounds(ctx.file, rows, at, ctx.width, ctx.height, pointer);
  if (op === 'erase') return { id, op: 'erase', at, rows };
  const alpha = readAlphaOpt(ctx.file, layer.alpha, `${pointer}/alpha`);
  return {
    id,
    op: 'paint',
    at,
    rows,
    colors: readBindings(ctx.file, layer.colors, rows, ctx.palette, `${pointer}/colors`),
    ...(alpha !== undefined ? { alpha } : {}),
  };
};

const readDirectLayer = (
  ctx: Context,
  layer: RecordValue,
  id: string,
  op: string,
  pointer: string,
): SpriteLayer => {
  if (op === 'pattern') {
    readRecord(ctx.file, layer, pointer, ['id', 'op', 'material', 'pattern'], ['clip', 'alpha']);
    const alpha = readAlphaOpt(ctx.file, layer.alpha, `${pointer}/alpha`);
    return {
      id,
      op: 'pattern',
      material: readMatRef(ctx, layer.material, `${pointer}/material`),
      pattern: readPattern(ctx.file, layer.pattern, ctx.materials, `${pointer}/pattern`),
      clip:
        layer.clip === undefined
          ? 'occupied'
          : readChoice(ctx.file, layer.clip, `${pointer}/clip`, ['canvas', 'occupied']),
      ...(alpha !== undefined ? { alpha } : {}),
    };
  }
  if (op === 'outline') return readOutlineLayer(ctx, layer, id, pointer);
  return readPaintStampOrErase(ctx, layer, id, op as 'paint' | 'stamp' | 'erase', pointer);
};

const readLayer = (ctx: Context, raw: unknown, seen: Set<string>, pointer: string): SpriteLayer => {
  const layer = readRecord(ctx.file, raw, pointer);
  const id = readId(ctx.file, layer.id, `${pointer}/id`);
  if (seen.has(id)) failSprite(ctx.file, `${pointer}/id`, 'unique layer id', id);
  seen.add(id);
  const op = readChoice(ctx.file, layer.op, `${pointer}/op`, [
    'fill',
    'shape',
    'part',
    'paint',
    'erase',
    'stamp',
    'outline',
    'pattern',
  ]);
  if (op === 'part') return readPartLayer(ctx, layer, id, pointer);
  return (
    readShapeOrFillLayer(ctx, layer, id, op, pointer) ??
    readDirectLayer(ctx, layer, id, op, pointer)
  );
};

/** Validates and freezes a Sprite v2 document directly in memory. */
export const readSpriteDocument = (raw: unknown, file = 'sprite.ashfox'): SpriteDocument => {
  const root = readRecord(file, raw, '', ['masks', 'materials', 'stamps', 'item']);
  const masks = readMasks(file, root.masks);
  const materials = readMaterials(file, root.materials);
  const stamps = readStamps(file, root.stamps);
  const itemRaw = readRecord(
    file,
    root.item,
    '/item',
    ['id', 'profile', 'canvas', 'palette', 'layers'],
    ['slice'],
  );
  const id = readId(file, itemRaw.id, '/item/id');
  const profile = readChoice(file, itemRaw.profile, '/item/profile', SPRITE_PROFILES);
  const [width, height] = readCanvasDims(file, itemRaw.canvas);
  const slice = readNineSlice(file, itemRaw.slice, profile, width, height);
  const palette = readPaletteMap(file, itemRaw.palette);
  const ctx: Context = {
    file,
    width,
    height,
    masks,
    materials: new Set(materials.map((m) => m.id)),
    stamps,
    palette: palette.map,
  };
  const layerSeen = new Set<string>();
  const layers = readList(file, itemRaw.layers, '/item/layers', 64).map((layer, idx) =>
    readLayer(ctx, layer, layerSeen, `/item/layers/${idx}`),
  );
  if (layers.length === 0) failSprite(file, '/item/layers', 'at least one layer', 'empty');
  return freezeSpriteDoc({
    masks: [...masks.values()],
    materials,
    stamps: [...stamps.values()],
    item: {
      id,
      profile,
      canvas: [width, height] as const,
      ...(slice ? { slice } : {}),
      palette: palette.out,
      layers,
    },
  });
};
