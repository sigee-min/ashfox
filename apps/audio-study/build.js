'use strict';
// Bootstrap the example sources once. Later builds always use the current source head.
const path = require('node:path');
const { execute, bootstrap } = require('./harness');
const root = process.env.ASHFOX_AUDIO_STORE || path.resolve(__dirname, '../../.ashfox/audio-native');
const main = async () => {
let state = execute(root, { op: 'inspect' });
if (!state.head) { execute(root, { op: 'init', files: bootstrap() }); state = execute(root, { op: 'inspect' }); }
const candidate = execute(root, { op: 'propose', expectedHead: state.head.id, writes: {}, deletes: [] });
const built = await execute(root, { op: 'build', candidate: candidate.candidate });
console.log(JSON.stringify({ candidate: candidate.candidate, build: built.build, outputs: built.receipt.entries.length, applied: false }, null, 2));

};
main().catch((e) => { console.error(e.message); process.exitCode = 1; });
