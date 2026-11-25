import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
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
export const sealObservation = (input: SourceInput): Snapshot | Prepared => {
  if (input.png || input.file?.endsWith('.png')) {
    const resolved = input.file ? resolveInputFile(input.file) : undefined;
    if (resolved) {
      const stat = fs.lstatSync(resolved);
      if (!stat.isFile() || stat.size > 16 * 1024 * 1024)
        throw new BuildFailure('observe.png', 'PNG exceeds 16 MiB or is not a regular file', 2);
    }
    const bytes = input.png ? Buffer.from(input.png, 'base64') : fs.readFileSync(resolved!);
    if (
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.length < 24 ||
      bytes.length > 16 * 1024 * 1024 ||
      !bytes.readUInt32BE(16) ||
      !bytes.readUInt32BE(20) ||
      bytes.readUInt32BE(16) > 4096 ||
      bytes.readUInt32BE(20) > 4096
    )
      throw new BuildFailure('observe.png', 'Invalid PNG or dimensions exceed 4096', 2);
    return {
      kind: 'png',
      revision: createHash('sha256').update(bytes).digest('hex'),
      png: bytes.toString('base64'),
      files: [],
    };
  }
  let snapshot;
  if (input.file) {
    const resolved = resolveInputFile(input.file);
    if (!resolved.endsWith('.ashfox'))
      throw new BuildFailure('observe.input', 'Expected a single .ashfox or .png file', 2);
    snapshot = readSingleSnapshot(resolved);
  } else {
    const name = input.name ?? 'main.ashfox';
    if (name !== path.basename(name) || !name.endsWith('.ashfox'))
      throw new BuildFailure('observe.name', 'name must be a basename ending in .ashfox', 2);
    const files = input.files ?? {};
    if (Object.prototype.hasOwnProperty.call(files, name))
      throw new BuildFailure('observe.source', 'Entry is duplicated in files', 2);
    for (const key of Object.keys(files))
      if (key.includes('..') || key.includes('\\') || path.isAbsolute(key))
        throw new BuildFailure('observe.path', key, 2);
    const memory = { ...files, [name]: input.source! };
    const root = path.resolve('/ashfox-memory');
    snapshot = readStandalone(path.join(root, name), (file, limit) => {
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
  }
  return snapshot;
};
export const prepare = (snapshot: Snapshot): Prepared => {
  const compiled = checkSnapshot(snapshot),
    product = compiled.products[0],
    products = compiled.products.map((entry) => ({ kind: entry.kind, entry: entry.entry }));
  if (product.kind === 'sprite')
    return {
      kind: 'sprite',
      revision: compiled.sourceHash,
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
  if (product.kind !== 'model')
    return {
      kind: product.kind,
      revision: compiled.sourceHash,
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
    products,
    product,
    document: opened.project.document,
    files: snapshot.files,
  };
};
