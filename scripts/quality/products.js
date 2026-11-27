'use strict';

/**
 * Product oracle: compiles the repository showcase workspace and standard library
 * in memory, comparing domain-split digests against committed baselines under
 * scripts/quality/products-baseline/{models,sprites,vfx,sounds,structures,std}.json.
 */
const fs = require('node:fs');
const path = require('node:path');
const { register } = require('ts-node');
const { compareText, readJson, sha256 } = require('../shared');

const ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_DIR = path.join(__dirname, 'products-baseline');
const TOOLCHAIN = 'ashfox-product-oracle:2';
const DOMAINS = Object.freeze(['models', 'sprites', 'vfx', 'sounds', 'structures', 'std']);
const KIND_TO_DOMAIN = Object.freeze({
  model: 'models',
  sprite: 'sprites',
  vfx: 'vfx',
  sound: 'sounds',
  structure: 'structures',
});

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

const domainBaselinePath = (domain, dir = BASELINE_DIR) => path.join(dir, `${domain}.json`);

const showcaseInputs = (root = ROOT) => {
  const ws = path.join(root, 'showcase', '.ashfoxworkspace');
  return fs.existsSync(ws) ? ['showcase/.ashfoxworkspace'] : [];
};

const walkAshfoxFiles = (dir, rel = '', out = []) => {
  for (const entry of fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => compareText(a.name, b.name))) {
    const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkAshfoxFiles(full, nextRel, out);
    else if (entry.isFile() && entry.name.endsWith('.ashfox')) out.push(nextRel);
  }
  return out;
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
  if (product.kind === 'structure') {
    return {
      entry,
      kind: product.kind,
      nbt: sha256(product.structure.nbt),
      playableMeta: digestValue(product.structure.playableMeta),
      document: digestValue(product.structure.document),
    };
  }
  if (product.kind === 'vfx') {
    return { entry, kind: product.kind, glb: sha256(product.glb), spec: digestValue(product.spec) };
  }
  return { entry, kind: product.kind, sha256: digestValue(product.model) };
};

const exportDomainMap = (config, products) => {
  const entryKind = new Map(
    products.map((p) => [`${p.entry.packageName}/${p.entry.entryName}`, KIND_TO_DOMAIN[p.kind]]),
  );
  const map = new Map();
  for (const exp of config.exports || []) {
    const key = `${exp.entry.packageName}/${exp.entry.entryName}`;
    const domain = entryKind.get(key);
    if (domain) map.set(`assets/${exp.name}/`, domain);
  }
  return map;
};

const classifyReceiptFile = (filePath, exportMap) => {
  for (const [prefix, domain] of exportMap) {
    if (filePath.startsWith(prefix)) return domain;
  }
  return 'structures';
};

const buildShowcaseDomainReports = async (build) => {
  const input = 'showcase/.ashfoxworkspace';
  const snapshot = build.readSnapshot(path.join(ROOT, input));
  const checked = build.checkSnapshot(snapshot);
  const bundle = await build.compileBundle(snapshot, TOOLCHAIN, identityEncoder, checked);
  const exportMap = exportDomainMap(snapshot.config, checked.products);
  const byDomain = Object.fromEntries(
    ['models', 'sprites', 'vfx', 'sounds', 'structures'].map((d) => [
      d,
      { products: [], files: [] },
    ]),
  );
  for (const product of checked.products) {
    const domain = KIND_TO_DOMAIN[product.kind];
    if (domain) byDomain[domain].products.push(productDigest(product));
  }
  for (const file of bundle.receipt.files) {
    const domain = classifyReceiptFile(file.path, exportMap);
    byDomain[domain].files.push({ path: file.path, sha256: file.sha256 });
  }
  return Object.fromEntries(
    Object.entries(byDomain).map(([domain, bucket]) => [
      domain,
      {
        format: 'ashfox-product-oracle',
        version: 1,
        domain,
        toolchain: TOOLCHAIN,
        inputs: [
          {
            input,
            ok: true,
            sourceHash: checked.sourceHash,
            ...(domain === 'structures' ? { catalogHash: bundle.receipt.catalogHash } : {}),
            products: bucket.products.sort((a, b) => compareText(a.entry, b.entry)),
            files: bucket.files.sort((a, b) => compareText(a.path, b.path)),
          },
        ],
      },
    ]),
  );
};

const buildStdDomainReport = (engine) => {
  const stdDir = path.join(ROOT, 'library', 'std');
  const relFiles = walkAshfoxFiles(stdDir);
  const virtualLibs = new Map();
  const modules = [];
  const modInputs = [];
  for (const rel of relFiles) {
    const logicalPath = `library/std/${rel}`;
    const source = fs.readFileSync(path.join(stdDir, rel), 'utf8');
    const spec = engine.virtualLibrarySpecifierFromPath(logicalPath);
    if (!spec) throw new Error(`Non-canonical stdlib path: ${logicalPath}`);
    virtualLibs.set(spec, source);
    modInputs.push({ path: logicalPath, source });
    const desc = engine.describeVirtualModule(spec, source);
    modules.push({
      path: logicalPath,
      specifier: spec,
      sha256: sha256(source),
      exports: desc.exports.map((e) => e.name).sort(compareText),
      imports: [...desc.imports].sort(compareText),
      params: desc.params.map((p) => p.name).sort(compareText),
    });
  }
  const modResult = engine.checkWorkspaceModularity(modInputs);
  if (!modResult.ok) throw new Error('std modularity check failed');
  return {
    format: 'ashfox-product-oracle',
    version: 1,
    domain: 'std',
    toolchain: TOOLCHAIN,
    inputs: [
      {
        input: 'library/std',
        ok: true,
        sourceHash: digestValue(modules.map((m) => [m.path, m.sha256])),
        modules,
      },
    ],
  };
};

const collectAllDomains = async (build, engine) => {
  const showcase = await buildShowcaseDomainReports(build);
  return { ...showcase, std: buildStdDomainReport(engine) };
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
  const engine = require('@ashfox/engine-core');
  const reports = await collectAllDomains(build, engine);
  if (process.argv.includes('--write')) {
    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    for (const domain of DOMAINS) {
      fs.writeFileSync(domainBaselinePath(domain), JSON.stringify(reports[domain], null, 2) + '\n');
    }
    console.log(`ashfox product oracle sealed: ${DOMAINS.length} domains`);
    return;
  }
  const allDiffs = [];
  for (const domain of DOMAINS) {
    const file = domainBaselinePath(domain);
    const diffs = compareReports(readJson(file), reports[domain]);
    for (const diff of diffs) allDiffs.push(`[${domain}] ${diff}`);
  }
  if (allDiffs.length) {
    console.error('ashfox product oracle failed. Differences:');
    for (const difference of allDiffs) console.error(`- ${difference}`);
    console.error('Reseal with `npm run quality:products:seal` only for intended output changes.');
    process.exitCode = 1;
    return;
  }
  console.log(`ashfox product oracle ok: ${DOMAINS.length} domains unchanged`);
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = Object.freeze({
  DOMAINS,
  canonical,
  compareReports,
  domainBaselinePath,
  showcaseInputs,
});
