'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { Worker } = require('node:worker_threads');
const { hash } = require('./build');
const { compileItemStudy } = require('./engine');
const DEFAULT = path.resolve(__dirname, '../../dist/items-study');
const read = file => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
function atomic(file, value) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n'); fs.renameSync(temp, file); }
  finally { fs.rmSync(temp, { force: true }); }
}
function locked(root, fn) {
  fs.mkdirSync(root, { recursive: true });
  const lock = path.join(root, '.writer');
  fs.mkdirSync(lock); // Refuse competing writes. Never steal another process's lock.
  try { return fn(); } finally { fs.rmdirSync(lock); }
}
const candidatePath = (root, id) => {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid candidate ID');
  return path.join(root, 'candidates', `${id}.json`);
};
const head = root => read(path.join(root, 'head.json'));
const guard = root => head(root)?.token ?? null;
function inspect(root = DEFAULT) {
  const directory = path.join(root, 'candidates');
  return { head: head(root), candidates: fs.existsSync(directory) ? fs.readdirSync(directory).filter(n => n.endsWith('.json')).sort().map(n => read(path.join(directory, n))) : [] };
}
function propose(source, expectedHead, root = DEFAULT) {
  return locked(root, () => {
    if (guard(root) !== expectedHead) throw new Error('Stale head');
    if (Buffer.byteLength(source) > 262144) throw new Error('Source exceeds 256 KiB');
    fs.mkdirSync(path.join(root, 'candidates'), { recursive: true });
    if (fs.readdirSync(path.join(root, 'candidates')).length >= 128) throw new Error('Candidate limit 128 reached');
    const candidate = { id: randomUUID(), baseHead: expectedHead, source, status: 'pending' };
    atomic(candidatePath(root, candidate.id), candidate); return candidate;
  });
}
function verifyBuild(directory) {
  const receipt = read(path.join(directory, 'receipt.json'));
  if (!receipt) throw new Error('Missing receipt');
  const rebuilt = compileItemStudy(fs.readFileSync(path.join(directory, 'source.items.json'), 'utf8'));
  if (!rebuilt.ok || rebuilt.sourceHash !== receipt.sourceHash ||
      JSON.stringify(rebuilt.products.map(p => p.receipt)) !== JSON.stringify(receipt.items)) {
    throw new Error('Source/build receipt mismatch');
  }
  for (const item of receipt.items) {
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(item.id)) throw new Error('Invalid artifact ID');
    if (`sha256:${hash(fs.readFileSync(path.join(directory, `${item.id}.png`)))}` !== item.pngHash) throw new Error('Artifact hash mismatch');
  }
  return receipt;
}
async function build(id, root = DEFAULT) {
  const candidate = locked(root, () => {
    const c = read(candidatePath(root, id));
    if (!c || c.status !== 'pending') throw new Error('Candidate must be pending');
    c.status = 'building'; atomic(candidatePath(root, id), c); return c;
  });
  const worker = new Worker(path.join(__dirname, 'worker.js'), { workerData: { source: candidate.source, output: path.join(root, 'builds') }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  let result;
  try {
    result = await new Promise((resolve, reject) => {
      const poll = setInterval(() => {
        if (read(candidatePath(root, id))?.status === 'cancelled') {
          worker.terminate(); reject(new Error('Build cancelled'));
        }
      }, 100);
      worker.once('exit', () => clearInterval(poll));
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Build timed out')); }, 30000);
      worker.once('message', value => { clearTimeout(timer); resolve(value); });
      worker.once('error', error => { clearTimeout(timer); reject(error); });
      worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
    });
  } catch (error) { result = { ok: false, diagnostics: [{ code: 'sprite.exception', message: error.message }] }; }
  return locked(root, () => {
    const current = read(candidatePath(root, id));
    if (current.status === 'cancelled') return current;
    if (current.status !== 'building') throw new Error('Build state changed');
    current.status = result.ok ? 'built' : 'failed'; current.result = result;
    atomic(candidatePath(root, id), current); return current;
  });
}
function cancel(id, root = DEFAULT) {
  return locked(root, () => {
    const c = read(candidatePath(root, id));
    if (!c || !['pending', 'building'].includes(c.status)) throw new Error('Candidate is not cancellable');
    c.status = 'cancelled'; atomic(candidatePath(root, id), c); return c;
  });
}
function present(id, root = DEFAULT) {
  const c = read(candidatePath(root, id));
  if (!c || c.status !== 'built') throw new Error('Candidate must be built');
  if (fs.readFileSync(path.join(c.result.directory, 'source.items.json'), 'utf8') !== c.source) throw new Error('Candidate source mismatch');
  const receipt = verifyBuild(c.result.directory);
  return { candidate: c, receipt,
    artifacts: receipt.items.map(p => ({ id: p.id, native: path.join(c.result.directory, `${p.id}.png`),
      source: path.join(c.result.directory, 'source.items.json'),
      stages: ['silhouette','shade','grain','final'].map(stage => ({ stage, path: path.join(c.result.directory,
        stage === 'final' ? `${p.id}@16x.png` : `${p.id}.${stage}.png`) })) })) };
}
function apply(id, root = DEFAULT) {
  return locked(root, () => {
    const { candidate: c, receipt } = present(id, root);
    if (c.baseHead !== guard(root)) throw new Error('Stale head');
    const value = { token: randomUUID(), candidate: id, key: receipt.key, sourceHash: receipt.sourceHash,
      directory: c.result.directory };
    atomic(path.join(root, 'head.json'), value); return value;
  });
}
function exportHead(destination, root = DEFAULT) {
  const current = head(root);
  if (!current) throw new Error('No accepted head');
  verifyBuild(current.directory);
  // Exclusive destination: never overwrite an existing delivery.
  fs.mkdirSync(destination);
  try {
    const receipt = verifyBuild(current.directory);
    for (const item of receipt.items) fs.copyFileSync(path.join(current.directory, `${item.id}.png`), path.join(destination, `${item.id}.png`));
    atomic(path.join(destination, 'delivery.json'), { head: current, receipt });
  } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
  return { destination, head: current.token };
}
module.exports = { DEFAULT, inspect, propose, build, cancel, present, apply, exportHead, verifyBuild };
