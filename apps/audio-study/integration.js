'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { execute } = require('./harness');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-audio-integration-'));
process.env.ASHFOX_AUDIO_STORE = root;
const { startServer } = require('./serve');
const main = async () => {
  const server = startServer(0); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const post = async (request) => {
    const response = await fetch(url + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const body = await response.json(); assert.equal(body.ok, true, JSON.stringify(body)); return body.result || body.job;
  };
  const poll = async (job) => {
    for (let i = 0; i < 500; i++) {
      const state = await (await fetch(url + '/jobs/' + job.id)).json();
      if (state.state !== 'running') return state;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('Job did not finish');
  };
  try {
    const capabilities = await (await fetch(url + '/capabilities')).json();
    const files = { 'sounds/bird_call.ashfox': capabilities.examples['sounds/bird_call.ashfox'] };
    const head = await post({ op: 'init', files });
    const candidate = await post({ op: 'propose', expectedHead: head.id, writes: {}, deletes: [] });
    const built = await poll(await post({ op: 'build', candidate: candidate.candidate }));
    assert.equal(built.state, 'succeeded', JSON.stringify(built));
    const first = built.result.result;
    const { compileSoundSource } = require('./engine');
    const { hash } = require('./storage');
    const expected = compileSoundSource(files['sounds/bird_call.ashfox'], 'sounds/bird_call.ashfox');
    assert.deepEqual(first.receipt.entries.map((e) => e.wavHash), expected.map((e) => hash(Buffer.from(e.wav))), 'Harness differs from public compiler');
    const repeated = await poll(await post({ op: 'build', candidate: candidate.candidate }));
    assert.equal(repeated.state, 'succeeded', JSON.stringify(repeated));
    assert.deepEqual(first.receipt.entries.map((e) => e.wavHash), repeated.result.result.receipt.entries.map((e) => e.wavHash), 'Repeated WAV build changes');
    const loops = await post({ op: 'propose', expectedHead: head.id, writes: { 'sounds/wind_loop.ashfox': capabilities.examples['sounds/wind_loop.ashfox'] }, deletes: ['sounds/bird_call.ashfox'] });
    const loopBuild = await poll(await post({ op: 'build', candidate: loops.candidate }));
    assert.equal(loopBuild.state, 'succeeded', JSON.stringify(loopBuild));
    for (const entry of loopBuild.result.result.receipt.entries) {
      assert.deepEqual(entry.playback, { kind: 'loop', startFrame: 0, endFrame: 188160 });
      assert.equal(entry.ogg, undefined);
    }
    const changed = files['sounds/bird_call.ashfox'].replace(/value = 2850/, 'value = 1800');
    const change = await post({ op: 'propose', expectedHead: head.id, writes: { 'sounds/bird_call.ashfox': changed }, deletes: [] });
    const changeBuild = await poll(await post({ op: 'build', candidate: change.candidate }));
    assert.equal(changeBuild.state, 'succeeded', JSON.stringify(changeBuild));
    assert.notEqual(first.receipt.entries[0].wavHash, changeBuild.result.result.receipt.entries[0].wavHash, 'Source change has no effect on encoded WAV');
    const extra = await post({ op: 'propose', expectedHead: head.id, writes: { 'sounds/frog_croak.ashfox': capabilities.examples['sounds/frog_croak.ashfox'] }, deletes: [] });
    const extraBuild = await poll(await post({ op: 'build', candidate: extra.candidate }));
    assert.equal(extraBuild.state, 'succeeded', JSON.stringify(extraBuild));
    assert.deepEqual(first.receipt.entries.map((e) => e.wavHash), extraBuild.result.result.receipt.entries.filter((e) => e.sound === 'bird_call').map((e) => e.wavHash), 'Unrelated sound changes original encoded output');
    await post({ op: 'present', candidate: candidate.candidate, build: first.build });
    const adopted = await post({ op: 'apply', expectedHead: head.id, candidate: candidate.candidate, build: first.build });
    const exported = await post({ op: 'export', head: adopted.id, build: first.build, target: 'audio-bundle' });
    assert.ok(fs.existsSync(path.join(exported.directory, first.receipt.entries[0].ogg)));
    const catalog = await (await fetch(url + '/catalog')).json();
    assert.equal(catalog.head.build, first.build);
    assert.ok(catalog.builds.length > 0);
    assert.equal(Object.hasOwn(catalog, 'reviews'), false);
    assert.equal(Object.hasOwn(catalog, 'files'), false);
    assert.equal(Object.hasOwn(catalog.builds[0], 'sourceHash'), false);
    const foreign = await fetch(url + '/api', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' }, body: '{"op":"inspect"}' }); assert.equal(foreign.status, 403);
    const invalid = await post({ op: 'build', candidate: '0'.repeat(64) }); assert.equal((await poll(invalid)).state, 'failed');
    const encoder = process.env.ASHFOX_FFMPEG_PATH;
    process.env.ASHFOX_FFMPEG_PATH = path.join(root, 'missing-encoder');
    const failedEncode = await poll(await post({ op: 'build', candidate: candidate.candidate }));
    assert.equal(failedEncode.state, 'failed');
    if (encoder === undefined) delete process.env.ASHFOX_FFMPEG_PATH; else process.env.ASHFOX_FFMPEG_PATH = encoder;
    const pending = await post({ op: 'build', candidate: candidate.candidate });
    await fetch(url + '/jobs/' + pending.id + '/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await poll(pending)).state, 'cancelled');
    assert.deepEqual(execute(root, { op: 'inspect' }).head, adopted, 'Failure/cancellation changes head');
    console.log('HTTP end-to-end: discover → inspect/propose → real encoded build → present → apply → export; deterministic WAV, failure, cancellation, origin guard checks passed.');
  } finally { server.closeAllConnections(); await new Promise((r) => server.close(r)); }
};
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { fs.rmSync(root, { recursive: true, force: true }); });
