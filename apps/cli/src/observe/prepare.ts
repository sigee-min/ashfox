import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BuildFailure,
  readSingleSnapshot,
  readStandalone,
  checkSnapshot,
  type Snapshot,
} from '@ashfox/asset-build';
import { openAssetProject, encodeCanonicalPng } from '@ashfox/engine-core';
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
  if (snapshot.files.length !== Object.keys(memory).length)
    throw new BuildFailure('observe.source', 'Memory sources must all be reachable', 2);
  return snapshot;
};

export const sealObservation = (input: SourceInput): Snapshot => {
  if (!input.file) return sealMemorySnapshot(input);
  const resolved = resolveInputFile(input.file);
  if (!resolved.endsWith('.ashfox'))
    throw new BuildFailure('observe.input', 'Expected a single .ashfox source file', 2);
  return readSingleSnapshot(resolved);
};

export const prepare = (snapshot: Snapshot): Prepared => {
  const compiled = checkSnapshot(snapshot),
    product = compiled.products[0],
    products = compiled.products.map((entry) => ({ kind: entry.kind, entry: entry.entry }));
  if (product.kind === 'sprite')
    return {
      kind: 'sprite',
      revision: compiled.sourceHash,
      declarations: product.declarations,
      products,
      files: snapshot.files,
      sprite: {
        png: product.sprite.png,
        receipt: product.sprite.receipt,
        evidence: product.sprite.evidence,
        stages: {
          silhouette: encodeCanonicalPng(product.sprite.stages.silhouette),
          shade: encodeCanonicalPng(product.sprite.stages.shade),
          grain: encodeCanonicalPng(product.sprite.stages.grain),
        },
      },
    };
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
    document: opened.project.document,
    files: snapshot.files,
  };
};
