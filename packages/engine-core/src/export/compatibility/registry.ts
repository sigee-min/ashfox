import { deepFreeze } from '../../immutable';

const EXPORT_COMPATIBILITY_ENTRIES = deepFreeze([
  {
    target: 'geckolib5',
    label: 'GeckoLib 5',
    animationSupport: 'actor',
    profile: {
      id: 'minecraft.java.geckolib5',
      minecraftVersion: '26.2',
      geometryFormatVersion: '1.12.0',
      animationFormatVersion: '1.8.0',
      assetKind: 'entity',
    },
  },
  {
    target: 'java_block',
    label: 'Java block',
    animationSupport: 'none',
    supportsJavaBlockMultiAxisRotation: true,
    profile: {
      id: 'minecraft.java_block',
      minecraftVersion: '26.2',
      resourcePackFormat: 88,
      modelKind: 'block',
    },
  },
  {
    target: 'bedrock',
    label: 'Bedrock geometry',
    animationSupport: 'actor',
    profile: {
      id: 'minecraft.bedrock',
      minecraftVersion: '26.45',
      geometryFormatVersion: '1.21.0',
      animationFormatVersion: '1.8.0',
      geometryKind: 'entity',
    },
  },
  {
    target: 'glb',
    label: 'GLB',
    animationSupport: 'scene',
    profile: {
      id: 'gltf.2',
      version: '2.0',
      container: 'glb',
      imageStorage: 'embedded',
    },
  },
  {
    target: 'gltf',
    label: 'glTF',
    animationSupport: 'scene',
    profile: {
      id: 'gltf.2',
      version: '2.0',
      container: 'gltf',
      imageStorage: 'external',
    },
  },
] as const);

export type ExportCompatibilityEntry = (typeof EXPORT_COMPATIBILITY_ENTRIES)[number];

type ExportCompatibilityTarget = ExportCompatibilityEntry['target'];
const REQUIRED_TARGETS = Object.freeze(EXPORT_COMPATIBILITY_ENTRIES.map((entry) => entry.target));

type OwnDataRecord = ReadonlyMap<string, unknown>;

const ownDataRecord = (value: unknown, path: string): OwnDataRecord => {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    throw new TypeError(`${path} must be one plain own-data object.`);
  const result = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${path} must not contain symbol keys.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new TypeError(`${path}.${key} must be an enumerable own data field.`);
    }
    result.set(key, descriptor.value);
  }
  return result;
};

const arrayValues = (value: unknown): readonly unknown[] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new TypeError('Export compatibility entries must be one plain dense array.');
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    lengthDescriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
    typeof lengthDescriptor.value !== 'number'
  )
    throw new TypeError('Export compatibility entries require one own data length.');
  const length = lengthDescriptor.value;
  const keys = Reflect.ownKeys(value);
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    keys.length !== length + 1 ||
    keys.some((key) => typeof key !== 'string') ||
    !keys.includes('length')
  )
    throw new TypeError('Export compatibility entries must be one plain dense array.');
  const result: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      throw new TypeError('Export compatibility entries must not contain holes or accessors.');
    }
    result.push(descriptor.value);
  }
  return Object.freeze(result);
};

const canonicalEntryForTarget = (target: unknown): ExportCompatibilityEntry | null =>
  typeof target === 'string'
    ? (EXPORT_COMPATIBILITY_ENTRIES.find((entry) => entry.target === target) ?? null)
    : null;

const exactDataTree = (actual: unknown, expected: unknown, path: string): void => {
  if (expected === null || typeof expected !== 'object') {
    if (!Object.is(actual, expected))
      throw new TypeError(`${path} does not match the current canonical authority.`);
    return;
  }
  const actualRecord = ownDataRecord(actual, path);
  const expectedRecord = ownDataRecord(expected, path);
  const actualKeys = [...actualRecord.keys()].sort();
  const expectedKeys = [...expectedRecord.keys()].sort();
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  )
    throw new TypeError(`${path} does not have the exact current canonical fields.`);
  for (const key of expectedKeys)
    exactDataTree(actualRecord.get(key), expectedRecord.get(key), `${path}.${key}`);
};

type ExportCompatibilityIndex = Readonly<{
  entryFor<TTarget extends ExportCompatibilityTarget>(
    target: TTarget,
  ): Extract<ExportCompatibilityEntry, { target: TTarget }> | null;
}>;

/** Builds one current authority per target. Historical target versions and a
 * default-selection layer are deliberately absent. Exported only from this
 * internal module for red-team fixtures; it is absent from the package API. */
export function buildExportCompatibilityIndex(
  entries: readonly ExportCompatibilityEntry[],
): ExportCompatibilityIndex {
  if (arguments.length !== 1)
    throw new TypeError('buildExportCompatibilityIndex expects exactly one argument.');
  const entriesByTarget = new Map<ExportCompatibilityTarget, ExportCompatibilityEntry>();
  for (const [index, value] of arrayValues(entries).entries()) {
    const fields = ownDataRecord(value, `exportCompatibilityEntries[${index}]`);
    const canonical = canonicalEntryForTarget(fields.get('target'));
    if (canonical === null)
      throw new TypeError(`Export compatibility entry ${index} has no canonical target.`);
    exactDataTree(value, canonical, `exportCompatibilityEntries[${index}]`);
    if (entriesByTarget.has(canonical.target))
      throw new TypeError(`Export target ${canonical.target} has more than one authority.`);
    entriesByTarget.set(canonical.target, canonical);
  }
  for (const target of REQUIRED_TARGETS)
    if (!entriesByTarget.has(target)) {
      throw new TypeError(`Export target ${target} has no current authority.`);
    }
  return Object.freeze({
    entryFor<TTarget extends ExportCompatibilityTarget>(target: TTarget) {
      const entry = entriesByTarget.get(target);
      return (entry?.target === target ? entry : null) as Extract<
        ExportCompatibilityEntry,
        { target: TTarget }
      > | null;
    },
  });
}

const compatibilityIndex = buildExportCompatibilityIndex(EXPORT_COMPATIBILITY_ENTRIES);

/** Internal sealed registry projection. It is intentionally absent from the
 * package public API; callers select through the exact indexes below. */
export function registeredExportCompatibilityEntries(): readonly ExportCompatibilityEntry[] {
  if (arguments.length !== 0)
    throw new TypeError('registeredExportCompatibilityEntries expects no arguments.');
  return EXPORT_COMPATIBILITY_ENTRIES;
}

export function registeredExportCompatibilityFor<TTarget extends ExportCompatibilityTarget>(
  target: TTarget,
): Extract<ExportCompatibilityEntry, { target: TTarget }> | null {
  if (arguments.length !== 1)
    throw new TypeError('registeredExportCompatibilityFor expects exactly one target.');
  return compatibilityIndex.entryFor(target);
}
