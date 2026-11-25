import { BuildFailure } from '@ashfox/asset-build';
import { DEFAULT_VIEW, type SourceInput, type ViewOptions } from './contract';
const record = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BuildFailure('observe.contract', 'Expected object', 2);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new BuildFailure('observe.contract', 'Unknown field: ' + key, 2);
  return value as Record<string, unknown>;
};
const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.length)
    throw new BuildFailure('observe.contract', 'Expected nonempty string: ' + name, 2);
  return value;
};
export const readInput = (value: unknown): SourceInput => {
  const v = record(value, ['file', 'png', 'source', 'name', 'files']);
  if (v.png !== undefined) {
    if (Object.keys(v).length !== 1)
      throw new BuildFailure('observe.contract', 'png cannot be mixed with source', 2);
    const png = text(v.png, 'png');
    if (
      png.length > 24 * 1024 * 1024 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(png)
    )
      throw new BuildFailure('observe.png', 'Expected bounded base64 PNG', 2);
    return { png };
  }
  if (v.file !== undefined) {
    if (Object.keys(v).length !== 1)
      throw new BuildFailure('observe.contract', 'file cannot be mixed with memory source', 2);
    return { file: text(v.file, 'file') };
  }
  const source = text(v.source, 'source'),
    name = v.name === undefined ? 'main.ashfox' : text(v.name, 'name');
  let files: Record<string, string> | undefined;
  if (v.files !== undefined) {
    if (!v.files || typeof v.files !== 'object' || Array.isArray(v.files))
      throw new BuildFailure('observe.contract', 'files must map paths to source strings', 2);
    files = Object.fromEntries(
      Object.entries(v.files).map(([key, content]) => [key, text(content, key)]),
    );
  }
  return { source, name, files };
};
const enumValue = <const T extends string>(
  value: unknown,
  values: readonly T[],
  key: string,
): T => {
  if (!values.includes(value as T))
    throw new BuildFailure('observe.option', 'Invalid ' + key + ': ' + String(value), 2);
  return value as T;
};
const NUMERIC_RANGES = {
  width: [16, 2048],
  height: [16, 2048],
  azimuth: [-360, 360],
  elevation: [-89, 89],
  zoom: [0.1, 10],
  time: [0, 60],
  fps: [1, 30],
  duration: [0.01, 30],
  scale: [1, 32],
} as const;
const INTEGER_KEYS = new Set<string>(['width', 'height', 'fps', 'scale']);

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const applyPrimitiveViewOptions = (
  v: Record<string, unknown>,
  result: Mutable<ViewOptions>,
): void => {
  for (const key of ['clip', 'variant', 'node', 'texture', 'namespace', 'modelPath'] as const)
    if (v[key] !== undefined) result[key] = text(v[key], key);
  for (const key of ['wireframe', 'skeleton', 'textures'] as const) {
    if (v[key] === undefined) continue;
    if (typeof v[key] !== 'boolean')
      throw new BuildFailure('observe.option', key + ' must be boolean', 2);
    result[key] = v[key];
  }
  for (const key of Object.keys(NUMERIC_RANGES) as (keyof typeof NUMERIC_RANGES)[]) {
    const n = v[key];
    if (n === undefined) continue;
    const [min, max] = NUMERIC_RANGES[key];
    if (
      typeof n !== 'number' ||
      !Number.isFinite(n) ||
      n < min ||
      n > max ||
      (INTEGER_KEYS.has(key) && !Number.isInteger(n))
    )
      throw new BuildFailure('observe.option', 'Invalid ' + key, 2);
    result[key] = n;
  }
};

const applyEnumViewOptions = (v: Record<string, unknown>, result: Mutable<ViewOptions>): void => {
  if (v.format !== undefined)
    result.format = enumValue(
      v.format,
      ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock', 'png', 'wav'],
      'format',
    );
  if (v.camera !== undefined)
    result.camera = enumValue(
      v.camera,
      ['perspective', 'native', 'front', 'back', 'left', 'right', 'top', 'bottom'],
      'camera',
    );
  if (v.environment !== undefined)
    result.environment = enumValue(
      v.environment,
      ['studio', 'day', 'evening', 'night'],
      'environment',
    );
  if (v.background !== undefined)
    result.background = enumValue(
      v.background,
      ['environment', 'transparent', 'checker', 'light', 'dark'],
      'background',
    );
  if (v.stage !== undefined)
    result.stage = enumValue(v.stage, ['final', 'silhouette', 'shade', 'grain'], 'stage');
  if (v.mode !== undefined)
    result.mode = enumValue(v.mode, ['motion', 'turntable', 'build'], 'mode');
  if (v.sheet !== undefined) result.sheet = enumValue(v.sheet, ['turnaround', 'inspect'], 'sheet');
};

export const readView = (value: unknown, previous: ViewOptions = DEFAULT_VIEW): ViewOptions => {
  const v = record(value, [
    'width',
    'height',
    'camera',
    'azimuth',
    'elevation',
    'zoom',
    'environment',
    'background',
    'clip',
    'time',
    'fps',
    'duration',
    'wireframe',
    'skeleton',
    'textures',
    'scale',
    'stage',
    'variant',
    'node',
    'texture',
    'mode',
    'sheet',
    'format',
    'namespace',
    'modelPath',
  ]);
  const result = { ...previous };
  applyPrimitiveViewOptions(v, result);
  applyEnumViewOptions(v, result);
  return result;
};
