'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { parseSoundSource } = require('./engine');
const canonical = (v) => JSON.stringify(v && typeof v === 'object' ? Array.isArray(v) ? v.map(normalize) : normalize(v) : v);
const normalize = (v) => v && typeof v === 'object' ? Array.isArray(v) ? v.map(normalize) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalize(v[k])])) : v;
const hash = (v) => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : canonical(v)).digest('hex');
const fault = (code, pointer, message) => { const e = new Error(message); e.code = code; e.pointer = pointer; throw e; };
const closed = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some((k) => !Object.hasOwn(v, k))) fault('input.closed', '/', `Expected exactly: ${keys.join(', ')}`);
};
const id = (v) => { if (typeof v !== 'string' || !/^[a-f0-9]{64}$/u.test(v)) fault('input.id', '/', 'Invalid content hash'); return v; };
const validate = (files) => {
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length > 32) fault('source.inventory', '/', 'Expected at most 32 .ashfox sound sources');
  if (Buffer.byteLength(canonical(files)) > 8 * 1024 * 1024) fault('source.budget', '/', 'Source exceeds 8 MiB');
  const sounds = [];
  for (const [name, value] of Object.entries(files)) {
    if (typeof value !== 'string') fault('source.text', name, 'Expected UTF-8 source text');
    if (!/^sounds\/[a-z][a-z0-9_-]{0,63}\.ashfox$/u.test(name)) fault('source.path', name, 'Invalid sound path');
    let sound;
    try { sound = parseSoundSource(value, name); } catch (e) { fault('source.invalid', name, e.message); }
    if (name !== `sounds/${sound.id}.ashfox`) fault('source.id', name, 'Filename must match sound id');
    sounds.push(sound);
  }
  if (!sounds.length || sounds.length > 32 || sounds.reduce((n, s) => n + s.duration * s.variants.length, 0) > 60) fault('source.budget', '/', 'Expected sounds with at most 60 seconds total variant output');
  if (Buffer.byteLength(canonical(files)) > 8 * 1024 * 1024) fault('source.budget', '/', 'Source exceeds 8 MiB');
  return sounds.sort((a, b) => a.id < b.id ? -1 : 1);
};
const openStore = (directory) => {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  for (const folder of ['snapshots', 'candidates', 'builds', 'exports', 'jobs']) fs.mkdirSync(path.join(root, folder), { recursive: true });
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
  const atomic = (name, value) => {
    const target = path.join(root, name), temporary = `${target}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, canonical(value) + '\n', { flag: 'wx' }); fs.renameSync(temporary, target); }
    finally { fs.rmSync(temporary, { force: true }); }
  };
  const put = (folder, value) => {
    const key = hash(value), name = `${folder}/${key}.json`;
    if (!fs.existsSync(path.join(root, name))) {
      if (fs.readdirSync(path.join(root, folder)).length >= 128) fault('store.budget', '/', 'Store inventory limit reached; archive this session and start a new store.');
      atomic(name, value);
    }
    return key;
  };
  const lock = (fn) => {
    const file = path.join(root, 'writer.lock');
    let fd;
    try { fd = fs.openSync(file, 'wx'); } catch { fault('store.busy', '/', 'Another writer is active; retry. After a crash verify no writer is running before removing writer.lock.'); }
    try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(file); }
  };
  const head = () => fs.existsSync(path.join(root, 'head.json')) ? read('head.json') : null;
  const snapshot = (key) => { const files = read(`snapshots/${id(key)}.json`); if (hash(files) !== key) fault('store.corrupt', '/', 'Snapshot hash mismatch'); return files; };
  const candidate = (key) => { const c = read(`candidates/${id(key)}.json`); if (hash(c) !== key) fault('store.corrupt', '/', 'Candidate hash mismatch'); return c; };
  const list = (folder) => fs.readdirSync(path.join(root, folder)).filter((n) => /^[a-f0-9]{64}\.json$/u.test(n)).map((n) => n.slice(0, -5));
  return { root, read, atomic, put, lock, head, snapshot, candidate, list };
};
module.exports = { openStore, validate, hash, closed, id, fault };
