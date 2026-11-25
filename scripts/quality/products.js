'use strict';

/**
 * Product oracle: compiles every repository example in memory and compares
 * the resulting product and artifact digests with a committed baseline.
 * A behavior-preserving change must leave every digest unchanged.
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { register } = require('ts-node');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_PATH = path.join(__dirname, 'products-baseline.json');
const TOOLCHAIN = 'ashfox-product-oracle:1';
const STANDALONE_SOURCES = Object.freeze([
  'examples/fox/creatures/fox.ashfox',
  'examples/goblin/creatures/goblin.ashfox',
  'examples/griffin/workbench/main.ashfox',
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const canonical = (value) => {
  if (value instanceof Uint8Array) return { bytes: sha256(value) };
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};

const digestValue = (value) => sha256(JSON.stringify(canonical(value)));

/** Deterministic stand-in for WASM Vorbis encoding so pack assembly is covered without encoder overhead. */
const identityEncoder = Object.freeze({
  fingerprint: 'ashfox-product-oracle:identity-vorbis',
  encode: async (wav) => Uint8Array.from(wav),
});

const exampleInputs = (root = ROOT) => {
  const examples = path.join(root, 'examples');
  const workspaces = fs
    .readdirSync(examples, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.posix.join('examples', entry.name, '.ashfoxworkspace'))
    .filter((relative) => fs.existsSync(path.join(root, relative)));
  return [...workspaces, ...STANDALONE_SOURCES].sort();
};

const productDigest = (product) => {
  const entry = `${product.entry.packageName}/${product.entry.entryName}`;
  if (product.kind === 'sprite')
    return { entry, kind: product.kind, sha256: sha256(product.sprite.png) };
  if (product.kind === 'sound') {
    return {
      entry,
      kind: product.kind,
      variants: product.sounds.map((sound) => ({ id: sound.variant, sha256: sha256(sound.wav) })),
    };
  }
  return { entry, kind: product.kind, sha256: digestValue(product.model) };
};

const describeInput = async (relative, build) => {
  try {
    const snapshot = build.readSnapshot(path.join(ROOT, relative));
    const checked = build.checkSnapshot(snapshot);
    const bundle = await build.compileBundle(snapshot, TOOLCHAIN, identityEncoder, checked);
    return {
      input: relative,
      ok: true,
      sourceHash: checked.sourceHash,
      products: checked.products
        .map(productDigest)
        .sort((a, b) => (a.entry < b.entry ? -1 : a.entry > b.entry ? 1 : 0)),
      catalogHash: bundle.receipt.catalogHash,
      files: bundle.receipt.files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    };
  } catch (error) {
    return { input: relative, ok: false, code: error && error.code ? error.code : 'unknown' };
  }
};

const collect = async (build) => {
  const results = [];
  for (const input of exampleInputs()) results.push(await describeInput(input, build));
  return { format: 'ashfox-product-oracle', version: 1, toolchain: TOOLCHAIN, inputs: results };
};

/** Returns human-readable differences between two oracle reports. */
const compareReports = (expected, actual) => {
  const differences = [];
  const byInput = (report) => new Map(report.inputs.map((item) => [item.input, item]));
  const before = byInput(expected);
  const after = byInput(actual);
  for (const input of new Set([...before.keys(), ...after.keys()])) {
    const left = before.get(input);
    const right = after.get(input);
    if (!left) differences.push(`${input}: new input not in baseline`);
    else if (!right) differences.push(`${input}: missing from current build`);
    else if (JSON.stringify(left) !== JSON.stringify(right)) {
      const leftFiles = new Map((left.files || []).map((file) => [file.path, file.sha256]));
      const rightFiles = new Map((right.files || []).map((file) => [file.path, file.sha256]));
      const changed = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].filter(
        (file) => leftFiles.get(file) !== rightFiles.get(file),
      );
      differences.push(
        `${input}: output changed` + (changed.length ? ` (${changed.slice(0, 5).join(', ')})` : ''),
      );
    }
  }
  return differences;
};

const main = async () => {
  register({
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
  });
  const build = require('@ashfox/asset-build');
  const report = await collect(build);
  const text = JSON.stringify(report, null, 2) + '\n';
  if (process.argv.includes('--write')) {
    fs.writeFileSync(BASELINE_PATH, text);
    console.log(`ashfox product oracle sealed: ${report.inputs.length} inputs`);
    return;
  }
  const differences = compareReports(JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')), report);
  if (differences.length) {
    console.error('ashfox product oracle failed. Differences:');
    for (const difference of differences) console.error(`- ${difference}`);
    console.error('Reseal with `npm run quality:products:seal` only for intended output changes.');
    process.exitCode = 1;
    return;
  }
  console.log(`ashfox product oracle ok: ${report.inputs.length} inputs unchanged`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({ canonical, compareReports, exampleInputs });
