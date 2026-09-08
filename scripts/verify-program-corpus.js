'use strict';

/** Verify the checked-in portable workspace through the public authority path. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { register } = require('ts-node');

register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });

const {
  ASHFOX_WORKSPACE_FILE_EXTENSION,
  evaluateProductionReadiness,
  openAssetProject,
  readWorkspaceFile,
  validateProjectDocument,
  writeWorkspaceFile
} = require('../packages/engine-core/src');

const ROOT = path.resolve(__dirname, '..');
const EXAMPLES_ROOT = path.join(ROOT, 'examples');
const WORKSPACE_PATH = path.join(
  EXAMPLES_ROOT,
  `shared-creatures${ASHFOX_WORKSPACE_FILE_EXTENSION}`
);
const ENTRY_NAMES = Object.freeze(['fox', 'goblin']);
const MODULE_PATHS = Object.freeze([
  'body.ashfox',
  'goblin-body.ashfox',
  'goblin-rig.ashfox',
  'goblin-surface.ashfox',
  'rig.ashfox',
  'surface.ashfox'
]);
const CREATED_AT = '2026-01-01T00:00:00.000Z';

const compileEntry = (workspace, entryName, packageName = 'creatures') => {
  const opened = openAssetProject({
    workspace,
    entry: { packageName, entryName },
    identity: {
      id: `example-${entryName}`,
      revision: 'example-0001',
      createdAt: CREATED_AT
    }
  });
  assert.equal(opened.ok, true, opened.ok ? '' : opened.diagnostics
    .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join(' | '));
  if (!opened.ok) throw new TypeError(`${entryName} did not open.`);
  const report = validateProjectDocument(opened.project.document);
  assert.equal(report.valid, true, `${entryName}: canonical product is invalid.`);
  const readiness = evaluateProductionReadiness(opened.project.document, report);
  assert.equal(readiness.mechanicallyReady, true,
    `${entryName}: product is not mechanically ready.`);
  assert.equal(opened.project.document.name, entryName);
  assert.ok(Object.keys(opened.project.document.scene.nodes).length > 0);
  assert.ok(Object.keys(opened.project.document.textures).length > 0);
  assert.ok(Object.keys(opened.project.document.animations).length > 0);
  return opened.project;
};

const verifyCorpus = () => {
  const exampleFiles = fs.readdirSync(EXAMPLES_ROOT, { withFileTypes: true });
  assert.deepEqual(exampleFiles.map((entry) => entry.name).sort(), [
    `griffin${ASHFOX_WORKSPACE_FILE_EXTENSION}`,
    `shared-creatures${ASHFOX_WORKSPACE_FILE_EXTENSION}`
  ], 'examples must expose canonical portable workspaces and no legacy source tree');
  assert.equal(exampleFiles.every((entry) => entry.isFile()), true);

  const source = fs.readFileSync(WORKSPACE_PATH, 'utf8');
  const read = readWorkspaceFile(source);
  assert.equal(read.ok, true, read.ok ? '' : read.diagnostics
    .map((diagnostic) => diagnostic.message).join(' | '));
  if (!read.ok) throw new TypeError('Example workspace could not be read.');
  const written = writeWorkspaceFile(read.workspace);
  assert.deepEqual(written, { ok: true, source },
    'example workspace must already use the canonical byte encoding');

  const pkg = read.workspace.manifest.packages[0];
  assert.ok(pkg);
  assert.equal(pkg.name, 'creatures');
  assert.deepEqual(pkg.manifest.entries.map((entry) => entry.name), ENTRY_NAMES);
  assert.deepEqual(pkg.manifest.modules.map((module) => module.path), MODULE_PATHS);

  const projects = ENTRY_NAMES.map((entryName) =>
    compileEntry(read.workspace, entryName));
  const griffin = compileEntry(read.workspace, 'griffin', 'workbench');
  projects.push(griffin);
  const standaloneSource = fs.readFileSync(
    path.join(EXAMPLES_ROOT, `griffin${ASHFOX_WORKSPACE_FILE_EXTENSION}`), 'utf8'
  );
  const standalone = readWorkspaceFile(standaloneSource);
  assert.equal(standalone.ok, true);
  assert.deepEqual(writeWorkspaceFile(standalone.workspace), {
    ok: true, source: standaloneSource
  });
  const standaloneGriffin = compileEntry(standalone.workspace, 'griffin', 'workbench');
  assert.equal(standaloneGriffin.build.productHash, griffin.build.productHash,
    'standalone griffin must reproduce the showcased product');
  assert.deepEqual(Object.values(griffin.document.animations).map((clip) =>
    clip.name).sort(), ['alert', 'greeting', 'idle', 'look_around', 'wing_display', 'wing_flap'],
  'the saved griffin must retain every reviewed motion');
  const exportRoot = path.join(ROOT, 'assets', 'exports', 'griffin');
  const lineage = JSON.parse(fs.readFileSync(
    path.join(exportRoot, 'ashfox-lineage.json'), 'utf8'
  ));
  assert.equal(lineage.productHash, griffin.build.productHash,
    'the downloadable GLB must describe the current griffin product');
  const model = fs.readFileSync(path.join(exportRoot, 'griffin.glb'));
  assert.equal(`sha256:${createHash('sha256').update(model).digest('hex')}`,
    lineage.files.find((file) => file.path === 'griffin.glb').sha256,
    'the downloadable GLB bytes must match their export receipt');
  const modelJson = JSON.parse(model.subarray(20, 20 + model.readUInt32LE(12)));
  assert.deepEqual(modelJson.animations.map((clip) => clip.name).sort(),
    Object.values(griffin.document.animations).map((clip) => clip.name).sort(),
    'the downloadable GLB must retain every griffin motion');
  assert.notEqual(projects[0].build.closureHash, projects[1].build.closureHash,
    'each selected root must retain its own exact transitive closure identity');
  assert.equal(projects.every((project) =>
    project.build.workspaceHash === projects[0].build.workspaceHash), true,
  'entries in one workspace must share one atomic workspace authority');

  const nodes = projects.reduce((count, project) =>
    count + Object.keys(project.document.scene.nodes).length, 0);
  console.log(`asset workspace verified: ${projects.length} entries, ` +
    `${read.workspace.files.length} source modules, ${nodes} scene nodes`);
  return projects;
};

if (require.main === module) verifyCorpus();

module.exports = Object.freeze({ verifyCorpus });
