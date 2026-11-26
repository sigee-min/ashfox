'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildSync } = require('esbuild');
const { ASSET_CATALOG } = require('./catalog.js');

const root = path.resolve(__dirname, '../..');
const out = path.join(root, 'dist/landing');
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');

const buildTarget = (temp, rel) =>
  JSON.parse(
    execFileSync(process.execPath, [cli, 'build', path.join(temp, rel), '--json'], {
      cwd: temp,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    }),
  ).result;

const readWavPeakBins = (wav) => {
  const channels = Math.max(1, wav.readUInt16LE(22));
  const dataOffset = 44;
  const frames = Math.floor((wav.length - dataOffset) / (2 * channels));
  return Array.from({ length: 120 }, (_, i) => {
    const start = Math.floor((i * frames) / 120);
    const end = Math.max(start + 1, Math.floor(((i + 1) * frames) / 120));
    let peak = 0;
    for (let f = start; f < end; f += 1) {
      for (let ch = 0; ch < channels; ch += 1) {
        const offset = dataOffset + (f * channels + ch) * 2;
        if (offset + 2 <= wav.length) {
          peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)) / 32768);
        }
      }
    }
    return peak;
  });
};

const readWavDurationSec = (wav) => {
  const sampleRate = Math.max(1, wav.readUInt32LE(24));
  const channels = Math.max(1, wav.readUInt16LE(22));
  const frames = Math.floor((wav.length - 44) / (2 * channels));
  return Number((frames / sampleRate).toFixed(2));
};

const writeWaveSvg = (wavBytes, svgName, color) => {
  const peaks = readWavPeakBins(wavBytes);
  const maximum = Math.max(...peaks, 1e-8);
  const bars = peaks
    .map((peak, i) => {
      const height = Math.max(3, (peak / maximum) * 128);
      return `<rect x="${i * 4}" y="${80 - height / 2}" width="2" height="${height}" rx="1" fill="${color}"/>`;
    })
    .join('');
  fs.writeFileSync(
    path.join(out, svgName),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 160">${bars}</svg>`,
  );
};

const formatModelSpecs = (entry, bytes) => {
  const kb = Math.max(1, Math.round(bytes.byteLength / 1024));
  const clipCount = entry.motions.length;
  return {
    en: clipCount > 0 ? `GLB · ${clipCount} clips · ${kb} KB` : `GLB · static prop · ${kb} KB`,
    ko: clipCount > 0 ? `GLB · ${clipCount}개 동작 · ${kb} KB` : `GLB · 스태틱 프롭 · ${kb} KB`,
  };
};

const formatSoundSpecs = (durationSec) => ({
  en: `48kHz Stereo WAV · ${durationSec.toFixed(2)}s`,
  ko: `48kHz 스테레오 WAV · ${durationSec.toFixed(2)}초`,
});

const compileAllAssets = (temp) => {
  for (const dir of ['griffin', 'fox', 'goblin', 'prop', 'items', 'sounds']) {
    fs.cpSync(path.join(root, 'examples', dir), path.join(temp, dir), { recursive: true });
  }
  const builtFiles = new Map();
  const modelMap = [
    ['griffin', 'griffin/workbench/main.ashfox', 'griffin.glb'],
    ['fox', 'fox/creatures/fox.ashfox', 'fox.glb'],
    ['goblin', 'goblin/creatures/goblin.ashfox', 'goblin.glb'],
    ['lantern', 'prop/lantern.ashfox', 'lantern.glb'],
  ];
  for (const [id, rel, file] of modelMap) {
    const built = buildTarget(temp, rel);
    builtFiles.set(id, fs.readFileSync(path.join(built.exports[0].directory, file)));
  }
  const itemsBuilt = buildTarget(temp, 'items/.ashfoxworkspace');
  for (const exp of itemsBuilt.exports) {
    builtFiles.set(exp.id, fs.readFileSync(path.join(exp.directory, `${exp.id}.png`)));
  }
  const soundsBuilt = buildTarget(temp, 'sounds/.ashfoxworkspace');
  for (const exp of soundsBuilt.exports) {
    builtFiles.set(exp.id, fs.readFileSync(path.join(exp.directory, exp.id, 'base.wav')));
    const altPath = path.join(exp.directory, exp.id, 'alternate.wav');
    if (fs.existsSync(altPath)) builtFiles.set(`${exp.id}:alternate`, fs.readFileSync(altPath));
  }
  return builtFiles;
};

const buildEntryRecord = (entry, builtFiles) => {
  const bytes = builtFiles.get(entry.id);
  if (!bytes) throw new Error(`Missing built landing asset for ${entry.id}`);
  fs.writeFileSync(path.join(out, entry.outputFile), bytes);
  if (entry.alternateFile) {
    const altBytes = builtFiles.get(`${entry.id}:alternate`);
    if (!altBytes) throw new Error(`Missing alternate variant for ${entry.id}`);
    fs.writeFileSync(path.join(out, entry.alternateFile), altBytes);
    writeWaveSvg(altBytes, entry.alternateWaveFile, '#e69a43');
  }
  let specs;
  if (entry.domain === 'model') {
    specs = formatModelSpecs(entry, bytes);
  } else if (entry.domain === 'sound') {
    writeWaveSvg(bytes, entry.waveFile, '#e69a43');
    specs = formatSoundSpecs(readWavDurationSec(bytes));
  } else if (entry.domain === 'tile') {
    specs = { en: '32x32 PNG · 3x3 seamless', ko: '32x32 PNG · 3x3 심리스 타일' };
  } else {
    specs = { en: '32x32 PNG · OKLCH · sel-out', ko: '32x32 PNG · OKLCH · sel-out' };
  }
  return {
    id: entry.id,
    domain: entry.domain,
    category: entry.category,
    featured: entry.featured,
    name: entry.name,
    summary: entry.summary,
    specs,
    sourcePath: entry.sourcePath,
    sourceHref: `/${entry.sourcePath}`,
    outputHref: `/media/catalog/${entry.outputFile}`,
    previewHref: entry.waveFile
      ? `/media/catalog/${entry.waveFile}`
      : `/media/catalog/${entry.outputFile}`,
    alternateHref: entry.alternateFile ? `/media/catalog/${entry.alternateFile}` : null,
    alternateWaveHref: entry.alternateWaveFile ? `/media/catalog/${entry.alternateWaveFile}` : null,
    motions: entry.motions,
    tags: entry.tags,
  };
};

const LEGACY_SOUND_ALIASES = [
  ['bird-base.wav', 'bird-call.wav'],
  ['bird-base.svg', 'bird-call.svg'],
];

const main = () => {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-landing-'));
  let builtFiles;
  try {
    builtFiles = compileAllAssets(temp);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  const catalog = ASSET_CATALOG.map((entry) => buildEntryRecord(entry, builtFiles));
  for (const [alias, target] of LEGACY_SOUND_ALIASES) {
    fs.copyFileSync(path.join(out, target), path.join(out, alias));
  }
  fs.copyFileSync(path.join(out, 'iron-sword.png'), path.join(out, 'sword.png'));
  fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify(catalog, null, 2));
  buildSync({
    entryPoints: [path.join(root, 'scripts/landing/viewer.js')],
    outfile: path.join(out, 'viewer.js'),
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
};

main();
