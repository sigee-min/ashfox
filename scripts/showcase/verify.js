'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { register } = require('ts-node');
const { unzlibSync } = require('fflate');
const { compareText, sha256: sha256Hex } = require('../shared');

register({
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
});

const {
  encodeRgbaBufferPng,
  openAssetProject,
  readWorkspaceFile,
  writeWorkspaceFile,
} = require('../../packages/engine-core/src');
const {
  BUILD_CAPTURE_FPS,
  createBuildCapturePlan,
} = require('@ashfox/render-core/capture/buildCaptureTimeline');
const {
  GIF_CAPTURE_HEIGHT,
  GIF_CAPTURE_WIDTH,
} = require('@ashfox/render-core/capture/gifCaptureSurface');

const ROOT = path.resolve(__dirname, '../..');
const WORKSPACE_RELATIVE_PATH = 'assets/workspaces/shared-creatures.ashfoxworkspace';
const WORKSPACE_PATH = path.join(ROOT, WORKSPACE_RELATIVE_PATH);
const SHOWCASE_RELATIVE_PATH = 'assets/showcase/shared-creatures';
const SHOWCASE_PATH = path.join(ROOT, SHOWCASE_RELATIVE_PATH);
const DESCRIPTOR_PATH = path.join(SHOWCASE_PATH, 'showcase.json');
const EXPECTED_SELECTORS = Object.freeze([
  Object.freeze({ packageName: 'models', entryName: 'griffin_boss', slug: 'griffin' }),
  Object.freeze({ packageName: 'models', entryName: 'red_fox', slug: 'fox' }),
  Object.freeze({ packageName: 'models', entryName: 'goblin_raider', slug: 'goblin' }),
]);
const CAPTURE_SOURCE_ROOTS = Object.freeze(['apps/cli/src/observe', 'packages/render-core/src']);
const CAPTURE_SOURCE_FILES = Object.freeze([
  'packages/render-core/package.json',
  'apps/cli/package.json',
  'scripts/showcase/capture.js',
]);
const GIF_LIMIT = 8 * 1024 * 1024;
const GIF_AGGREGATE_LIMIT = 16 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const CREATED_AT = '2026-01-01T00:00:00.000Z';

const fail = (message) => {
  throw new Error(`showcase: ${message}`);
};

const sha256 = (bytes) => `sha256:${sha256Hex(bytes)}`;

const relativePath = (file) => path.relative(ROOT, file).split(path.sep).join('/');

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
    ...CAPTURE_SOURCE_ROOTS.flatMap((root) => walkCaptureSources(path.join(ROOT, root))),
    ...CAPTURE_SOURCE_FILES.map((file) => path.join(ROOT, file)),
  ].sort((left, right) => compareText(relativePath(left), relativePath(right)));
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

const paethPredictor = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
};

const filterPredictor = (filter, a, b, c) => {
  if (filter === 1) return a;
  if (filter === 2) return b;
  if (filter === 3) return (a + b) >> 1;
  if (filter === 4) return paethPredictor(a, b, c);
  return 0;
};

const unfilterPngRows = (raw, width, height, bpp) => {
  const rowBytes = width * bpp;
  if (raw.length < height * (rowBytes + 1)) fail('truncated PNG scanlines');
  const out = new Uint8Array(height * rowBytes);
  for (let y = 0; y < height; y += 1) {
    const inBase = y * (rowBytes + 1);
    const filter = raw[inBase];
    const outBase = y * rowBytes;
    const hasPrev = y > 0;
    for (let x = 0; x < rowBytes; x += 1) {
      const a = x >= bpp ? out[outBase + x - bpp] : 0;
      const b = hasPrev ? out[outBase - rowBytes + x] : 0;
      const c = x >= bpp && hasPrev ? out[outBase - rowBytes + x - bpp] : 0;
      out[outBase + x] = (raw[inBase + 1 + x] + filterPredictor(filter, a, b, c)) & 0xff;
    }
  }
  return out;
};

const pngChannelBytes = (colorType) => {
  if (colorType === 6) return 4;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 0 || colorType === 3) return 1;
  return 0;
};

const writeRgbaPixel = (rgba, dst, buf, src, colorType, plte, trns) => {
  if (colorType === 6) {
    rgba[dst] = buf[src];
    rgba[dst + 1] = buf[src + 1];
    rgba[dst + 2] = buf[src + 2];
    rgba[dst + 3] = buf[src + 3];
    return;
  }
  if (colorType === 2) {
    rgba[dst] = buf[src];
    rgba[dst + 1] = buf[src + 1];
    rgba[dst + 2] = buf[src + 2];
    rgba[dst + 3] = 255;
    return;
  }
  if (colorType === 3 && plte) {
    const idx = buf[src];
    rgba[dst] = plte[idx * 3] ?? 0;
    rgba[dst + 1] = plte[idx * 3 + 1] ?? 0;
    rgba[dst + 2] = plte[idx * 3 + 2] ?? 0;
    rgba[dst + 3] = trns && idx < trns.length ? trns[idx] : 255;
    return;
  }
  rgba[dst] = buf[src];
  rgba[dst + 1] = buf[src];
  rgba[dst + 2] = buf[src];
  rgba[dst + 3] = colorType === 4 ? buf[src + 1] : 255;
};

const decodePngRgba = (bytes, name) => {
  const header = inspectPng(bytes, name);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const bpp = pngChannelBytes(colorType);
  if (bitDepth !== 8 || bpp === 0) {
    fail(`${name} uses unsupported PNG format (${bitDepth}bit, colorType=${colorType})`);
  }
  let offset = 8;
  let plte = null;
  let trns = null;
  const idat = [];
  while (offset + 12 <= bytes.length) {
    const len = bytes.readUInt32BE(offset);
    const kind = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const payload = bytes.subarray(offset + 8, offset + 8 + len);
    if (kind === 'PLTE') plte = payload;
    else if (kind === 'tRNS') trns = payload;
    else if (kind === 'IDAT') idat.push(payload);
    else if (kind === 'IEND') break;
    offset += 12 + len;
  }
  const raw = unzlibSync(Buffer.concat(idat));
  const scanlines = unfilterPngRows(raw, header.width, header.height, bpp);
  const rgba = new Uint8Array(header.width * header.height * 4);
  const total = header.width * header.height;
  for (let i = 0; i < total; i += 1) {
    writeRgbaPixel(rgba, i * 4, scanlines, i * bpp, colorType, plte, trns);
  }
  return { width: header.width, height: header.height, rgba };
};

const sampleCornerBackdrop = (rgba, width, height) => {
  const indices = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const idx of indices) {
    r += rgba[idx];
    g += rgba[idx + 1];
    b += rgba[idx + 2];
    a += rgba[idx + 3];
  }
  return [r * 0.25, g * 0.25, b * 0.25, a * 0.25];
};

const sobelDetailEnergy = (luma, width, height) => {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const gx =
        -luma[i - width - 1] -
        2 * luma[i - 1] -
        luma[i + width - 1] +
        luma[i - width + 1] +
        2 * luma[i + 1] +
        luma[i + width + 1];
      const gy =
        -luma[i - width - 1] -
        2 * luma[i - width] -
        luma[i - width + 1] +
        luma[i + width - 1] +
        2 * luma[i + width] +
        luma[i + width + 1];
      sum += Math.hypot(gx, gy);
    }
  }
  return Number((sum / ((width - 2) * (height - 2))).toFixed(4));
};

const measurePosterMetrics = (pngBytes, posterName) => {
  const { width, height, rgba } = decodePngRgba(pngBytes, posterName);
  const bg = sampleCornerBackdrop(rgba, width, height);
  const transparentBg = bg[3] < 16;
  const total = width * height;
  const luma = new Float32Array(total);
  let fg = 0;
  for (let i = 0; i < total; i += 1) {
    const p = i * 4;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const a = rgba[p + 3];
    luma[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const isFg = transparentBg
      ? a > 16
      : Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) + Math.abs(a - bg[3]) > 16;
    if (isFg) fg += 1;
  }
  return {
    width,
    height,
    detailEnergy: sobelDetailEnergy(luma, width, height),
    foregroundRatio: Number((fg / total).toFixed(4)),
  };
};

const loadCommittedFloors = () => {
  if (!fs.existsSync(DESCRIPTOR_PATH)) return new Map();
  try {
    const parsed = JSON.parse(fs.readFileSync(DESCRIPTOR_PATH, 'utf8'));
    const floors = new Map();
    for (const entry of parsed.entries ?? []) {
      if (typeof entry?.entryName === 'string') floors.set(entry.entryName, entry);
    }
    return floors;
  } catch {
    return new Map();
  }
};

const assertVisualMetricsFloor = (entryName, metrics, floors) => {
  if (metrics.foregroundRatio < 0.02) {
    fail(`${entryName} silhouette collapsed (foregroundRatio=${metrics.foregroundRatio})`);
  }
  if (metrics.detailEnergy < 0.005) {
    fail(`${entryName} detail energy collapsed (detailEnergy=${metrics.detailEnergy})`);
  }
  const prev = floors.get(entryName);
  if (typeof prev?.detailEnergy === 'number' && metrics.detailEnergy < prev.detailEnergy * 0.8) {
    fail(
      `${entryName} detailEnergy ${metrics.detailEnergy} dropped > 20% below floor ${prev.detailEnergy}`,
    );
  }
  if (
    typeof prev?.foregroundRatio === 'number' &&
    metrics.foregroundRatio < prev.foregroundRatio * 0.5
  ) {
    fail(
      `${entryName} silhouette collapsed: foregroundRatio=${metrics.foregroundRatio} vs floor=${prev.foregroundRatio}`,
    );
  }
};

const inspectPng = (bytes, name) => {
  if (
    bytes.length < 33 ||
    !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    fail(`${name} is not a valid PNG header`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

const selectorKey = (selector) => `${selector.packageName}/${selector.entryName}`;

const assertExactSelectors = (workspace) => {
  const selectors = workspace.manifest.packages.flatMap((pkg) =>
    pkg.manifest.entries.map((entry) => ({
      packageName: pkg.name,
      entryName: entry.name,
    })),
  );
  const keys = selectors.map(selectorKey);
  if (new Set(keys).size !== keys.length) fail('workspace has duplicate entries');
  const expected = EXPECTED_SELECTORS.map(selectorKey);
  if (keys.length !== expected.length || expected.some((key) => !keys.includes(key))) {
    fail(`workspace entries must be exactly ${expected.join(', ')}`);
  }
};

const openProject = (workspace, selector) => {
  const opened = openAssetProject({
    workspace,
    entry: { packageName: selector.packageName, entryName: selector.entryName },
    identity: {
      id: `showcase-${selector.entryName}`,
      revision: 'showcase-0001',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
  });
  if (!opened.ok) {
    fail(
      `${selectorKey(selector)} cannot compile: ` +
        (opened.diagnostics[0]?.message ?? 'unknown diagnostic'),
    );
  }
  return opened.project;
};

const assertMediaInventory = (workspace) => {
  const expected = new Set(
    EXPECTED_SELECTORS.flatMap(({ entryName, slug }) => [
      `${slug}-build-replay.gif`,
      `${slug}-build-replay.mp4`,
      `${slug}-poster.png`,
      ...Object.values(
        openProject(
          workspace,
          EXPECTED_SELECTORS.find((selector) => selector.entryName === entryName),
        ).document.animations,
      ).map((clip) => `${slug}-${clip.name}.mp4`),
    ]),
  );
  const actual = fs
    .readdirSync(SHOWCASE_PATH, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(?:gif|png|mp4)$/iu.test(entry.name))
    .map((entry) => entry.name);
  const orphan = actual.find((name) => !expected.has(name));
  if (orphan) fail(`orphan media file: ${orphan}`);
  const missing = [...expected].find((name) => !actual.includes(name));
  if (missing) fail(`missing media file: ${missing}`);
};

const readValidatedWorkspace = () => {
  if (GIF_CAPTURE_WIDTH !== 640 || GIF_CAPTURE_HEIGHT !== 360 || BUILD_CAPTURE_FPS !== 10) {
    fail('capture contract must remain 640x360 at 10 fps');
  }
  const workspaceBytes = requireBytes(WORKSPACE_PATH, 'canonical workspace');
  const read = readWorkspaceFile(workspaceBytes);
  if (!read.ok) {
    fail(`workspace is invalid: ${read.diagnostics[0]?.message ?? 'unknown diagnostic'}`);
  }
  const written = writeWorkspaceFile(read.workspace);
  if (!written.ok || !Buffer.from(written.source, 'utf8').equals(workspaceBytes)) {
    fail('workspace bytes are not canonical');
  }
  assertExactSelectors(read.workspace);
  assertMediaInventory(read.workspace);
  return { workspace: read.workspace, workspaceBytes };
};

const buildMotionDescriptors = (selector, animations) =>
  Object.values(animations).map((clip) => {
    const file = `${selector.slug}-${clip.name}.mp4`;
    const bytes = requireBytes(path.join(SHOWCASE_PATH, file), 'motion movie');
    if (bytes.subarray(4, 8).toString('ascii') !== 'ftyp' || bytes.length > 2 * 1024 * 1024) {
      fail(`Invalid or oversized movie: ${file}`);
    }
    return {
      name: clip.name,
      duration: clip.durationSeconds,
      artifact: file,
      sha256: sha256(bytes),
      byteLength: bytes.length,
    };
  });

const buildEntryDescriptor = (workspace, selector, floors) => {
  const project = openProject(workspace, selector);
  const plan = createBuildCapturePlan(project.document);
  const artifact = `${selector.slug}-build-replay.gif`;
  const poster = `${selector.slug}-poster.png`;
  const videoFile = `${selector.slug}-build-replay.mp4`;
  const videoBytes = requireBytes(path.join(SHOWCASE_PATH, videoFile), 'build movie');
  if (
    videoBytes.subarray(4, 8).toString('ascii') !== 'ftyp' ||
    videoBytes.length > 2 * 1024 * 1024
  ) {
    fail(`Invalid build movie: ${videoFile}`);
  }
  const gifBytes = requireBytes(path.join(SHOWCASE_PATH, artifact), 'GIF');
  const pngBytes = requireBytes(path.join(SHOWCASE_PATH, poster), 'poster');
  if (gifBytes.byteLength > GIF_LIMIT) fail(`${artifact} exceeds 8 MiB`);
  const gif = inspectGif(gifBytes, artifact);
  const png = measurePosterMetrics(pngBytes, poster);
  if (
    gif.width !== GIF_CAPTURE_WIDTH ||
    gif.height !== GIF_CAPTURE_HEIGHT ||
    png.width !== GIF_CAPTURE_WIDTH ||
    png.height !== GIF_CAPTURE_HEIGHT
  ) {
    fail(`${selector.entryName} media must be 640x360`);
  }
  if (gif.frameCount !== plan.frames.length) {
    fail(`${artifact} has ${gif.frameCount} frames, expected ${plan.frames.length}`);
  }
  assertVisualMetricsFloor(selector.entryName, png, floors);
  return {
    video: { artifact: videoFile, sha256: sha256(videoBytes), byteLength: videoBytes.length },
    motions: buildMotionDescriptors(selector, project.document.animations),
    packageName: selector.packageName,
    entryName: selector.entryName,
    closureHash: project.build.closureHash,
    buildKey: project.build.buildKey,
    productHash: project.build.productHash,
    artifact,
    poster,
    artifactSha256: sha256(gifBytes),
    posterSha256: sha256(pngBytes),
    detailEnergy: png.detailEnergy,
    foregroundRatio: png.foregroundRatio,
    byteLength: gifBytes.byteLength,
    frameCount: plan.frames.length,
    eventCount: plan.events.length,
  };
};

const createDescriptor = () => {
  const floors = loadCommittedFloors();
  const { workspace, workspaceBytes } = readValidatedWorkspace();
  const entries = EXPECTED_SELECTORS.map((selector) =>
    buildEntryDescriptor(workspace, selector, floors),
  );
  const aggregateGifBytes = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
  if (aggregateGifBytes > GIF_AGGREGATE_LIMIT) {
    fail('GIF replay set exceeds 16 MiB');
  }

  return {
    format: 'ashfox-showcase',
    version: 1,
    workspace: {
      path: WORKSPACE_RELATIVE_PATH,
      sha256: sha256(workspaceBytes),
      workspaceHash: openProject(workspace, EXPECTED_SELECTORS[0]).build.workspaceHash,
    },
    capture: {
      fingerprint: captureFingerprint(),
      environment: 'studio',
      camera: 'perspective',
      width: GIF_CAPTURE_WIDTH,
      height: GIF_CAPTURE_HEIGHT,
      fps: BUILD_CAPTURE_FPS,
    },
    entries,
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

const DIVIDER_PX = 6;

const fillBackdrop = (rgba, width, height) => {
  for (let i = 0; i < width * height; i += 1) {
    const p = i * 4;
    rgba[p] = 14;
    rgba[p + 1] = 17;
    rgba[p + 2] = 22;
    rgba[p + 3] = 255;
  }
};

const blitImage = (dst, dstW, src, dx, dy) => {
  for (let y = 0; y < src.height; y += 1) {
    const srcStart = y * src.width * 4;
    const dstStart = ((dy + y) * dstW + dx) * 4;
    dst.set(src.rgba.subarray(srcStart, srcStart + src.width * 4), dstStart);
  }
};

const stitchSideBySideRow = (images) => {
  const width = images.reduce((sum, img) => sum + img.width, 0) + DIVIDER_PX * (images.length - 1);
  const height = Math.max(...images.map((img) => img.height));
  const rgba = new Uint8Array(width * height * 4);
  fillBackdrop(rgba, width, height);
  let x = 0;
  for (const img of images) {
    blitImage(rgba, width, img, x, 0);
    x += img.width + DIVIDER_PX;
  }
  return { width, height, rgba };
};

const stitchContactSheet = (rows) => {
  const width = Math.max(...rows.map((row) => row.width));
  const height = rows.reduce((sum, row) => sum + row.height, 0) + DIVIDER_PX * (rows.length - 1);
  const rgba = new Uint8Array(width * height * 4);
  fillBackdrop(rgba, width, height);
  let y = 0;
  for (const row of rows) {
    blitImage(rgba, width, row, 0, y);
    y += row.height + DIVIDER_PX;
  }
  return { width, height, rgba };
};

const runCompare = (args) => {
  if (args.length < 2) {
    fail('usage: node scripts/showcase/verify.js --compare <beforeDir> [<midDir> ...] <outDir>');
  }
  const outDir = path.resolve(args[args.length - 1]);
  const rawDirs = args.slice(0, -1).map((dir) => path.resolve(dir));
  const sourceDirs = rawDirs.length === 1 ? [rawDirs[0], SHOWCASE_PATH] : rawDirs;
  fs.mkdirSync(outDir, { recursive: true });
  const rows = [];
  for (const selector of EXPECTED_SELECTORS) {
    const poster = `${selector.slug}-poster.png`;
    const panels = sourceDirs.map((dir) => {
      const target = path.join(dir, poster);
      return decodePngRgba(requireBytes(target, `compare poster ${target}`), poster);
    });
    const row = stitchSideBySideRow(panels);
    rows.push(row);
    const outFile = path.join(outDir, `${selector.slug}-compare.png`);
    fs.writeFileSync(outFile, encodeRgbaBufferPng(row.rgba, row.width, row.height));
  }
  const sheet = stitchContactSheet(rows);
  const sheetPath = path.join(outDir, 'comparison-sheet.png');
  fs.writeFileSync(sheetPath, encodeRgbaBufferPng(sheet.rgba, sheet.width, sheet.height));
  console.log(`showcase comparison written (${sourceDirs.length}-way): ${relativePath(outDir)}`);
};

const main = () => {
  const argv = process.argv.slice(2);
  if (argv[0] === '--compare') {
    runCompare(argv.slice(1));
    return;
  }
  const unexpected = argv.filter((argument) => argument !== '--write');
  if (unexpected.length > 0 || argv.filter((argument) => argument === '--write').length > 1) {
    fail(
      'usage: node scripts/showcase/verify.js [--write] | --compare <beforeDir> [<midDir> ...] <outDir>',
    );
  }
  const source = `${JSON.stringify(createDescriptor(), null, 2)}\n`;
  if (argv.includes('--write')) {
    atomicWrite(DESCRIPTOR_PATH, source);
    console.log(`showcase descriptor sealed: ${relativePath(DESCRIPTOR_PATH)}`);
    return;
  }
  const current = requireBytes(DESCRIPTOR_PATH, 'descriptor');
  if (!current.equals(Buffer.from(source, 'utf8'))) {
    fail('descriptor is stale; run node scripts/showcase/verify.js --write');
  }
  console.log(`showcase descriptor current: ${EXPECTED_SELECTORS.length} entries`);
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  assertVisualMetricsFloor,
  decodePngRgba,
  measurePosterMetrics,
});
