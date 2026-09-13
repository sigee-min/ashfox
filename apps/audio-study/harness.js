'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { openStore, validate, hash, closed, id, fault } = require('./storage');
const { compile } = require('./compile');
const { AUDIO_POLICY } = require('./engine');
const bootstrap = () => Object.fromEntries(fs.readdirSync(path.join(__dirname, '../../examples/sounds/src'))
  .filter((n) => n.endsWith('.ashfox')).sort().map((n) => [`sounds/${n}`, fs.readFileSync(path.join(__dirname, '../../examples/sounds/src', n), 'utf8')]));
const verifyDirectory = (dir, key) => {
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, 'receipt.json'), 'utf8'));
  closed(receipt, ['format', 'version', 'sourceHash', 'dspHash', 'node', 'encoderVersion', 'entries']);
  if (receipt.format !== 'ashfox-audio-build' || receipt.version !== 1 || receipt.dspHash !== hash(AUDIO_POLICY) || !Array.isArray(receipt.entries)) fault('build.corrupt', '/', 'Stale or invalid sound receipt');
  if (hash(receipt) !== key) fault('build.corrupt', '/', 'Build receipt hash mismatch');
  for (const entry of receipt.entries) {
    const playback = entry.playback;
    closed(entry, ['sound', 'variant', 'wav', 'wavHash', 'playback', 'rawFrames', 'seamDelta', 'maxAdjacentDelta', 'sourceHash', 'samples', 'sampleRate', 'peak', 'rms', 'dc', ...(playback?.kind === 'oneshot' ? ['ogg', 'oggHash', 'decodedPeak'] : [])]);
    if (!playback || !['oneshot', 'loop'].includes(playback.kind)) fault('build.corrupt', '/', 'Missing playback contract');
    closed(playback, playback.kind === 'loop' ? ['kind', 'startFrame', 'endFrame'] : ['kind']);
    if (!Number.isSafeInteger(entry.samples) || entry.samples < 1 || entry.sampleRate !== 48000) fault('build.corrupt', '/', 'Invalid frame metadata');
    if (playback.kind === 'loop' && (playback.startFrame !== 0 || playback.endFrame !== entry.samples || entry.ogg !== undefined)) fault('build.corrupt', '/', 'Invalid loop bounds or codec');
    for (const type of playback.kind === 'loop' ? ['wav'] : ['wav', 'ogg']) {
    if (!/^[a-z][a-z0-9_-]{0,63}\/[a-z][a-z0-9_]{0,31}\.(wav|ogg)$/u.test(entry[type])) fault('build.corrupt', '/', 'Invalid artifact path');
    if (hash(fs.readFileSync(path.join(dir, entry[type]))) !== entry[type + 'Hash']) fault('build.corrupt', entry[type], 'Artifact hash mismatch');
  }
    const wav = fs.readFileSync(path.join(dir, entry.wav));
    if (wav.length !== 44 + entry.samples * 2 || wav.readUInt32LE(40) !== entry.samples * 2) fault('build.corrupt', '/', 'WAV frame metadata mismatch');
  }
  return receipt;
};
const verifyBuild = (store, key) => verifyDirectory(path.join(store.root, 'builds', id(key)), key);
const listBuilds = (s) => fs.readdirSync(path.join(s.root, 'builds')).filter((n) => /^[a-f0-9]{64}$/u.test(n)).sort((a, b) => fs.statSync(path.join(s.root, 'builds', b)).mtimeMs - fs.statSync(path.join(s.root, 'builds', a)).mtimeMs).map((key) => ({ id: key, ...verifyBuild(s, key) }));
const viewerCatalog = (root) => {
  const s = openStore(root);
  return { head: { build: s.head()?.build || null }, builds: listBuilds(s).map((b) => ({
    id: b.id, entries: b.entries.map(({ sound, variant, wav, ogg, wavHash, samples, sampleRate, playback }) => ({ sound, variant, wav, ogg, wavHash, samples, sampleRate, playback }))
  })) };
};
const execute = (root, request) => {
  const s = openStore(root);
  if (!request || typeof request.op !== 'string') fault('input.operation', '/', 'Expected op');
  switch (request.op) {
    case 'capabilities': {
      closed(request, ['op']);
      return { format: 'ashfox-audio-harness', version: 1, operations: {
        init: ['files'], inspect: [], propose: ['expectedHead', 'writes', 'deletes'], build: ['candidate'],
        present: ['candidate', 'build'], apply: ['expectedHead', 'candidate', 'build'], export: ['head', 'build', 'target']
      }, sourceGuide: fs.readFileSync(path.join(__dirname, '../../docs/guides/sounds.md'), 'utf8'), examples: Object.fromEntries(Object.entries(bootstrap()).filter(([n]) => n.startsWith('sounds/'))),
      sourcePolicy: 'Code only; no audio inputs, sample models, network or arbitrary code execution.', limits: { sourceBytes: 8388608, sounds: 32, voices: 16, sequences: 32, variants: 8, secondsPerSound: 30, totalVariantSeconds: 240 },
      transport: 'POST /api with same-origin JSON; CLI accepts one JSON request on stdin. Server build returns a job; GET /jobs/:id polls and POST /jobs/:id/cancel cancels. CLI build is synchronous.' };
    }
    case 'init': {
      closed(request, ['op', 'files']); validate(request.files);
      return s.lock(() => {
        if (s.head()) fault('head.exists', '/', 'Store already initialized; use propose');
        const source = s.put('snapshots', request.files);
        s.atomic('head.json', { id: hash({ source, initial: true }), source, build: null }); return s.head();
      });
    }
    case 'inspect': {
      closed(request, ['op']); const head = s.head();
      return { head, files: head ? s.snapshot(head.source) : {}, candidates: s.list('candidates').map((key) => ({ id: key, ...s.candidate(key) })), builds: listBuilds(s) };
    }
    case 'propose': {
      closed(request, ['op', 'expectedHead', 'writes', 'deletes']); id(request.expectedHead);
      if (!request.writes || typeof request.writes !== 'object' || Array.isArray(request.writes) || !Array.isArray(request.deletes) || request.deletes.some((n) => typeof n !== 'string') || new Set(request.deletes).size !== request.deletes.length) fault('input.change', '/', 'Invalid writes/deletes');
      return s.lock(() => {
        if (s.head()?.id !== request.expectedHead) fault('head.stale', '/expectedHead', 'Inspect current source before proposing');
        const files = s.snapshot(s.head().source);
        for (const name of request.deletes) {
          if (!Object.hasOwn(files, name) || Object.hasOwn(request.writes, name)) fault('source.delete', name, 'Delete must exist and cannot overlap writes');
          delete files[name];
        }
        for (const [name, value] of Object.entries(request.writes)) Object.defineProperty(files, name, { value, enumerable: true, configurable: true, writable: true });
        validate(files); const source = s.put('snapshots', files);
        return { candidate: s.put('candidates', { baseHead: request.expectedHead, source }), source };
      });
    }
    case 'build': {
      closed(request, ['op', 'candidate']); const candidate = s.candidate(request.candidate);
      if (fs.readdirSync(path.join(s.root, 'builds')).length >= 64) fault('store.budget', '/', 'Build limit reached; archive this session and start a new store.');
      return (async () => {
        const temporary = fs.mkdtempSync(path.join(s.root, `.build-${process.pid}-`));
        try {
          const receipt = await compile(s.snapshot(candidate.source), temporary), build = hash(receipt);
          verifyDirectory(temporary, build);
          const target = path.join(s.root, 'builds', build);
          if (!fs.existsSync(target)) {
            try { fs.renameSync(temporary, target); } catch (e) { if (!fs.existsSync(target)) throw e; }
          }
          return { candidate: request.candidate, build, receipt: verifyBuild(s, build) };
        } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
      })();
    }
    case 'present': {
      closed(request, ['op', 'candidate', 'build']);
      const candidate = s.candidate(request.candidate), receipt = verifyBuild(s, request.build);
      if (receipt.sourceHash !== candidate.source) fault('build.mismatch', '/build', 'Build does not belong to candidate');
      return { candidate: request.candidate, build: request.build, receipt };
    }
    case 'apply': {
      closed(request, ['op', 'expectedHead', 'candidate', 'build']);
      const candidate = s.candidate(request.candidate), receipt = verifyBuild(s, request.build);
      if (receipt.sourceHash !== candidate.source) fault('build.mismatch', '/', 'Candidate/build mismatch');
      return s.lock(() => {
        if (s.head()?.id !== request.expectedHead || candidate.baseHead !== request.expectedHead) fault('head.stale', '/expectedHead', 'Candidate base is stale');
        s.atomic('head.json', { id: hash({ parent: request.expectedHead, build: request.build }), source: candidate.source, build: request.build }); return s.head();
      });
    }
    case 'export': {
      closed(request, ['op', 'head', 'build', 'target']);
      if (request.target !== 'audio-bundle') fault('export.target', '/target', 'Only audio-bundle is supported; no game-runtime integration is claimed');
      if (s.head()?.id !== request.head || s.head()?.build !== request.build) fault('head.stale', '/', 'Export must name the applied head/build');
      if (fs.readdirSync(path.join(s.root, 'exports')).length >= 64) fault('store.budget', '/', 'Export limit reached; archive this session and start a new store.');
      const receipt = verifyBuild(s, request.build);
      const name = hash({ source: request.head, build: request.build, target: request.target });
      const target = path.join(s.root, 'exports', name), stage = fs.mkdtempSync(path.join(s.root, '.export-'));
      try {
        fs.cpSync(path.join(s.root, 'builds', request.build), stage, { recursive: true });
        for (const [file, source] of Object.entries(s.snapshot(receipt.sourceHash))) {
          const output = path.join(stage, 'source', file); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, source);
        }
        s.lock(() => {
          if (s.head()?.id !== request.head || s.head()?.build !== request.build) fault('head.stale', '/', 'Head changed during export');
          if (!fs.existsSync(target)) fs.renameSync(stage, target);
        });
      } finally { fs.rmSync(stage, { force: true, recursive: true }); }
      return { export: name, directory: target, entries: receipt.entries.length };
    }
    default: fault('input.operation', '/op', 'Unknown operation');
  }
};
module.exports = { execute, bootstrap, verifyBuild, viewerCatalog };
