import {
  EXPORT_PRESETS,
  isExportModelPathValid,
  isExportNamespaceValid,
  type ExportPreset,
} from '../model/exportFormat';

type MinecraftExportPreset = Exclude<ExportPreset, 'glb' | 'gltf'>;

export type ExportAdapterInput =
  | Readonly<{
      target: MinecraftExportPreset;
      namespace: string;
      modelPath: string;
    }>
  | Readonly<{
      target: 'glb' | 'gltf';
      modelPath: string;
    }>;

export class ExportAdapterInputError extends TypeError {
  readonly code = 'export.adapter_input_invalid' as const;

  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ExportAdapterInputError';
  }
}

const fail = (path: string, message: string): never => {
  throw new ExportAdapterInputError(path, message);
};

const dataValue = (value: object, key: string): unknown => {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return fail(`exportAdapter.${key}`, 'Field descriptor could not be read.');
  }
  if (descriptor === undefined) return fail(`exportAdapter.${key}`, 'Required field is missing.');
  if (!descriptor.enumerable || !('value' in descriptor)) {
    return fail(`exportAdapter.${key}`, 'Field must be an enumerable own data property.');
  }
  return descriptor.value;
};

const exactKeys = (value: object, expected: readonly string[]): void => {
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return fail('exportAdapter', 'Input own keys could not be read.');
  }
  const expectedSet = new Set(expected);
  for (const key of keys) {
    if (typeof key !== 'string') return fail('exportAdapter', 'Symbol fields are not allowed.');
    if (!expectedSet.has(key))
      return fail(`exportAdapter.${key}`, 'Unknown field is not part of the current contract.');
  }
  for (const key of expected)
    if (!keys.includes(key)) {
      fail(`exportAdapter.${key}`, 'Required field is missing.');
    }
};

const canonicalText = (value: unknown, path: string): string => {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return fail(path, 'Value must be non-empty canonical text.');
  }
  return value;
};

export function readExportAdapterInput(value: unknown): ExportAdapterInput {
  if (arguments.length !== 1)
    throw new TypeError('readExportAdapterInput expects exactly one input.');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('exportAdapter', 'Input must be a closed plain object.');
  }
  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(value);
  } catch {
    return fail('exportAdapter', 'Input prototype could not be read.');
  }
  if (prototype !== Object.prototype && prototype !== null)
    return fail('exportAdapter', 'Custom prototypes are not allowed.');

  const target = dataValue(value, 'target');
  if (typeof target !== 'string' || !EXPORT_PRESETS.includes(target as ExportPreset))
    return fail('exportAdapter.target', 'Unknown export target.');
  const preset = target as ExportPreset;
  const minecraft = preset !== 'glb' && preset !== 'gltf';
  exactKeys(value, minecraft ? ['target', 'namespace', 'modelPath'] : ['target', 'modelPath']);

  const modelPath = canonicalText(dataValue(value, 'modelPath'), 'exportAdapter.modelPath');
  if (!isExportModelPathValid(preset, modelPath))
    return fail('exportAdapter.modelPath', 'Value must be a safe extensionless relative path.');
  if (!minecraft) return Object.freeze({ target: preset, modelPath }) as ExportAdapterInput;

  const namespace = canonicalText(dataValue(value, 'namespace'), 'exportAdapter.namespace');
  if (!isExportNamespaceValid(preset, namespace))
    return fail('exportAdapter.namespace', 'Value is not a valid Minecraft namespace.');
  return Object.freeze({ target: preset, namespace, modelPath }) as ExportAdapterInput;
}
