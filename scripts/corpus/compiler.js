'use strict';
// Isolated compiler scaling benchmark; timings exclude process/bundle startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const cases = ['models-1', 'models-8', 'models-24', 'exports-1', 'exports-4', 'png-256', 'png-1024', 'hash-1048576', 'hash-16777216', 'parents-1000', 'parents-4000', 'geometry-100', 'geometry-1000', 'charts-100', 'charts-1000', 'charts-4000'];
const fixture = (count, exportsPerEntry) => {
  const base = JSON.parse(fs.readFileSync(path.join(root, 'assets/workspaces/fox.ashfoxworkspace'), 'utf8'));
  const pkg = base.manifest.packages[0];
  const entry = base.files.find(file => file.path === 'creatures/fox.ashfox');
  const entries = Array.from({ length: count }, (_, i) => ({ name: `fox_${i}`, path: `fox_${i}.ashfox` }));
  const files = base.files.filter(file => file !== entry).concat(entries.map(item => ({
    path: `creatures/${item.path}`, source: entry.source.replace(/\bfox\b/g, item.name),
  })));
  const config = { format: 'ashfox-workspace', version: 2, name: 'compiler-benchmark',
    packages: [{ ...pkg, manifest: { ...pkg.manifest, entries } }], include: ['**/*.ashfox'], ignore: [],
    build: { directory: 'build' }, exports: entries.flatMap(item => Array.from({ length: exportsPerEntry }, (_, i) => ({
      name: `${item.name}_${i}`, entry: { packageName: pkg.name, entryName: item.name },
      format: 'glb', directory: `exports/${item.name}_${i}`,
    }))),
  };
  return { configuration: JSON.stringify(config), files };
};
const worker = async (bundle, name) => {
  const api = require(bundle);
  const exporting = name.startsWith('exports');
  const count = Number(name.split('-')[1]);
  const png = name.startsWith('png-');
  const digest = name.startsWith('hash-');
  const parents = name.startsWith('parents-');
  const charts = name.startsWith('charts-') ? require('./charts')(count) : null;
  const geometry = name.startsWith('geometry-') ? require('./geometry')(count) : null;
  const nodes = parents ? Array.from({ length: count }, (_, i) => ({ id: String(i), parentId: i + 1 < count ? String(i + 1) : null })) : [];
  const byId = new Map(nodes.map(node => [node.id, node]));
  const hashInput = digest ? Uint8Array.from({ length: count }, (_, i) => (i * 31 + 7) & 255) : null;
  const raster = png ? api.rasterizeCanonicalTexture(count, count, {
    background: '#81a5f9', backgroundAlpha: 255, canvasDetails: [], alphaMasks: [],
  }) : null;
  const snapshot = png || digest || parents || geometry || charts ? null : fixture(exporting ? 1 : count, exporting ? count : 1);
  const run = async () => {
    if (png) return api.encodeCanonicalPng(raster);
    if (digest) return api.sha256ByteDigest(hashInput);
    if (parents) return api.parentCycles(nodes, byId);
    if (charts) {
      const issues = [];
      const result = api.materializeAssetTexturePlan(charts.surface, charts.contract, charts.usages, 'root.ashfox', (...issue) => issues.push(issue));
      assert.deepEqual(issues, []); assert.ok(result);
      return result;
    }
    if (geometry) {
      const issues = [];
      const result = api.lowerAssetGeometry(geometry.ir, geometry.plans, (...issue) => issues.push(issue));
      assert.deepEqual(issues, []); assert.ok(result);
      return result;
    }
    const checked = api.compileDirectoryWorkspace(snapshot.configuration, snapshot.files);
    assert.ok(checked.ok, JSON.stringify(checked.diagnostics));
    return exporting ? api.compileBundle(snapshot, 'compiler-benchmark', undefined, checked) : checked;
  };
  const hash = value => createHash('sha256').update(value instanceof Uint8Array ? value : JSON.stringify(value)).digest('hex');
  const expected = hash(await run());
  const times = [], heaps = [];
  for (let i = 0; i < 5; i++) {
    global.gc();
    const beforeHeap = process.memoryUsage().heapUsed;
    const start = performance.now();
    const result = await run();
    times.push(performance.now() - start);
    heaps.push(process.memoryUsage().heapUsed - beforeHeap);
    assert.equal(hash(result), expected, 'Repeated builds must produce identical results');
  }
  times.sort((a, b) => a - b); heaps.sort((a, b) => a - b);
  console.log(JSON.stringify({ name, medianMs: times[2], medianHeapDeltaMiB: heaps[2] / 1048576,
    peakRssMiB: process.resourceUsage().maxRSS / 1024, outputHash: expected }));
};
const main = async () => {
  if (process.argv[2] === '--worker') return worker(process.argv[3], process.argv[4]);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-compiler-benchmark-'));
  try {
    const comparing = ['--compare', '--compare-bundle'].includes(process.argv[2]);
    const ref = process.argv[2] === '--compare' ? execFileSync('git', ['rev-parse', '--verify', '--end-of-options',
      `${process.argv[3]}^{commit}`], { cwd: root, encoding: 'utf8' }).trim() : null;
    const build = async (filename, baseline) => {
      const changed = baseline ? new Set(execFileSync('git', ['diff', '--name-only', ref, '--', 'packages'],
        { cwd: root, encoding: 'utf8' }).trim().split('\n')) : new Set();
      await require('esbuild').build({ stdin: { contents:
        "export { compileDirectoryWorkspace, encodeCanonicalPng, rasterizeCanonicalTexture } from './packages/engine-core/src'; export { materializeAssetTexturePlan } from './packages/engine-core/src/compiler/program/asset/texturePlan'; export { lowerAssetGeometry } from './packages/engine-core/src/compiler/program/asset/canonicalGeometry'; export { parentCycles } from './packages/engine-core/src/compiler/program/asset/parentCycles'; export { sha256ByteDigest } from './packages/engine-core/src/provenance/digest'; export { compileBundle } from './packages/asset-build/src/bundle/compile';",
        resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: filename, logLevel: 'silent',
        plugins: baseline ? [{ name: 'baseline', setup(builder) {
          builder.onLoad({ filter: /\.ts$/ }, args => {
            const relative = path.relative(root, args.path).split(path.sep).join('/');
            if (!changed.has(relative)) return undefined;
            return { contents: execFileSync('git', ['show', `${ref}:${relative}`],
              { cwd: root, encoding: 'utf8' }), loader: 'ts' };
          });
        } }] : [],
      });
    };
    const bundle = path.join(temp, 'compiler.cjs');
    const baseline = process.argv[2] === '--compare-bundle'
      ? path.resolve(process.argv[3]) : path.join(temp, 'baseline.cjs');
    await build(bundle, false);
    if (process.argv[2] === '--snapshot') {
      fs.copyFileSync(bundle, path.resolve(process.argv[3]));
      return;
    }
    if (ref) await build(baseline, true);
    const measure = (compiled, name) => JSON.parse(execFileSync(process.execPath,
      ['--expose-gc', __filename, '--worker', compiled, name], { encoding: 'utf8', timeout: 120000 }));
    // The parent microbenchmark was extracted from the old private validator
    // for saved-bundle comparisons; it has no standalone historical Git API.
    const measuredCases = ref ? cases.filter(name => !name.startsWith('parents-')) : cases;
    const results = measuredCases.map(name => {
      if (!comparing) return measure(bundle, name);
      const before = measure(baseline, name), after = measure(bundle, name);
      assert.equal(after.outputHash, before.outputHash, 'Optimization must preserve baseline bytes and metadata');
      return { name, before, after };
    });
    const report = { node: process.version, platform: `${process.platform}/${process.arch}`, baseRef: ref, baselineBundleHash: comparing ? createHash('sha256').update(fs.readFileSync(baseline)).digest('hex') : null, results };
    const output = comparing ? process.argv[4] : process.argv[2];
    if (output) fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
};
main().catch(error => { console.error(error); process.exitCode = 1; });
