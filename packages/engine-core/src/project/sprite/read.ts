import { ItemStudy, SpriteInputError } from './contract';
import { parseSpriteJson } from './json';

type RecordValue = Record<string, unknown>;
export const readItemStudy = (source: string, file = 'study.items.json'): ItemStudy => {
  const fail = (p: string, expected: string, actual: unknown): never => {
    throw new SpriteInputError({ code: 'sprite.contract', file, pointer: p, expected,
      actual: String(actual).slice(0, 160) });
  };
  const record = (v: unknown, p: string, keys?: string[]): RecordValue => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(p, 'record', v);
    const r = v as RecordValue;
    if (keys && (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwnProperty.call(r, k)))) {
      fail(p, `exact keys ${keys.join(', ')}`, Object.keys(r));
    }
    return r;
  };
  const list = (v: unknown, p: string, max: number): unknown[] => {
    if (!Array.isArray(v) || v.length > max) return fail(p, `array <= ${max}`, v);
    return v;
  };
  const integer = (v: unknown, p: string, min: number, max: number): number => {
    if (!Number.isSafeInteger(v) || (v as number) < min || (v as number) > max) return fail(p, `integer ${min}..${max}`, v);
    return v as number;
  };
  const choice = (v: unknown, p: string, choices: readonly unknown[]): void => {
    if (!choices.includes(v)) fail(p, choices.join(' | '), v);
  };
  const id = (v: unknown, p: string): string => {
    if (typeof v !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/u.test(v)) return fail(p, 'ASCII id <= 48', v);
    return v;
  };
  const point = (v: unknown, p: string): number[] => {
    const a = list(v, p, 2);
    if (a.length !== 2) fail(p, '[x, y]', v);
    return a.map((n, i) => integer(n, `${p}/${i}`, 0, 15));
  };
  const color = (v: unknown, p: string): void => {
    if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/iu.test(v)) fail(p, '#RRGGBB', v);
  };
  const rows = (v: unknown, p: string, pattern = /^[.a-zA-Z]+$/u): string[] => {
    const a = list(v, p, 16);
    if (!a.length) return fail(p, 'nonempty rows', v);
    let width = 0;
    a.forEach((r, i) => {
      if (typeof r !== 'string' || !pattern.test(r) || r.length > 16 || (i > 0 && r.length !== width)) {
        fail(`${p}/${i}`, 'rectangular ASCII rows, width 1..16', r);
      }
      width = (r as string).length;
    });
    return a as string[];
  };
  const collection = (v: unknown, p: string, max: number): RecordValue[] => {
    const seen = new Set<string>();
    return list(v, p, max).map((e, i) => {
      const r = record(e, `${p}/${i}`), name = id(r.id, `${p}/${i}/id`);
      if (seen.has(name)) fail(`${p}/${i}/id`, 'unique id', name);
      seen.add(name); return r;
    });
  };
  const root = record(parseSpriteJson(source, file), '', ['format', 'version', 'masks', 'materials', 'stamps', 'items']);
  choice(root.format, '/format', ['ashfox-item-study']); choice(root.version, '/version', [1]);
  const masks = collection(root.masks, '/masks', 64);
  masks.forEach((m, i) => {
    record(m, `/masks/${i}`, ['id', 'rows']);
    if (!rows(m.rows, `/masks/${i}/rows`, /^[.1]+$/u).join('').includes('1')) fail(`/masks/${i}`, 'occupied mask', 'empty');
  });
  const materials = collection(root.materials, '/materials', 64);
  materials.forEach((m, i) => {
    const p = `/materials/${i}`;
    record(m, p, ['id', 'ramp']);
    const r = record(m.ramp, `${p}/ramp`);
    choice(r.mode, `${p}/ramp/mode`, ['explicit', 'generated']);
    if (r.mode === 'explicit') {
      record(r, `${p}/ramp`, ['mode', 'colors']);
      const c = list(r.colors, `${p}/ramp/colors`, 3);
      if (c.length !== 3) fail(`${p}/ramp/colors`, 'three colors', c);
      c.forEach((v, j) => color(v, `${p}/ramp/colors/${j}`));
      const luminance = c.map(v => { const hex = v as string; return [2126,7152,722].reduce((sum,w,j) => sum + w * parseInt(hex.slice(1+j*2,3+j*2),16),0); });
      if (luminance[0]! > luminance[1]! || luminance[1]! > luminance[2]! || luminance[0] === luminance[2]) {
        fail(`${p}/ramp/colors`, 'shadow <= base <= light with distinct endpoints', c);
      }
    } else {
      record(r, `${p}/ramp`, ['mode', 'base', 'preset']); color(r.base, `${p}/ramp/base`);
      choice(r.preset, `${p}/ramp/preset`, ['warm-v1', 'neutral-v1']);
    }
  });
  const stamps = collection(root.stamps, '/stamps', 64);
  stamps.forEach((s, i) => {
    const p = `/stamps/${i}`; record(s, p, ['id', 'rows', 'slots']);
    const used = new Set(rows(s.rows, `${p}/rows`).join('').replace(/\./g, ''));
    const slots = list(s.slots, `${p}/slots`, 52);
    if (slots.length !== used.size || new Set(slots).size !== slots.length || slots.some(v => typeof v !== 'string' || !used.has(v))) {
      fail(`${p}/slots`, 'exact used characters', slots);
    }
  });
  const items = collection(root.items, '/items', 32);
  if (!items.length) fail('/items', 'at least one item', 'empty');
  let budget = 0;
  const ref = (group: RecordValue[], v: unknown, p: string): RecordValue => {
    const found = group.find(e => e.id === v);
    return found ?? fail(p, 'declared reference', v);
  };
  const bounds = (r: string[], at: number[], p: string): void => {
    budget += r.length * r[0]!.length;
    if (at[0]! + r[0]!.length > 16 || at[1]! + r.length > 16) fail(p, 'rectangle inside canvas', at);
  };
  const bindings = (v: unknown, r: string[], palette: RecordValue, p: string): void => {
    const chars = [...new Set(r.join('').replace(/\./g, ''))];
    const map = record(v, p, chars);
    for (const [key, value] of Object.entries(map)) {
      if (typeof value !== 'string' || !Object.hasOwnProperty.call(palette, value)) fail(`${p}/${key}`, 'palette reference', value);
    }
  };
  items.forEach((item, i) => {
    const ip = `/items/${i}`;
    record(item, ip, ['id', 'profile', 'canvas', 'palette', 'layers']);
    choice(item.profile, `${ip}/profile`, ['minecraft-item-v1']);
    const canvas = list(item.canvas, `${ip}/canvas`, 2);
    if (canvas.length !== 2 || canvas.some(v => v !== 16)) fail(`${ip}/canvas`, '[16,16]', canvas);
    const palette = record(item.palette, `${ip}/palette`);
    if (Object.keys(palette).length > 32) fail(`${ip}/palette`, '<= 32 colors', 'too many');
    Object.entries(palette).forEach(([k, v]) => { id(k, `${ip}/palette/${k}`); color(v, `${ip}/palette/${k}`); });
    const layers = collection(item.layers, `${ip}/layers`, 64);
    layers.forEach((l, j) => {
      const p = `${ip}/layers/${j}`;
      choice(l.op, `${p}/op`, ['stamp', 'paint', 'erase', 'part']);
      const at = point(l.at, `${p}/at`);
      if (l.op !== 'part') {
        const keys = l.op === 'stamp' ? ['id', 'op', 'stamp', 'at', 'flip', 'colors'] :
          l.op === 'paint' ? ['id', 'op', 'at', 'rows', 'colors'] : ['id', 'op', 'at', 'rows'];
        record(l, p, keys);
        const r = l.op === 'stamp' ? ref(stamps, l.stamp, `${p}/stamp`).rows as string[] :
          rows(l.rows, `${p}/rows`, l.op === 'erase' ? /^[.1]+$/u : /^[.a-zA-Z]+$/u);
        bounds(r, at, p);
        if (l.op !== 'erase') bindings(l.colors, r, palette, `${p}/colors`);
        if (l.op === 'stamp') choice(l.flip, `${p}/flip`, ['none', 'x', 'y', 'xy']);
        return;
      }
      record(l, p, ['id', 'op', 'mask', 'material', 'at', 'shade', 'grain', 'patches']);
      const mask = ref(masks, l.mask, `${p}/mask`).rows as string[];
      ref(materials, l.material, `${p}/material`); bounds(mask, at, p);
      const shade = record(l.shade, `${p}/shade`);
      choice(shade.form, `${p}/shade/form`, ['flat', 'round', 'bevel']);
      record(shade, `${p}/shade`, shade.form === 'bevel' ? ['form', 'light', 'contrast', 'axis'] : ['form', 'light', 'contrast']);
      choice(shade.light, `${p}/shade/light`, ['top_left']); integer(shade.contrast, `${p}/shade/contrast`, 0, 2);
      if (shade.form === 'bevel') {
        const axis = list(shade.axis, `${p}/shade/axis`, 2);
        if (axis.length !== 2) fail(`${p}/shade/axis`, 'two points', axis);
        const points = axis.map((a, k) => point(a, `${p}/shade/axis/${k}`));
        if (points[0]!.join() === points[1]!.join() || points.some(a => a[0]! >= mask[0]!.length || a[1]! >= mask.length)) {
          fail(`${p}/shade/axis`, 'distinct points inside mask rectangle', axis);
        }
      }
      const grain = record(l.grain, `${p}/grain`, ['mode', 'amount', 'seed']);
      choice(grain.mode, `${p}/grain/mode`, ['clustered-v1']);
      integer(grain.amount, `${p}/grain/amount`, 0, 1); integer(grain.seed, `${p}/grain/seed`, 0, 4294967295);
      collection(l.patches, `${p}/patches`, 16).forEach((patch, k) => {
        const pp = `${p}/patches/${k}`; record(patch, pp, ['id', 'at', 'rows', 'colors', 'protect']);
        const r = rows(patch.rows, `${pp}/rows`), a = point(patch.at, `${pp}/at`);
        bounds(r, a, pp); bindings(patch.colors, r, palette, `${pp}/colors`);
        integer(patch.protect, `${pp}/protect`, 0, 2);
        if (a[0]! + r[0]!.length > mask[0]!.length || a[1]! + r.length > mask.length) fail(pp, 'patch inside part rectangle', a);
        r.forEach((row, y) => [...row].forEach((c, x) => {
          if (c !== '.' && mask[y + a[1]!]![x + a[0]!] !== '1') fail(`${pp}/rows/${y}/${x}`, 'patch inside mask', c);
        }));
      });
    });
  });
  if (budget > 524288) fail('', 'total cells <= 524288', budget);
  // All discriminated variants and references have been checked above.
  return freeze(root) as ItemStudy;
};
const freeze = (value: unknown): unknown => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
