import assert from 'node:assert/strict';

import * as publicApi from '../../src';
import { exportCompatibilityFor, exportCompatibilityOptions } from '../../src/export/compatibility';
import {
  buildExportCompatibilityIndex,
  registeredExportCompatibilityEntries,
  type ExportCompatibilityEntry,
} from '../../src/export/compatibility/registry';

assert.equal(
  'EXPORT_COMPATIBILITY_REGISTRY' in publicApi,
  false,
  'The mutable registry must not be part of the public API.',
);
assert.equal(
  'ASHFOX_GENERIC_FORMAT_VERSION' in publicApi,
  false,
  'The retired generic delivery branch must not remain public.',
);

const entries = registeredExportCompatibilityEntries();
assert.equal(
  entries.length,
  5,
  'Each current target must have exactly one compatibility authority.',
);
assert.equal(Object.isFrozen(entries), true);
assert.ok(entries.every((entry) => Object.isFrozen(entry) && Object.isFrozen(entry.profile)));
assert.equal(
  Reflect.set(entries[0]!.profile, 'id', 'foreign'),
  false,
  'Nested compatibility profiles must be runtime immutable.',
);

const keys = entries.map((entry) => entry.target);
assert.equal(new Set(keys).size, keys.length, 'Every target key must have one current authority.');
for (const target of new Set(entries.map((entry) => entry.target))) {
  assert.equal(
    entries.filter((entry) => entry.target === target).length,
    1,
    `${target} must have exactly one current authority.`,
  );
  assert.equal(exportCompatibilityOptions(target).length, 1);
  assert.equal(
    'isDefaultVersion' in exportCompatibilityOptions(target)[0]!,
    false,
    'A current-only registry must not expose a default selector.',
  );
  assert.equal('gameVersion' in exportCompatibilityOptions(target)[0]!, false);
  assert.equal('gameVersionLabel' in exportCompatibilityOptions(target)[0]!, false);
}

assert.equal(exportCompatibilityFor('geckolib5')?.profile.minecraftVersion, '26.2');
assert.equal(
  Object.prototype.hasOwnProperty.call(exportCompatibilityFor('geckolib5')!.profile, 'version'),
  false,
  'The Gecko target ID owns the major family; no output-inert version label remains.',
);
assert.equal(exportCompatibilityFor('bedrock')?.profile.minecraftVersion, '26.45');
assert.equal(exportCompatibilityFor('java_block')?.profile.minecraftVersion, '26.2');
assert.equal(exportCompatibilityFor('glb')?.profile.version, '2.0');
assert.throws(
  () => Reflect.apply(exportCompatibilityFor, null, ['bedrock', '26.30']),
  /exactly one target/u,
  'A retired second selector argument must fail instead of being ignored.',
);

const mutable = entries.map((entry) => structuredClone(entry));
assert.throws(
  () => buildExportCompatibilityIndex([...mutable, structuredClone(mutable[0]!)] as typeof entries),
  /more than one authority/u,
);
assert.throws(
  () => buildExportCompatibilityIndex(mutable.slice(1) as typeof entries),
  /has no current authority/u,
);
const retired = mutable.map((entry) =>
  entry.target === 'bedrock'
    ? {
        ...entry,
        profile: {
          ...entry.profile,
          minecraftVersion: '1.21.130',
        },
      }
    : entry,
);
assert.throws(
  () => buildExportCompatibilityIndex(retired as unknown as typeof entries),
  /canonical authority/u,
);
const wrongProfile = mutable.map((entry, index) =>
  index === 0 ? { ...entry, profile: { ...entry.profile, id: 'foreign' } } : entry,
);
assert.throws(
  () => buildExportCompatibilityIndex(wrongProfile as unknown as typeof entries),
  /canonical authority/u,
);

const canonicalBedrock = entries.find((entry) => entry.target === 'bedrock')!;
const cloned = (): Record<string, unknown>[] =>
  entries.map((entry) => structuredClone(entry) as unknown as Record<string, unknown>);
const reversedIndex = buildExportCompatibilityIndex(
  cloned().reverse() as unknown as typeof entries,
);
assert.equal(
  reversedIndex.entryFor('bedrock'),
  canonicalBedrock,
  'A valid clone must resolve back to the canonical frozen identity.',
);
assert.equal(
  'entriesByTarget' in reversedIndex,
  false,
  'The private mutable map capability must not escape the index.',
);
assert.equal(Reflect.get(reversedIndex, 'set'), undefined);

const wrongLeaf = (
  target: ExportCompatibilityEntry['target'],
  field: string,
  value: unknown,
): void => {
  const values = cloned();
  const entry = values.find((candidate) => candidate.target === target)!;
  (entry.profile as Record<string, unknown>)[field] = value;
  assert.throws(
    () => buildExportCompatibilityIndex(values as unknown as typeof entries),
    /canonical authority|canonical fields/u,
  );
};
wrongLeaf('bedrock', 'geometryFormatVersion', '9.9.9');
wrongLeaf('bedrock', 'animationFormatVersion', '0');
wrongLeaf('java_block', 'resourcePackFormat', 999);
wrongLeaf('geckolib5', 'assetKind', 'block');
wrongLeaf('geckolib5', 'version', '5');
wrongLeaf('glb', 'imageStorage', 'external');

for (const decorate of [
  (profile: Record<string, unknown>) => {
    Object.defineProperty(profile, 'version', {
      value: '5',
      enumerable: false,
    });
  },
  (profile: Record<string, unknown>) => {
    Reflect.set(profile, Symbol('version'), '5');
  },
]) {
  const values = cloned();
  const profile = values.find((entry) => entry.target === 'geckolib5')!.profile as Record<
    string,
    unknown
  >;
  decorate(profile);
  assert.throws(
    () => buildExportCompatibilityIndex(values as unknown as typeof entries),
    /canonical fields|symbol|own data/u,
  );
}

let geckoVersionGetterReads = 0;
const geckoAccessorValues = cloned();
const geckoAccessor = geckoAccessorValues.find((entry) => entry.target === 'geckolib5')!
  .profile as Record<string, unknown>;
Object.defineProperty(geckoAccessor, 'version', {
  enumerable: true,
  get: () => {
    geckoVersionGetterReads += 1;
    return '5';
  },
});
assert.throws(
  () => buildExportCompatibilityIndex(geckoAccessorValues as unknown as typeof entries),
  /own data field/u,
);
assert.equal(
  geckoVersionGetterReads,
  0,
  'A retired Gecko version accessor must reject without one attacker read.',
);

for (const decorate of [
  (entry: Record<string, unknown>) => {
    entry.extra = true;
  },
  (entry: Record<string, unknown>) => {
    Reflect.set(entry, Symbol('extra'), true);
  },
  (entry: Record<string, unknown>) => {
    Object.defineProperty(entry, 'extra', { value: true, enumerable: false });
  },
]) {
  const values = cloned();
  decorate(values[0]!);
  assert.throws(
    () => buildExportCompatibilityIndex(values as unknown as typeof entries),
    /canonical fields|symbol|own data/u,
  );
}

let getterReads = 0;
const accessorValues = cloned();
const accessorProfile = accessorValues.find((entry) => entry.target === 'bedrock')!
  .profile as Record<string, unknown>;
Object.defineProperty(accessorProfile, 'geometryFormatVersion', {
  enumerable: true,
  get: () => {
    getterReads += 1;
    return '1.21.0';
  },
});
assert.throws(
  () => buildExportCompatibilityIndex(accessorValues as unknown as typeof entries),
  /own data field/u,
);
assert.equal(getterReads, 0, 'Registry validation must reject an accessor without invoking it.');

const aliasValues = cloned();
const aliasIndex = buildExportCompatibilityIndex(aliasValues as unknown as typeof entries);
const aliasBedrock = aliasValues.find((entry) => entry.target === 'bedrock')!;
(aliasBedrock.profile as Record<string, unknown>).geometryFormatVersion = 'foreign';
assert.equal(aliasIndex.entryFor('bedrock'), canonicalBedrock);
assert.equal(
  aliasIndex.entryFor('bedrock')?.profile.geometryFormatVersion,
  '1.21.0',
  'Caller mutation must not alter the canonical index.',
);

console.log('export compatibility single authority ok');
