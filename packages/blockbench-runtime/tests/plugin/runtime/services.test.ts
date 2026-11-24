import assert from 'node:assert/strict';

import { InMemoryResourceStore } from '../../../src/adapters/resources/resourceStore';
import { createDefaultPolicies } from '../../../src/plugin/runtimeDefaults';
import { buildRuntimeServices } from '../../../src/plugin/runtimeServices';
import { noopLog } from '../../helpers';
import { withGlobals } from '../../support/globals';

let compileReads = 0;
let codecReads = 0;
let codecsReads = 0;
let projectReads = 0;
let deliveryWrites = 0;
let deliveryWriterReads = 0;

const javaFormat: Record<string, unknown> = {
  name: 'Java Block/Item',
  animation_mode: false,
};
Object.defineProperty(javaFormat, 'compile', {
  enumerable: true,
  get() {
    compileReads += 1;
    throw new Error('delivery compiler must not be read');
  },
});
Object.defineProperty(javaFormat, 'codec', {
  enumerable: true,
  get() {
    codecReads += 1;
    throw new Error('delivery codec must not be read');
  },
});

const codecs = new Proxy<Record<string, unknown>>(
  {},
  {
    get() {
      codecsReads += 1;
      throw new Error('Codecs registry must not be read');
    },
    ownKeys() {
      codecsReads += 1;
      throw new Error('Codecs registry must not be enumerated');
    },
  },
);

const blockbench: Record<string, unknown> = {};
for (const key of ['writeFile', 'exportFile']) {
  Object.defineProperty(blockbench, key, {
    enumerable: true,
    get() {
      deliveryWriterReads += 1;
      return () => {
        deliveryWrites += 1;
      };
    },
  });
}
Object.defineProperty(blockbench, 'project', {
  enumerable: true,
  get() {
    projectReads += 1;
    throw new Error('live project must not be read during startup');
  },
});

let runtime: ReturnType<typeof buildRuntimeServices> | undefined;
withGlobals(
  {
    Formats: {
      java_block: javaFormat,
      geckolib_model: { name: 'GeckoLib', animation_mode: true },
      animated_java: { name: 'Animated Java', animation_mode: true },
      free: { name: 'Generic Model', animation_mode: true, meshes: true },
    },
    Codecs: codecs,
    Blockbench: blockbench,
    Project: new Proxy<Record<string, unknown>>(
      {},
      {
        get() {
          projectReads += 1;
          throw new Error('global Project must not be read during startup');
        },
      },
    ),
  },
  () => {
    runtime = buildRuntimeServices({
      blockbenchVersion: '5.1.6',
      formatOverrides: {},
      policies: createDefaultPolicies({}),
      resourceStore: new InMemoryResourceStore(),
      logger: noopLog,
      traceLog: { enabled: false },
    });
  },
);

assert.ok(runtime);
assert.equal(compileReads, 0);
assert.equal(codecReads, 0);
assert.equal(codecsReads, 0);
assert.equal(projectReads, 0);
assert.equal(deliveryWrites, 0);
assert.equal(deliveryWriterReads, 0);
assert.equal(Object.prototype.hasOwnProperty.call(runtime.capabilities, 'exportTargets'), false);
assert.equal(
  runtime.capabilities.formats.find((entry) => entry.format === 'Java Block/Item')?.enabled,
  true,
);
assert.equal(
  runtime.capabilities.formats.find((entry) => entry.format === 'geckolib')?.enabled,
  true,
);
