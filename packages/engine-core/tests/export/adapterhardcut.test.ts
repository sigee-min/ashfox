import assert from 'node:assert/strict';

import { readExportAdapterInput, ExportAdapterInputError } from '../../src/export/adapter';
import {
  exportCompatibilityFor,
  exportCompatibilityOptions,
  exportTargetDescriptorForPreset,
} from '../../src/export/compatibility';
import {
  assertExportBundleMatchesPreset,
  exportPresetForBundle,
} from '../../src/export/compatibility/target';
import type { ExportBundle } from '../../src/export/contract';
import { compileProjectBundle } from '../../src/export/pipeline/compile';
import { VALID_ASSET_SOURCE } from '../program/asset/fixture';
import { exportProject } from './fixture';

const minecraft = {
  target: 'bedrock',
  namespace: 'ashfox',
  modelPath: 'entity/bog',
} as const;
const gltf = { target: 'gltf', modelPath: 'models/bog' } as const;
assert.deepEqual(readExportAdapterInput(minecraft), minecraft);
assert.deepEqual(readExportAdapterInput(gltf), gltf);
assert.equal(Object.isFrozen(readExportAdapterInput(minecraft)), true);

const rejects = (value: unknown, path: string): void =>
  assert.throws(
    () => readExportAdapterInput(value),
    (error: unknown) => error instanceof ExportAdapterInputError && error.path === path,
  );
rejects({ ...minecraft, gameVersion: '26.45' }, 'exportAdapter.gameVersion');
rejects({ target: 'bedrock', modelPath: 'bog' }, 'exportAdapter.namespace');
rejects({ target: 'glb', namespace: 'ashfox', modelPath: 'bog' }, 'exportAdapter.namespace');
rejects({ ...minecraft, modelPath: ' bog ' }, 'exportAdapter.modelPath');
rejects({ ...minecraft, namespace: ' Ashfox ' }, 'exportAdapter.namespace');
rejects(Object.assign(Object.create({}), minecraft), 'exportAdapter');

const nonEnumerable = { ...minecraft } as Record<string, unknown>;
Object.defineProperty(nonEnumerable, 'gameVersion', {
  enumerable: false,
  value: '26.45',
});
rejects(nonEnumerable, 'exportAdapter.gameVersion');
const symbolic = { ...minecraft, [Symbol('gameVersion')]: '26.45' };
rejects(symbolic, 'exportAdapter');
const accessor = { namespace: 'ashfox', modelPath: 'bog' } as Record<string, unknown>;
Object.defineProperty(accessor, 'target', {
  enumerable: true,
  get: () => 'bedrock',
});
rejects(accessor, 'exportAdapter.target');

assert.throws(() => Reflect.apply(readExportAdapterInput, null, []), /exactly one input/u);
assert.throws(
  () => Reflect.apply(exportCompatibilityFor, null, ['bedrock', '26.45']),
  /exactly one target/u,
);
assert.throws(
  () => Reflect.apply(exportCompatibilityOptions, null, ['bedrock', '26.45']),
  /at most one target/u,
);

assert.deepEqual(exportTargetDescriptorForPreset('bedrock').target, {
  id: 'minecraft.bedrock',
  version: '26.45',
});
assert.deepEqual(exportTargetDescriptorForPreset('geckolib5').target, {
  id: 'minecraft.java.geckolib5',
  version: '26.2',
});
assert.deepEqual(exportTargetDescriptorForPreset('java_block').target, {
  id: 'minecraft.java_block',
  version: '26.2',
});
assert.deepEqual(exportTargetDescriptorForPreset('glb').target, {
  id: 'gltf.2',
  version: '2.0',
});
assert.equal(
  exportTargetDescriptorForPreset('bedrock'),
  exportTargetDescriptorForPreset('bedrock'),
  'Each target must resolve to one sealed descriptor object.',
);
assert.equal(Object.isFrozen(exportTargetDescriptorForPreset('bedrock').target), true);

const bundle = (container: 'glb' | 'gltf'): ExportBundle =>
  ({
    target: { id: 'gltf.2', version: '2.0' },
    rootPath: 'gltf',
    files: [
      {
        kind: container === 'glb' ? 'binary' : 'json',
        role: 'model',
        path: `bog.${container}`,
        contentType: container === 'glb' ? 'model/gltf-binary' : 'model/gltf+json',
      },
    ],
  }) as unknown as ExportBundle;
assert.equal(exportPresetForBundle(bundle('glb')), 'glb');
assert.equal(exportPresetForBundle(bundle('gltf')), 'gltf');
assert.doesNotThrow(() => assertExportBundleMatchesPreset('glb', bundle('glb')));
assert.throws(
  () => assertExportBundleMatchesPreset('glb', bundle('gltf')),
  /Requested glb but emitted gltf/u,
);
assert.throws(
  () => assertExportBundleMatchesPreset('gltf', bundle('glb')),
  /Requested gltf but emitted glb/u,
);
const old = bundle('glb');
(old.target as { version: string }).version = '1.0';
assert.equal(exportPresetForBundle(old), null);
assert.throws(() => assertExportBundleMatchesPreset('glb', old), /target\.version/u);

const bedrockBundle = ({
  files = [
    {
      kind: 'json',
      role: 'geometry',
      path: 'models/entity/bog.geo.json',
      contentType: 'application/json',
    },
  ],
}: { files?: readonly unknown[] } = {}): ExportBundle =>
  ({
    target: { id: 'minecraft.bedrock', version: '26.45' },
    rootPath: 'bedrock-resource-pack-assets',
    files,
  }) as unknown as ExportBundle;
assert.equal(exportPresetForBundle(bedrockBundle()), 'bedrock');
assert.throws(
  () => assertExportBundleMatchesPreset('bedrock', bedrockBundle({ files: [] })),
  /exportBundle\.files/u,
);
assert.throws(
  () =>
    assertExportBundleMatchesPreset(
      'bedrock',
      bedrockBundle({ files: [...bedrockBundle().files, ...bedrockBundle().files] }),
    ),
  /exportBundle\.files/u,
  'A duplicated primary role must not self-identify as a delivery preset.',
);
assert.throws(
  () =>
    assertExportBundleMatchesPreset(
      'bedrock',
      bedrockBundle({
        files: [
          {
            kind: 'json',
            role: 'geometry',
            path: 'models/entity/bog.geo.json',
            contentType: 'model/gltf+json',
          },
        ],
      }),
    ),
  /exportBundle\.files\[0\]/u,
);

const empty = exportProject(undefined, 'adapter-hardcut');
for (const preset of ['glb', 'gltf'] as const) {
  const emitted = compileProjectBundle(empty, {
    target: preset,
    modelPath: 'adapter_hardcut',
  });
  assert.equal(exportPresetForBundle(emitted), preset);
  assert.equal(
    emitted.target,
    exportTargetDescriptorForPreset(preset).target,
    'The exporter must consume the sole registry target descriptor.',
  );
  assert.equal(Object.isFrozen(emitted), true);
  assert.equal(Object.isFrozen(emitted.entrypoints), true);
  assert.equal(Object.isFrozen(emitted.files), true);
  assert.equal(Object.isFrozen(emitted.lineage), true);
  assert.equal(Object.isFrozen(emitted.findings), true);
  assert.equal(Object.isFrozen(emitted.adaptations), true);
}

const alternate = exportProject(
  VALID_ASSET_SOURCE.replace('origin = (-2u, 0u, -2u)', 'origin = (-1u, 0u, -2u)'),
  'adapter-alternate',
);
assert.throws(
  () =>
    compileProjectBundle(
      {
        ...empty,
        build: { ...empty.build, productHash: alternate.build.productHash },
      },
      gltf,
    ),
  /workspace, entry, and build identity/u,
  'A forged build identity must not authorize export.',
);
assert.throws(
  () =>
    compileProjectBundle(
      {
        ...empty,
        workspace: alternate.workspace,
      },
      gltf,
    ),
  /workspace, entry, and build identity/u,
  'A swapped workspace must not authorize export.',
);
assert.throws(
  () =>
    compileProjectBundle(
      {
        ...empty,
        document: alternate.document,
      },
      gltf,
    ),
  /workspace, entry, and document/u,
  'A swapped derived document must not authorize export.',
);

console.log('export adapter current-only hardcut ok');
