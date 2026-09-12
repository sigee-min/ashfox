'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { register } = require('ts-node');

register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' }
});

const {
  openAssetProject,
  readWorkspaceFile,
  writeWorkspaceFile
} = require('../../packages/engine-core/src');
const {
  BUILD_CAPTURE_FPS,
  createBuildCapturePlan
} = require('@ashfox/render-core/capture/buildCaptureTimeline');
const {
  GIF_CAPTURE_HEIGHT,
  GIF_CAPTURE_WIDTH
} = require('@ashfox/render-core/capture/gifCaptureSurface');

const ROOT = path.resolve(__dirname, '../..');
const WORKSPACE_RELATIVE_PATH = 'assets/workspaces/shared-creatures.ashfoxworkspace';
const WORKSPACE_PATH = path.join(ROOT, WORKSPACE_RELATIVE_PATH);
const SHOWCASE_RELATIVE_PATH = 'assets/showcase/shared-creatures';
const SHOWCASE_PATH = path.join(ROOT, SHOWCASE_RELATIVE_PATH);
const DESCRIPTOR_PATH = path.join(SHOWCASE_PATH, 'showcase.json');
const EXPECTED_SELECTORS = Object.freeze([
  Object.freeze({ packageName: 'workbench', entryName: 'griffin' }),
  Object.freeze({ packageName: 'creatures', entryName: 'fox' }),
  Object.freeze({ packageName: 'creatures', entryName: 'goblin' })
]);
const CAPTURE_SOURCE_ROOTS = Object.freeze([
  'apps/cli/src/observe',
  'packages/render-core/src'
]);
const CAPTURE_SOURCE_FILES = Object.freeze([
  'packages/render-core/package.json',
  'apps/cli/package.json',
  'scripts/showcase/capture.js'
]);
const GIF_LIMIT = 8 * 1024 * 1024;
const GIF_AGGREGATE_LIMIT = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const CREATED_AT = '2026-01-01T00:00:00.000Z';

const fail = (message) => {
  throw new Error(`showcase: ${message}`);
};

const sha256 = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const relativePath = (file) =>
  path.relative(ROOT, file).split(path.sep).join('/');

const walkCaptureSources = (directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkCaptureSources(target));
    else if (entry.isFile() && /\.tsx?$/u.test(entry.name)) files.push(target);
  }
  return files;
};

const captureFingerprint = () => {
  const files = [
    ...CAPTURE_SOURCE_ROOTS.flatMap((root) =>
      walkCaptureSources(path.join(ROOT, root))),
    ...CAPTURE_SOURCE_FILES.map((file) => path.join(ROOT, file))
  ].sort((left, right) => {
    const leftPath = relativePath(left);
    const rightPath = relativePath(right);
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
  const digest = createHash('sha256');
  for (const file of files) {
    const bytes = fs.readFileSync(file);
    const name = relativePath(file);
    digest.update(name);
    digest.update('\0');
    digest.update(String(bytes.byteLength));
    digest.update('\0');
    digest.update(bytes);
    digest.update('\0');
  }
  return `sha256:${digest.digest('hex')}`;
};

const requireBytes = (file, label) => {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch {
    fail(`missing ${label}: ${relativePath(file)}`);
  }
  return bytes;
};

const readUint16Le = (bytes, offset, label) => {
  if (offset + 2 > bytes.length) fail(`truncated GIF ${label}`);
  return bytes.readUInt16LE(offset);
};

const skipGifSubBlocks = (bytes, start) => {
  let offset = start;
  while (true) {
    if (offset >= bytes.length) fail('truncated GIF sub-block');
    const length = bytes[offset];
    offset += 1;
    if (length === 0) return offset;
    if (offset + length > bytes.length) fail('truncated GIF sub-block data');
    offset += length;
  }
};

const inspectGif = (bytes, name) => {
  const signature = bytes.subarray(0, 6).toString('ascii');
  if (signature !== 'GIF87a' && signature !== 'GIF89a') {
    fail(`${name} is not GIF87a/GIF89a`);
  }
  const width = readUint16Le(bytes, 6, 'width');
  const height = readUint16Le(bytes, 8, 'height');
  if (bytes.length < 13) fail(`truncated GIF header: ${name}`);
  const packed = bytes[10];
  let offset = 13;
  if ((packed & 0x80) !== 0) offset += 3 * 2 ** ((packed & 0x07) + 1);
  let frameCount = 0;
  let trailer = false;
  while (offset < bytes.length) {
    const marker = bytes[offset];
    offset += 1;
    if (marker === 0x3b) {
      trailer = true;
      break;
    }
    if (marker === 0x21) {
      if (offset >= bytes.length) fail(`truncated GIF extension: ${name}`);
      offset += 1;
      offset = skipGifSubBlocks(bytes, offset);
      continue;
    }
    if (marker !== 0x2c) fail(`invalid GIF block in ${name}`);
    frameCount += 1;
    if (offset + 9 > bytes.length) fail(`truncated GIF image: ${name}`);
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if ((imagePacked & 0x80) !== 0) {
      offset += 3 * 2 ** ((imagePacked & 0x07) + 1);
    }
    if (offset >= bytes.length) fail(`truncated GIF image data: ${name}`);
    offset += 1;
    offset = skipGifSubBlocks(bytes, offset);
  }
  if (!trailer || offset !== bytes.length) fail(`invalid GIF trailer: ${name}`);
  return { width, height, frameCount };
};

const inspectPng = (bytes, name) => {
  if (bytes.length < 33 ||
      !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.subarray(12, 16).toString('ascii') !== 'IHDR') {
    fail(`${name} is not a valid PNG header`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20)
  };
};

const selectorKey = (selector) =>
  `${selector.packageName}/${selector.entryName}`;

const assertExactSelectors = (workspace) => {
  const selectors = workspace.manifest.packages.flatMap((pkg) =>
    pkg.manifest.entries.map((entry) => ({
      packageName: pkg.name,
      entryName: entry.name
    })));
  const keys = selectors.map(selectorKey);
  if (new Set(keys).size !== keys.length) fail('workspace has duplicate entries');
  const expected = EXPECTED_SELECTORS.map(selectorKey);
  if (keys.length !== expected.length ||
      expected.some((key) => !keys.includes(key))) {
    fail(`workspace entries must be exactly ${expected.join(', ')}`);
  }
};

const openProject = (workspace, selector) => {
  const opened = openAssetProject({
    workspace,
    entry: selector,
    identity: {
      id: `showcase-${selector.entryName}`,
      revision: 'showcase-0001',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT
    }
  });
  if (!opened.ok) {
    fail(`${selectorKey(selector)} cannot compile: ` +
      (opened.diagnostics[0]?.message ?? 'unknown diagnostic'));
  }
  return opened.project;
};

const assertMediaInventory = (workspace) => {
  const expected = new Set(EXPECTED_SELECTORS.flatMap(({ entryName }) => [
    `${entryName}-build-replay.gif`,
    `${entryName}-build-replay.mp4`,
    `${entryName}-poster.png`,
    ...Object.values(openProject(workspace, EXPECTED_SELECTORS.find((selector) => selector.entryName === entryName)).document.animations)
      .map((clip) => `${entryName}-${clip.name}.mp4`)
  ]));
  const actual = fs.readdirSync(SHOWCASE_PATH, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:gif|png|mp4)$/iu.test(entry.name))
    .map((entry) => entry.name);
  const orphan = actual.find((name) => !expected.has(name));
  if (orphan) fail(`orphan media file: ${orphan}`);
  const missing = [...expected].find((name) => !actual.includes(name));
  if (missing) fail(`missing media file: ${missing}`);
};

const createDescriptor = () => {
  if (GIF_CAPTURE_WIDTH !== 640 || GIF_CAPTURE_HEIGHT !== 360 ||
      BUILD_CAPTURE_FPS !== 10) {
    fail('capture contract must remain 640x360 at 10 fps');
  }
  const workspaceBytes = requireBytes(WORKSPACE_PATH, 'canonical workspace');
  const read = readWorkspaceFile(workspaceBytes);
  if (!read.ok) {
    fail(`workspace is invalid: ${read.diagnostics[0]?.message ?? 'unknown diagnostic'}`);
  }
  const written = writeWorkspaceFile(read.workspace);
  if (!written.ok ||
      !Buffer.from(written.source, 'utf8').equals(workspaceBytes)) {
    fail('workspace bytes are not canonical');
  }
  assertExactSelectors(read.workspace);
  assertMediaInventory(read.workspace);

  let aggregateGifBytes = 0;
  const entries = EXPECTED_SELECTORS.map((selector) => {
    const project = openProject(read.workspace, selector);
    const plan = createBuildCapturePlan(project.document);
    const artifact = `${selector.entryName}-build-replay.gif`;
    const poster = `${selector.entryName}-poster.png`;
    const videoFile = `${selector.entryName}-build-replay.mp4`;
    const videoBytes = requireBytes(path.join(SHOWCASE_PATH, videoFile), 'build movie');
    if (videoBytes.subarray(4, 8).toString('ascii') !== 'ftyp' || videoBytes.length > 2 * 1024 * 1024) fail(`Invalid build movie: ${videoFile}`);
    const gifBytes = requireBytes(path.join(SHOWCASE_PATH, artifact), 'GIF');
    const pngBytes = requireBytes(path.join(SHOWCASE_PATH, poster), 'poster');
    if (gifBytes.byteLength > GIF_LIMIT) {
      fail(`${artifact} exceeds 8 MiB`);
    }
    aggregateGifBytes += gifBytes.byteLength;
    const gif = inspectGif(gifBytes, artifact);
    const png = inspectPng(pngBytes, poster);
    if (gif.width !== GIF_CAPTURE_WIDTH || gif.height !== GIF_CAPTURE_HEIGHT ||
        png.width !== GIF_CAPTURE_WIDTH || png.height !== GIF_CAPTURE_HEIGHT) {
      fail(`${selector.entryName} media must be 640x360`);
    }
    if (gif.frameCount !== plan.frames.length) {
      fail(`${artifact} has ${gif.frameCount} frames, expected ${plan.frames.length}`);
    }
    return {
      video: { artifact: videoFile, sha256: sha256(videoBytes), byteLength: videoBytes.length },
      motions: Object.values(project.document.animations).map((clip) => {
        const file = `${selector.entryName}-${clip.name}.mp4`;
        const bytes = requireBytes(path.join(SHOWCASE_PATH, file), 'motion movie');
        if (bytes.subarray(4, 8).toString('ascii') !== 'ftyp' || bytes.length > 2 * 1024 * 1024) fail(`Invalid or oversized movie: ${file}`);
        return { name: clip.name, duration: clip.durationSeconds, artifact: file, sha256: sha256(bytes), byteLength: bytes.length };
      }),
      packageName: selector.packageName,
      entryName: selector.entryName,
      closureHash: project.build.closureHash,
      buildKey: project.build.buildKey,
      productHash: project.build.productHash,
      artifact,
      poster,
      artifactSha256: sha256(gifBytes),
      posterSha256: sha256(pngBytes),
      byteLength: gifBytes.byteLength,
      frameCount: plan.frames.length,
      eventCount: plan.events.length
    };
  });
  if (aggregateGifBytes > GIF_AGGREGATE_LIMIT) {
    fail('GIF replay set exceeds 16 MiB');
  }

  return {
    format: 'ashfox-showcase',
    version: 1,
    workspace: {
      path: WORKSPACE_RELATIVE_PATH,
      sha256: sha256(workspaceBytes),
      workspaceHash: openProject(read.workspace, EXPECTED_SELECTORS[0])
        .build.workspaceHash
    },
    capture: {
      fingerprint: captureFingerprint(),
      environment: 'studio',
      camera: 'perspective',
      width: GIF_CAPTURE_WIDTH,
      height: GIF_CAPTURE_HEIGHT,
      fps: BUILD_CAPTURE_FPS
    },
    entries
  };
};

const atomicWrite = (file, source) => {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, source, { encoding: 'utf8', flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};

const main = () => {
  const unexpected = process.argv.slice(2).filter((argument) => argument !== '--write');
  if (unexpected.length > 0 || process.argv.filter(
    (argument) => argument === '--write').length > 1) {
    fail('usage: node scripts/showcase/verify.js [--write]');
  }
  const source = `${JSON.stringify(createDescriptor(), null, 2)}\n`;
  if (process.argv.includes('--write')) {
    atomicWrite(DESCRIPTOR_PATH, source);
    console.log(`showcase descriptor sealed: ${relativePath(DESCRIPTOR_PATH)}`);
    return;
  }
  const current = requireBytes(DESCRIPTOR_PATH, 'descriptor');
  if (!current.equals(Buffer.from(source, 'utf8'))) {
    fail('descriptor is stale; run npm run showcase:seal');
  }
  console.log(`showcase descriptor current: ${EXPECTED_SELECTORS.length} entries`);
};

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
