import assert from 'node:assert/strict';

import { adaptProjectForExport, validateProjectDocument } from '../../src';
import { canonicalProjectFromExportAdapter } from '../../src/export/adapter';
import { createProjectDocument } from '../../src/project/create';

const project = createProjectDocument({
  id: 'project-empty',
  name: ' Empty project ',
  revision: 'local-0001',
  createdAt: '2026-07-29T00:00:00.000Z',
});

assert.equal(project.name, 'Empty project');
assert.deepEqual(project.settings.textureResolution, {
  width: 16,
  height: 16,
});
assert.equal(project.settings.surfacePixelDensity, 1);
assert.deepEqual(project.settings.coordinateSystem, {
  up: 'y',
  handedness: 'right',
  unit: 'pixel',
  rotationUnit: 'degree',
  rotationOrder: 'xyz',
});
const serializedSettings = JSON.parse(JSON.stringify(project.settings)) as {
  coordinateSystem: { unit?: string };
};
assert.equal(
  serializedSettings.coordinateSystem.unit,
  'pixel',
  'the canonical coordinate unit must survive JSON serialization',
);
assert.deepEqual(project.scene, { roots: [], nodes: {} });
assert.equal(Object.hasOwn(project, 'formatProfile'), false);
assert.equal(validateProjectDocument(project).valid, true);

const variableUnit = {
  ...project,
  settings: {
    ...project.settings,
    coordinateSystem: {
      ...project.settings.coordinateSystem,
      unit: 'block',
    },
  },
};
assert.equal(
  validateProjectDocument(variableUnit).valid,
  false,
  'a non-pixel coordinate unit must not become a mutable project authority',
);

const missingUnit = JSON.parse(JSON.stringify(project)) as {
  settings: {
    coordinateSystem: { unit?: string };
  };
};
delete missingUnit.settings.coordinateSystem.unit;
assert.equal(
  validateProjectDocument(missingUnit).valid,
  false,
  'serialized project settings must retain the fixed coordinate unit',
);

const minecraftDelivery = adaptProjectForExport(project, {
  target: 'bedrock',
  namespace: 'ashfox',
  modelPath: 'empty_project',
});
assert.equal(minecraftDelivery.formatProfile.id, 'minecraft.bedrock');
assert.deepEqual(canonicalProjectFromExportAdapter(minecraftDelivery), project);

const glbDelivery = adaptProjectForExport(project, {
  target: 'glb',
  modelPath: 'empty_project',
});
assert.equal(glbDelivery.formatProfile.id, 'gltf.2');
assert.equal(glbDelivery.formatProfile.container, 'glb');
assert.deepEqual(canonicalProjectFromExportAdapter(glbDelivery), project);

const gltfAfterMinecraft = adaptProjectForExport(minecraftDelivery, {
  target: 'gltf',
  modelPath: 'empty_project',
});
assert.deepEqual(canonicalProjectFromExportAdapter(gltfAfterMinecraft), project);

assert.throws(
  () =>
    createProjectDocument({
      id: 'project-invalid',
      name: ' ',
      revision: 'local-0001',
      createdAt: '2026-07-29T00:00:00.000Z',
    }),
  /Project name/,
);
