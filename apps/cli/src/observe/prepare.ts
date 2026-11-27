import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BuildFailure,
  readSingleSnapshot,
  readSnapshot,
  readStandalone,
  checkSnapshot,
  type Snapshot,
} from '@ashfox/asset-build';
import {
  openAssetProject,
  encodeCanonicalPng,
  inspectNativeSource,
  isStdLibraryLogicalPath,
  isVirtualLibrarySpecifier,
  readDirectoryWorkspace,
} from '@ashfox/engine-core';
import type { Prepared, SourceInput } from './contract';

export const resolveInputFile = (file: string): string => {
  const requested = path.resolve(file);
  return path.join(fs.realpathSync(path.dirname(requested)), path.basename(requested));
};

const isSafeMemoryPath = (value: string): boolean =>
  Boolean(value) &&
  value.endsWith('.ashfox') &&
  !value.startsWith('/') &&
  !value.includes('..') &&
  !value.includes('\\');

const sealMemorySnapshot = (input: SourceInput): Snapshot => {
  const name = input.name ?? 'main.ashfox';
  if (!isSafeMemoryPath(name)) {
    throw new BuildFailure('observe.name', 'name must be a relative path ending in .ashfox', 2);
  }
  const files = input.files ?? {};
  if (Object.prototype.hasOwnProperty.call(files, name))
    throw new BuildFailure('observe.source', 'Entry is duplicated in files', 2);
  for (const key of Object.keys(files))
    if (key.includes('..') || key.includes('\\') || path.isAbsolute(key))
      throw new BuildFailure('observe.path', key, 2);
  const memory = { ...files, [name]: input.source! };
  const root = path.resolve('/ashfox-memory', 'assets');
  const snapshot = readStandalone(path.join(root, name), (file, limit) => {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const source = memory[relative];
    if (typeof source !== 'string' || Buffer.byteLength(source) > limit)
      throw new BuildFailure(
        'observe.source',
        'Missing or oversized memory source: ' + relative,
        2,
      );
    return source;
  });
  if (
    snapshot.files.filter((f) => !isStdLibraryLogicalPath(f.path)).length !==
    Object.keys(memory).length
  )
    throw new BuildFailure('observe.source', 'Memory sources must all be reachable', 2);
  return snapshot;
};

const joinPkgPath = (root: string, file: string): string => [root, file].filter(Boolean).join('/');

const enqueueModuleImport = (
  spec: string,
  cur: string,
  byAlias: ReadonlyMap<string, { readonly pkg: string; readonly filePath: string }>,
  usedPkgs: Set<string>,
  queue: string[],
): void => {
  if (isVirtualLibrarySpecifier(spec)) return;
  if (spec.startsWith('.')) {
    queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(cur), spec)));
    return;
  }
  const hit = byAlias.get(spec);
  if (!hit) return;
  usedPkgs.add(hit.pkg);
  queue.push(hit.filePath);
};

const collectUsedModuleClosure = (
  entryPath: string,
  ownerName: string,
  packages: Snapshot['config']['packages'],
  snapshotFiles: Snapshot['files'],
): { readonly usedPaths: ReadonlySet<string>; readonly usedPkgs: ReadonlySet<string> } => {
  const byAlias = new Map<string, { readonly pkg: string; readonly filePath: string }>();
  for (const pkg of packages) {
    for (const mod of pkg.manifest.modules) {
      const sub = mod.subpath.replace(/^\.\//u, '');
      byAlias.set(`${pkg.name}/${sub}`, {
        pkg: pkg.name,
        filePath: joinPkgPath(pkg.root, mod.path),
      });
    }
  }
  const filesByPath = new Map(snapshotFiles.map((f) => [f.path, f]));
  const usedPaths = new Set<string>();
  const usedPkgs = new Set<string>([ownerName]);
  const queue = [entryPath];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    if (usedPaths.has(cur)) continue;
    usedPaths.add(cur);
    const file = filesByPath.get(cur);
    if (!file) continue;
    for (const spec of inspectNativeSource(file.source, cur).imports) {
      enqueueModuleImport(spec, cur, byAlias, usedPkgs, queue);
    }
  }
  return { usedPaths, usedPkgs };
};

const narrowWorkspaceSnapshot = (snapshot: Snapshot, resolvedFile: string): Snapshot => {
  const realRoot = fs.existsSync(snapshot.root) ? fs.realpathSync(snapshot.root) : snapshot.root;
  const rel = path.relative(realRoot, resolvedFile).split(path.sep).join('/');
  const owner = snapshot.config.packages.find((p) =>
    p.manifest.entries.some((e) => joinPkgPath(p.root, e.path) === rel),
  );
  if (!owner) return snapshot;
  const entry = owner.manifest.entries.find((e) => joinPkgPath(owner.root, e.path) === rel)!;
  const { usedPaths, usedPkgs } = collectUsedModuleClosure(
    rel,
    owner.name,
    snapshot.config.packages,
    snapshot.files,
  );
  const packages = snapshot.config.packages
    .filter((p) => usedPkgs.has(p.name))
    .map((p) => ({
      ...p,
      manifest: {
        ...p.manifest,
        entries: p.name === owner.name ? [entry] : [],
        modules: p.manifest.modules.filter((m) => usedPaths.has(joinPkgPath(p.root, m.path))),
        dependencies: p.manifest.dependencies.filter((d) => usedPkgs.has(d.name)),
      },
    }));
  const configuration = JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: snapshot.config.name,
    packages,
    include: snapshot.config.include,
    ignore: snapshot.config.ignore,
    build: { directory: snapshot.config.build.directory },
    exports: [],
  });
  const files = snapshot.files.filter(
    (f) => isStdLibraryLogicalPath(f.path) || usedPaths.has(f.path),
  );
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ configuration, files }))
    .digest('hex');
  return { ...snapshot, configuration, config: readDirectoryWorkspace(configuration), files, hash };
};

export const readObservationFileSnapshot = (file: string): Snapshot => {
  const resolved = resolveInputFile(file);
  try {
    return readSingleSnapshot(resolved);
  } catch (error) {
    if (!(error instanceof BuildFailure) || error.code !== 'source.import') throw error;
    try {
      return narrowWorkspaceSnapshot(readSnapshot(resolved), resolved);
    } catch {
      throw error;
    }
  }
};

export const sealObservation = (input: SourceInput): Snapshot => {
  if (!input.file) return sealMemorySnapshot(input);
  const resolved = resolveInputFile(input.file);
  if (!resolved.endsWith('.ashfox'))
    throw new BuildFailure('observe.input', 'Expected a single .ashfox source file', 2);
  return readObservationFileSnapshot(resolved);
};

const prepareSprite = (
  compiled: ReturnType<typeof checkSnapshot>,
  product: Extract<ReturnType<typeof checkSnapshot>['products'][number], { kind: 'sprite' }>,
  products: Prepared['products'],
  files: Prepared['files'],
): Prepared => ({
  kind: 'sprite',
  revision: compiled.sourceHash,
  declarations: product.declarations,
  products,
  files,
  sprite: {
    profile: product.sprite.profile,
    png: product.sprite.png,
    rgba: product.sprite.raster.rgba.copy(),
    receipt: product.sprite.receipt,
    evidence: product.sprite.evidence,
    telemetry: product.sprite.telemetry,
    stages: {
      silhouette: encodeCanonicalPng(product.sprite.stages.silhouette),
      shade: encodeCanonicalPng(product.sprite.stages.shade),
      grain: encodeCanonicalPng(product.sprite.stages.grain),
    },
  },
});

const selectPreparedProduct = (
  compiled: ReturnType<typeof checkSnapshot>,
  snapshot: Snapshot,
  selectedFile?: string,
) => {
  if (!selectedFile) return compiled.products[0];
  const realRoot = fs.existsSync(snapshot.root) ? fs.realpathSync(snapshot.root) : snapshot.root;
  const realSelected = fs.existsSync(selectedFile) ? fs.realpathSync(selectedFile) : selectedFile;
  const rel = path.relative(realRoot, realSelected).split(path.sep).join('/');
  for (const pkg of snapshot.config.packages) {
    const hit = pkg.manifest.entries.find(
      (e) => [pkg.root, e.path].filter(Boolean).join('/') === rel,
    );
    if (!hit) continue;
    const match = compiled.products.find(
      (p) => p.entry.packageName === pkg.name && p.entry.entryName === hit.name,
    );
    if (match) return match;
  }
  return compiled.products[0];
};

export const prepare = (snapshot: Snapshot, selectedFile?: string): Prepared => {
  const compiled = checkSnapshot(snapshot),
    product = selectPreparedProduct(compiled, snapshot, selectedFile),
    products = compiled.products.map((entry) => ({ kind: entry.kind, entry: entry.entry }));
  if (product.kind === 'sprite') return prepareSprite(compiled, product, products, snapshot.files);
  if (product.kind === 'structure')
    return {
      kind: 'structure',
      revision: compiled.sourceHash,
      declarations: product.declarations,
      products,
      product,
      document: product.structure.document,
      files: snapshot.files,
    };
  if (product.kind !== 'model')
    return {
      kind: product.kind,
      revision: compiled.sourceHash,
      declarations: product.declarations,
      products,
      product,
      files: snapshot.files,
    };
  const opened = openAssetProject({
    workspace: product.workspace,
    entry: product.entry,
    identity: { id: 'observe', revision: compiled.buildKey, createdAt: '2000-01-01T00:00:00.000Z' },
  });
  if (!opened.ok) throw new BuildFailure('observe.model', JSON.stringify(opened));
  return {
    kind: 'model',
    revision: compiled.sourceHash,
    declarations: product.declarations,
    products,
    product,
    project: opened.project,
    document: opened.project.document,
    files: snapshot.files,
  };
};
