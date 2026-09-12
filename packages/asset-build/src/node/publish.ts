import * as fs from 'node:fs';
import * as path from 'node:path';
import { BuildFailure, type CompiledBundle, type Snapshot } from '../bundle/contract';
import { digest, json } from '../shared/digest';
import { contained, noLinks, listFiles } from './paths';
import { assertSnapshot } from './snapshot';
import { verifyBundle } from './verify';

const marker = json({ format: 'ashfox-output', version: 1 });
const lockOutput = (directory: string): (() => void) => {
  noLinks(directory);
  fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, '.writer');
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new BuildFailure('output.locked', `Writer lock exists: ${lock}`, 4);
    throw error;
  }
  try {
    fs.writeFileSync(path.join(lock, 'owner.json'), json({ pid: process.pid }));
    const owner = path.join(directory, 'owner.json');
    const entries = fs.readdirSync(directory).filter((name) => name !== '.writer');
    if (entries.length === 0) fs.writeFileSync(owner, marker, { flag: 'wx' });
    else {
      noLinks(owner);
      if (!fs.existsSync(owner) || fs.readFileSync(owner, 'utf8') !== marker)
        throw new BuildFailure('output.unowned', directory, 3);
    }
    return () => fs.rmSync(lock, { recursive: true });
  } catch (error) {
    fs.rmSync(lock, { recursive: true });
    throw error;
  }
};
export const withOutputLocks = async <T>(
  snapshot: Snapshot,
  action: () => Promise<T>,
): Promise<T> => {
  const releases: (() => void)[] = [];
  try {
    const directories = [
      snapshot.config.build.directory,
      ...snapshot.config.exports.map((e) => e.directory),
      ...(snapshot.config.packs ?? []).map((p) => p.directory),
    ].sort();
    for (const directory of directories)
      releases.push(lockOutput(contained(snapshot.root, directory)));
    return await action();
  } finally {
    for (const release of releases.reverse()) release();
  }
};
const write = (directory: string, relative: string, bytes: string | Uint8Array): void => {
  const target = contained(directory, relative);
  noLinks(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fd = fs.openSync(target, 'wx');
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};
/** Mirrors are immutable; only the build directory owns the publication pointer. */
export const publishBundle = (snapshot: Snapshot, bundle: CompiledBundle) => {
  const output = contained(snapshot.root, snapshot.config.build.directory);
  noLinks(path.join(output, 'bundles'));
  fs.mkdirSync(path.join(output, 'bundles'), { recursive: true });
  const destination = path.join(output, 'bundles', bundle.bundleHash);
  const temp = fs.mkdtempSync(path.join(output, '.pending-'));
  try {
    for (const file of bundle.artifacts) write(temp, file.path, file.bytes);
    write(temp, 'receipt.json', json(bundle.receipt));
    verifyBundle(temp, bundle.bundleHash);
    if (fs.existsSync(destination)) verifyBundle(destination, bundle.bundleHash);
    else fs.renameSync(temp, destination);
    const exports = bundle.catalog.assets.map((asset) => {
      const directory = contained(snapshot.root, asset.directory);
      noLinks(path.join(directory, 'bundles'));
      fs.mkdirSync(path.join(directory, 'bundles'), { recursive: true });
      const target = path.join(directory, 'bundles', bundle.bundleHash);
      const pending = fs.mkdtempSync(path.join(directory, '.pending-'));
      const prefix = `assets/${asset.id}/`;
      try {
        for (const file of asset.files)
          write(
            pending,
            file.path.slice(prefix.length),
            fs.readFileSync(contained(destination, file.path)),
          );
        if (!fs.existsSync(target)) fs.renameSync(pending, target);
        noLinks(target);
        const expected = asset.files.map((file) => file.path.slice(prefix.length)).sort();
        if (json(listFiles(target)) !== json(expected))
          throw new BuildFailure('output.integrity', target, 3);
        for (const file of asset.files) {
          const bytes = fs.readFileSync(contained(target, file.path.slice(prefix.length)));
          if (bytes.length !== file.byteLength || digest(bytes) !== file.sha256)
            throw new BuildFailure('output.integrity', file.path, 3);
        }
        return { id: asset.id, directory: target };
      } finally {
        if (fs.existsSync(pending)) fs.rmSync(pending, { recursive: true });
      }
    });
    assertSnapshot(snapshot);
    const pointer = path.join(output, `.current-${process.pid}.json`);
    try {
      write(
        output,
        path.basename(pointer),
        json({ format: 'ashfox-current', version: 1, bundleHash: bundle.bundleHash }),
      );
      noLinks(path.join(output, 'current.json'));
      fs.renameSync(pointer, path.join(output, 'current.json'));
    } finally {
      if (fs.existsSync(pointer)) fs.unlinkSync(pointer);
    }
    return {
      requestKey: bundle.receipt.requestKey,
      bundleHash: bundle.bundleHash,
      bundlePath: destination,
      catalogPath: path.join(destination, 'catalog.json'),
      exports,
    };
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp, { recursive: true });
  }
};
