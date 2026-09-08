'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' } });
const engine = require('../packages/engine-core/src');
const root = path.resolve(__dirname, '..');
const checked = (result) => { if (!result.ok) throw new Error(JSON.stringify(result)); return result; };
const main = async () => {
  const workspace = checked(engine.readWorkspaceFile(fs.readFileSync(path.join(root, 'examples/shared-creatures.ashfoxworkspace')))).workspace;
  for (const name of ['griffin', 'fox', 'goblin']) {
    const packageName = name === 'griffin' ? 'workbench' : 'creatures';
    const pkg = workspace.manifest.packages.find((value) => value.name === packageName);
    const modules = pkg.manifest.modules.filter((value) => name === 'griffin' || value.path.startsWith('goblin-') === (name === 'goblin'));
    const entries = pkg.manifest.entries.filter((value) => value.name === name);
    const paths = new Set([...modules, ...entries].map((value) => `${pkg.root}/${value.path}`));
    const isolated = checked(engine.applyWorkspaceChangeSet(workspace, {
      expectedWorkspaceHash: engine.computeWorkspaceHash(workspace), writes: [],
      deletes: workspace.files.filter((file) => !paths.has(file.path)).map(({ path }) => ({ path })),
      manifest: { ...workspace.manifest, packages: [{ ...pkg, manifest: { ...pkg.manifest, entries, modules } }] }
    })).workspace;
    fs.writeFileSync(path.join(root, `examples/${name}.ashfoxworkspace`), checked(engine.writeWorkspaceFile(isolated)).source);
    const project = checked(engine.openAssetProject({ workspace: isolated, entry: { packageName, entryName: name }, identity: { id: `example-${name}`, revision: 'example-0001', createdAt: '2026-09-08T00:00:00.000Z' } })).project;
    const textures = new Map(Object.values(project.document.textures).map((texture) => [texture.source.key, {
      bytes: engine.encodeCanonicalPng(engine.rasterizeTexture(project.document, texture)), contentType: 'image/png'
    }]));
    const bundle = await engine.exportProductionProjectResolved(project, { target: 'glb', modelPath: name }, { resolveBlob: async (ref) => textures.get(ref.key) || null });
    const output = path.join(root, 'assets/exports', name);
    fs.mkdirSync(output, { recursive: true });
    for (const file of bundle.files) fs.writeFileSync(path.join(output, file.path), file.kind === 'binary' ? file.data : JSON.stringify(file.data, null, 2) + '\n');
    for (const texture of textures.values()) fs.writeFileSync(path.join(output, `${name}-texture.png`), texture.bytes);
    console.log(`${name}: workspace, GLB, texture, lineage`);
  }
};
void main().catch((error) => { console.error(error); process.exitCode = 1; });
