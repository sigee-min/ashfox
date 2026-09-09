import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const executable = process.env.ASHFOX_CLI ?? require.resolve('@ashfox/cli/dist/ashfox.cjs');
const child = spawn(process.execPath, [executable, 'stdio'], { stdio: ['pipe', 'pipe', 'inherit'] });
let nextId = 0, buffer = '';
const pending = new Map();
const fail = error => { for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); } pending.clear(); };
child.on('error', fail);
child.on('exit', code => fail(new Error(`CLI exited (${code})`)));
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  buffer += chunk;
  if (buffer.length > 48 * 1024 * 1024) { fail(new Error('Response too large')); child.kill(); return; }
  let end;
  while ((end = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    try {
      const reply = JSON.parse(line), item = pending.get(reply.id);
      if (reply.format !== 'ashfox-observer' || reply.version !== 1 || !item) throw new Error('Unexpected response');
      clearTimeout(item.timer); pending.delete(reply.id);
      if (reply.ok) item.resolve(reply.result); else item.reject(new Error(`${reply.error.code}: ${reply.error.message}`));
    } catch (error) { fail(error); child.kill(); }
  }
});
function request(method, params = {}) {
  const id = String(++nextId);
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Request timed out')); child.kill(); }, 150000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => { if (error) fail(error); });
  });
  return { id, result };
}
const call = (method, params) => request(method, params).result;
const decode = media => {
  if (media.encoding !== 'base64') throw new Error('Expected base64 media');
  const bytes = Buffer.from(media.data, 'base64');
  if (bytes.length !== media.byteLength || createHash('sha256').update(bytes).digest('hex') !== media.sha256) throw new Error('Media integrity mismatch');
  return bytes;
};
try {
  const file = process.argv[2];
  if (!file) throw new Error('Usage: node client.mjs path/to/asset.ashfox [--cancel-demo]');
  await call('load', { input: { file: path.resolve(file) } });
  const source = await call('source');
  if (!source.files.length) throw new Error('Use a native source for this editing example');
  // Replace the complete memory graph. The trailing newline is a harmless example edit.
  const entry = source.files.find(f => /\b(?:asset|sprite|sound)\s/.test(f.source) && !/^ashfox-model 1\s+module\b/.test(f.source));
  if (!entry || entry.path.includes('/')) throw new Error('Example expects an entry at the graph root');
  await call('load', { expectedRevision: source.revision, input: {
    name: entry.path, source: entry.source + '\n',
    files: Object.fromEntries(source.files.filter(f => f !== entry).map(f => [f.path, f.source]))
  } });
  if (process.argv.includes('--cancel-demo')) {
    const rendering = request('capture');
    const outcome = rendering.result.catch(error => ({ error: error.message }));
    await call('cancel', { id: rendering.id });
    await outcome; // Cancellation can race completion; either outcome is handled.
  }
  const media = await call('capture', { options: { background: 'checker' } });
  const png = decode(media); // Use this Buffer directly in your viewer or agent.
  if (process.stdout.isTTY) throw new Error('Redirect stdout to a PNG file or pipe to an image consumer');
  await new Promise((resolve, reject) => process.stdout.write(png, error => error ? reject(error) : resolve()));
  await call('close');
} catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
finally { child.stdin.end(); if (pending.size) child.kill(); }
