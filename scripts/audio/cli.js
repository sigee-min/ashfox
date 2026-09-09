'use strict';
const path = require('node:path');
const { execute } = require('./harness');
const root = process.env.ASHFOX_AUDIO_STORE || path.resolve(__dirname, '../../.ashfox/audio-native');
let data = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  data += chunk;
  if (Buffer.byteLength(data) > 10 * 1024 * 1024) { process.stderr.write('Request exceeds 10 MiB\n'); process.exit(1); }
});
process.stdin.on('end', async () => {
  try { process.stdout.write(JSON.stringify({ ok: true, result: await execute(root, JSON.parse(data)) }) + '\n'); }
  catch (e) { process.stdout.write(JSON.stringify({ ok: false, error: { code: e.code || 'build.failed', pointer: e.pointer || '/', message: e.message } }) + '\n'); process.exitCode = 1; }
});
