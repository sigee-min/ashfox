'use strict';
const fs = require('node:fs');
const path = require('node:path');
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});
const engine = require('../../packages/engine-core/src');
const root = path.resolve(__dirname, '../..');

const CREATURES = Object.freeze([
  { entryName: 'griffin_boss', slug: 'griffin', deps: ['griffin_plumage'] },
  { entryName: 'red_fox', slug: 'fox', deps: ['fox_fur'] },
  { entryName: 'goblin_raider', slug: 'goblin', deps: ['shared_modules'] },
]);

const checked = (result) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
};

const isolateCreatureWorkspace = (workspace, specs) => {
  const wantedEntries = new Set(specs.map((spec) => spec.entryName));
  const wantedPkgs = new Set(['models', 'std', ...specs.flatMap((spec) => spec.deps)]);
  const nextPackages = [];
  const keepPaths = new Set();
  for (const pkg of workspace.manifest.packages) {
    if (!wantedPkgs.has(pkg.name)) continue;
    const entries =
      pkg.name === 'models'
        ? pkg.manifest.entries.filter((entry) => wantedEntries.has(entry.name))
        : [];
    const deps = pkg.manifest.dependencies.filter((dep) => wantedPkgs.has(dep.name));
    nextPackages.push({ ...pkg, manifest: { ...pkg.manifest, entries, dependencies: deps } });
    for (const item of [...entries, ...pkg.manifest.modules]) {
      keepPaths.add(pkg.root ? `${pkg.root}/${item.path}` : item.path);
    }
  }
  return checked(
    engine.applyWorkspaceChangeSet(workspace, {
      expectedWorkspaceHash: engine.computeWorkspaceHash(workspace),
      writes: [],
      deletes: workspace.files
        .filter((file) => !keepPaths.has(file.path))
        .map(({ path: filePath }) => ({ path: filePath })),
      manifest: { ...workspace.manifest, packages: nextPackages },
    }),
  ).workspace;
};

const exportCreature = async (workspace, spec) => {
  const isolated = isolateCreatureWorkspace(workspace, [spec]);
  fs.writeFileSync(
    path.join(root, `assets/workspaces/${spec.slug}.ashfoxworkspace`),
    checked(engine.writeWorkspaceFile(isolated)).source,
  );
  const project = checked(
    engine.openAssetProject({
      workspace: isolated,
      entry: { packageName: 'models', entryName: spec.entryName },
      identity: {
        id: `showcase-${spec.slug}`,
        revision: 'showcase-0001',
        createdAt: '2026-09-08T00:00:00.000Z',
      },
    }),
  ).project;
  const textures = new Map(
    Object.values(project.document.textures).map((texture) => [
      texture.source.key,
      {
        bytes: engine.encodeCanonicalPng(engine.rasterizeTexture(project.document, texture)),
        contentType: 'image/png',
      },
    ]),
  );
  const bundle = await engine.exportProductionProjectResolved(
    project,
    { target: 'glb', modelPath: spec.slug },
    { resolveBlob: async (ref) => textures.get(ref.key) || null },
  );
  const output = path.join(root, 'assets/exports', spec.slug);
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  for (const file of bundle.files)
    fs.writeFileSync(
      path.join(output, file.path),
      file.kind === 'binary' ? file.data : JSON.stringify(file.data, null, 2) + '\n',
    );
  for (const texture of textures.values())
    fs.writeFileSync(path.join(output, `${spec.slug}-texture.png`), texture.bytes);
  console.log(`${spec.slug} (${spec.entryName}): workspace, GLB, texture, lineage`);
};

const main = async () => {
  const { readSnapshot, checkSnapshot } = require('@ashfox/asset-build');
  const compiled = checkSnapshot(readSnapshot(path.join(root, 'showcase/.ashfoxworkspace')));
  const fullWorkspace = compiled.products.find((product) => product.kind === 'model').workspace;
  const sharedCreatures = isolateCreatureWorkspace(fullWorkspace, CREATURES);
  fs.mkdirSync(path.join(root, 'assets/workspaces'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'assets/workspaces/shared-creatures.ashfoxworkspace'),
    checked(engine.writeWorkspaceFile(sharedCreatures)).source,
  );
  for (const spec of CREATURES) await exportCreature(fullWorkspace, spec);
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
