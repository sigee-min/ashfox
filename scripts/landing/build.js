'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const { ASSET_CATALOG } = require('./catalog.js');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'dist/landing');
const thumbsSourceDir = path.join(root, 'assets/catalog/thumbs');
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');

const GLB_DOMAINS = new Set(['model', 'structure', 'vfx']);
const PEAK_BAR_COUNT = 96;

const buildTarget = (temp, rel) =>
  JSON.parse(
    execFileSync(process.execPath, [cli, 'build', path.join(temp, rel), '--json'], {
      cwd: temp,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    }),
  ).result;

const formatByteSize = (byteLength) => {
  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(byteLength / 1024))} KB`;
};

const parseGlbContainer = (bytes) => {
  if (bytes.length < 20 || bytes.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error('Invalid GLB container');
  }
  const jsonLength = bytes.readUInt32LE(12);
  const chunkType = bytes.readUInt32LE(16);
  if (chunkType !== 0x4e4f534a) {
    throw new Error('GLB missing JSON chunk');
  }
  return JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
};

const nodeLodTier = (name) => {
  if (!name) return null;
  if (/_lod1$/i.test(name)) return 1;
  if (/_lod2$/i.test(name)) return 2;
  return /_lod0$/i.test(name) ? 0 : null;
};

const primitiveCounts = (prim, accessors) => {
  const mode = prim.mode ?? 4;
  const posIdx = prim.attributes?.POSITION;
  const verts = posIdx !== undefined ? (accessors[posIdx]?.count ?? 0) : 0;
  const idxOrPos = prim.indices ?? posIdx;
  const count = idxOrPos !== undefined ? (accessors[idxOrPos]?.count ?? 0) : 0;
  let tris = 0;
  if (mode === 4) tris = Math.floor(count / 3);
  else if (mode === 5 || mode === 6) tris = Math.max(0, count - 2);
  return { tris, verts };
};

const nodeInstances = (node, accessors) => {
  const attrs = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (!attrs) return 1;
  const firstIdx = attrs.TRANSLATION ?? Object.values(attrs)[0];
  return firstIdx !== undefined ? Math.max(1, accessors[firstIdx]?.count ?? 1) : 1;
};

const inspectGlbMeta = (bytes) => {
  const gltf = parseGlbContainer(bytes);
  const nodes = gltf.nodes ?? [];
  const meshes = gltf.meshes ?? [];
  const accessors = gltf.accessors ?? [];
  const clips = (gltf.animations ?? []).map((clip) => clip.name).filter(Boolean);

  const explicitTiers = new Map();
  nodes.forEach((node, idx) => {
    const tier = nodeLodTier(node.name);
    if (tier !== null) explicitTiers.set(idx, tier);
    const lodIds = node.extensions?.MSFT_lod?.ids;
    if (!lodIds) return;
    if (!explicitTiers.has(idx)) explicitTiers.set(idx, 0);
    lodIds.forEach((targetIdx, pos) => {
      if (!explicitTiers.has(targetIdx)) explicitTiers.set(targetIdx, pos === 0 ? 1 : 2);
    });
  });

  const visited = new Set();
  const trianglesByTier = [0, 0, 0];
  const verticesByTier = [0, 0, 0];
  const hasTier = [false, false, false];

  const visit = (idx, inheritedTier) => {
    if (visited.has(idx)) return;
    const node = nodes[idx];
    if (!node) return;
    visited.add(idx);
    const tier = explicitTiers.get(idx) ?? inheritedTier;
    if (explicitTiers.has(idx)) hasTier[tier] = true;
    if (node.mesh !== undefined) {
      const prims = meshes[node.mesh]?.primitives ?? [];
      const instances = nodeInstances(node, accessors);
      for (const prim of prims) {
        const { tris, verts } = primitiveCounts(prim, accessors);
        trianglesByTier[tier] += tris * instances;
        verticesByTier[tier] += verts * instances;
      }
    }
    for (const child of node.children ?? []) visit(child, tier);
    for (const lodIdx of node.extensions?.MSFT_lod?.ids ?? []) visit(lodIdx, tier);
  };

  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, idx) => idx);
  for (const rootIdx of roots) visit(rootIdx, explicitTiers.get(rootIdx) ?? 0);
  nodes.forEach((_, idx) => {
    if (!visited.has(idx) && explicitTiers.has(idx)) visit(idx, explicitTiers.get(idx));
  });

  const lods = [0, 1, 2].filter((tier) => hasTier[tier]).map((tier) => `LOD${tier}`);
  return {
    triangles: trianglesByTier[0],
    vertices: verticesByTier[0],
    lods,
    clips,
    byteLength: bytes.byteLength,
  };
};

const parsePngDimensions = (bytes) => {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error('Invalid PNG header');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

const parseWavInfo = (wav) => {
  if (wav.length < 44 || wav.subarray(0, 4).toString('ascii') !== 'RIFF') {
    throw new Error('Invalid WAV header');
  }
  let channels = 2;
  let sampleRate = 48000;
  let bitsPerSample = 16;
  let dataOffset = 44;
  let dataSize = Math.max(0, wav.length - 44);
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const chunkId = wav.subarray(offset, offset + 4).toString('ascii');
    const chunkSize = wav.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunkId === 'fmt ' && body + 16 <= wav.length) {
      channels = Math.max(1, wav.readUInt16LE(body + 2));
      sampleRate = Math.max(1, wav.readUInt32LE(body + 4));
      bitsPerSample = Math.max(8, wav.readUInt16LE(body + 14));
    } else if (chunkId === 'data') {
      dataOffset = body;
      dataSize = Math.min(chunkSize, Math.max(0, wav.length - body));
      break;
    }
    offset = body + chunkSize + (chunkSize % 2);
  }
  const bytesPerSample = Math.max(1, Math.floor(bitsPerSample / 8));
  const frameSize = bytesPerSample * channels;
  const frames = Math.floor(dataSize / frameSize);
  const durationSec = Number((frames / sampleRate).toFixed(2));
  const peaks = Array.from({ length: PEAK_BAR_COUNT }, (_, i) => {
    const start = Math.floor((i * frames) / PEAK_BAR_COUNT);
    const end = Math.max(start + 1, Math.floor(((i + 1) * frames) / PEAK_BAR_COUNT));
    let peak = 0;
    for (let f = start; f < end; f += 1) {
      for (let ch = 0; ch < channels; ch += 1) {
        const sampleOffset = dataOffset + f * frameSize + ch * bytesPerSample;
        if (sampleOffset + 2 <= wav.length) {
          peak = Math.max(peak, Math.abs(wav.readInt16LE(sampleOffset)) / 32768);
        }
      }
    }
    return Number(Math.min(1, peak).toFixed(3));
  });
  return { channels, sampleRate, durationSec, peaks, byteLength: wav.byteLength };
};

const hashDigest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12);

const withVersion = (href, bytes) => `${href}?v=${hashDigest(bytes)}`;

const writeWaveSvg = (peaks, svgName, color) => {
  const maximum = Math.max(...peaks, 1e-8);
  const bars = peaks
    .map((peak, i) => {
      const height = Math.max(3, (peak / maximum) * 128);
      return `<rect x="${i * 5}" y="${(80 - height / 2).toFixed(1)}" width="3" height="${height.toFixed(1)}" rx="1.5" fill="${color}"/>`;
    })
    .join('');
  const svgBytes = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PEAK_BAR_COUNT * 5} 160">${bars}</svg>`,
  );
  fs.writeFileSync(path.join(out, svgName), svgBytes);
  return svgBytes;
};

const formatGlbSpecs = (entry, meta) => {
  const trisEn = meta.triangles.toLocaleString('en-US');
  const trisKo = meta.triangles.toLocaleString('ko-KR');
  const size = formatByteSize(meta.byteLength);
  if (entry.domain === 'structure') {
    return {
      en: `Structure · ${trisEn} tris · ${size}`,
      ko: `구조물 · ${trisKo} 트라이앵글 · ${size}`,
    };
  }
  if (entry.domain === 'vfx') {
    const animEn = meta.clips.length > 0 ? 'animated' : 'static';
    const animKo = meta.clips.length > 0 ? '애니메이션' : '정적';
    return {
      en: `VFX · ${trisEn} tris · ${animEn} · ${size}`,
      ko: `VFX · ${trisKo} 트라이앵글 · ${animKo} · ${size}`,
    };
  }
  const clipCount = meta.clips.length;
  return {
    en:
      clipCount > 0
        ? `GLB · ${trisEn} tris · ${clipCount} clips · ${size}`
        : `GLB · ${trisEn} tris · static prop · ${size}`,
    ko:
      clipCount > 0
        ? `GLB · ${trisKo} 트라이앵글 · ${clipCount}개 동작 · ${size}`
        : `GLB · ${trisKo} 트라이앵글 · 스태틱 프롭 · ${size}`,
  };
};

const formatPngSpecs = (entry, meta) => {
  const dims = `${meta.width}x${meta.height} PNG`;
  if (entry.domain === 'tile') {
    return { en: `${dims} · 3x3 seamless`, ko: `${dims} · 3x3 심리스 타일` };
  }
  if (meta.spriteProfile === 'ui_9slice' && meta.nineSlice) {
    const inset = meta.nineSlice.top ?? 6;
    return { en: `${dims} · 9-slice (${inset}px)`, ko: `${dims} · 9-슬라이스 (${inset}px)` };
  }
  if (meta.spriteProfile === 'crosshair') {
    return { en: `${dims} · crosshair reticle`, ko: `${dims} · 조준선 레티클` };
  }
  return { en: `${dims} · OKLCH · sel-out`, ko: `${dims} · OKLCH · sel-out` };
};

const formatSoundSpecs = (meta) => {
  const rateKhz = `${Math.round(meta.sampleRate / 1000)}kHz`;
  const chEn = meta.channels === 2 ? 'Stereo' : 'Mono';
  const chKo = meta.channels === 2 ? '스테레오' : '모노';
  const loopEn = meta.loop ? ' · loop' : '';
  const loopKo = meta.loop ? ' · 루프' : '';
  return {
    en: `${rateKhz} ${chEn} WAV · ${meta.durationSec.toFixed(2)}s${loopEn}`,
    ko: `${rateKhz} ${chKo} WAV · ${meta.durationSec.toFixed(2)}초${loopKo}`,
  };
};

const compileAllAssets = (temp) => {
  fs.cpSync(path.join(root, 'showcase'), path.join(temp, 'showcase'), { recursive: true });
  const built = buildTarget(temp, 'showcase/.ashfoxworkspace');
  const byId = new Map(built.exports.map((exp) => [exp.id, exp.directory]));
  const compiled = new Map();
  for (const entry of ASSET_CATALOG) {
    const expId = entry.exportId || entry.id;
    const dir = byId.get(expId);
    if (!dir) throw new Error(`Missing showcase export ${expId} for ${entry.id}`);
    if (GLB_DOMAINS.has(entry.domain)) {
      compiled.set(entry.id, { bytes: fs.readFileSync(path.join(dir, `${expId}.glb`)) });
    } else if (entry.domain === 'sprite' || entry.domain === 'tile') {
      const spriteJsonPath = path.join(dir, `${expId}.sprite.json`);
      const spriteJson = fs.existsSync(spriteJsonPath)
        ? JSON.parse(fs.readFileSync(spriteJsonPath, 'utf8'))
        : null;
      compiled.set(entry.id, {
        bytes: fs.readFileSync(path.join(dir, `${expId}.png`)),
        spriteJson,
      });
    } else if (entry.domain === 'sound') {
      const altPath = path.join(dir, expId, 'alternate.wav');
      compiled.set(entry.id, {
        bytes: fs.readFileSync(path.join(dir, expId, 'base.wav')),
        altBytes: fs.existsSync(altPath) ? fs.readFileSync(altPath) : null,
      });
    }
  }
  return compiled;
};

const copyThumbnails = () => {
  const thumbOut = path.join(out, 'thumbs');
  fs.mkdirSync(thumbOut, { recursive: true });
  for (const entry of ASSET_CATALOG) {
    if (!GLB_DOMAINS.has(entry.domain)) continue;
    const filename = `${entry.slug}.png`;
    const src = path.join(thumbsSourceDir, filename);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing studio thumbnail ${src} for ${entry.id}. Run thumbs.js first.`);
    }
    fs.copyFileSync(src, path.join(thumbOut, filename));
  }
};

const buildEntryRecord = (entry, compiled) => {
  const asset = compiled.get(entry.id);
  if (!asset) throw new Error(`Missing built landing asset for ${entry.id}`);
  fs.writeFileSync(path.join(out, entry.outputFile), asset.bytes);

  let meta;
  let specs;
  let peaks;
  const outputHref = withVersion(entry.outputHref, asset.bytes);
  let thumbHref = withVersion(entry.thumbHref, asset.bytes);
  let previewHref = thumbHref;
  let alternateHref = null;
  let alternateWaveHref = null;

  if (GLB_DOMAINS.has(entry.domain)) {
    meta = inspectGlbMeta(asset.bytes);
    specs = formatGlbSpecs(entry, meta);
    const thumbBytes = fs.readFileSync(path.join(thumbsSourceDir, `${entry.slug}.png`));
    thumbHref = withVersion(entry.thumbHref, thumbBytes);
    previewHref = thumbHref;
  } else if (entry.domain === 'sound') {
    const wav = parseWavInfo(asset.bytes);
    peaks = wav.peaks;
    const waveBytes = writeWaveSvg(peaks, entry.waveFile, '#e69a43');
    thumbHref = withVersion(entry.thumbHref, waveBytes);
    previewHref = withVersion(`/media/catalog/${entry.waveFile}`, waveBytes);
    const hasAlternate = Boolean(entry.alternateFile && asset.altBytes);
    if (hasAlternate) {
      fs.writeFileSync(path.join(out, entry.alternateFile), asset.altBytes);
      const altWav = parseWavInfo(asset.altBytes);
      const altWaveBytes = writeWaveSvg(altWav.peaks, entry.alternateWaveFile, '#e69a43');
      alternateHref = withVersion(`/media/catalog/${entry.alternateFile}`, asset.altBytes);
      alternateWaveHref = withVersion(`/media/catalog/${entry.alternateWaveFile}`, altWaveBytes);
    }
    meta = {
      durationSec: wav.durationSec,
      sampleRate: wav.sampleRate,
      channels: wav.channels,
      loop: Boolean(entry.loop),
      hasAlternate,
      byteLength: wav.byteLength,
    };
    specs = formatSoundSpecs(meta);
  } else {
    const dims = parsePngDimensions(asset.bytes);
    meta = {
      width: dims.width,
      height: dims.height,
      spriteProfile: entry.spriteProfile || entry.domain,
      nineSlice: asset.spriteJson?.nineSlice ?? null,
      byteLength: asset.bytes.byteLength,
    };
    specs = formatPngSpecs(entry, meta);
  }

  return {
    id: entry.id,
    slug: entry.slug,
    exportId: entry.exportId,
    domain: entry.domain,
    genre: entry.genre,
    category: entry.category,
    featured: entry.featured,
    name: entry.name,
    summary: entry.summary,
    specs,
    meta,
    ...(peaks ? { peaks } : {}),
    sourcePath: entry.sourcePath,
    sourceHref: entry.sourceHref,
    outputHref,
    thumbHref,
    previewHref,
    alternateHref,
    alternateWaveHref,
    motions: meta.clips ?? entry.motions,
    tags: entry.tags,
  };
};

const bundleScript = (entryFile, outfile) => {
  if (!fs.existsSync(entryFile)) return false;
  buildSync({
    entryPoints: [entryFile],
    outfile,
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
  return true;
};

const main = () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  copyThumbnails();

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-landing-'));
  let compiled;
  try {
    compiled = compileAllAssets(temp);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const catalog = ASSET_CATALOG.map((entry) => buildEntryRecord(entry, compiled));
  fs.copyFileSync(path.join(out, 'iron-sword.png'), path.join(out, 'sword.png'));
  fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2));

  bundleScript(path.join(root, 'scripts/landing/viewer.js'), path.join(out, 'viewer.js'));
  bundleScript(path.join(root, 'apps/site/src/studio/index.js'), path.join(out, 'studio.js'));
  console.log(`Built landing catalog (${catalog.length} assets) -> ${out}`);
};

main();
