import assert from 'node:assert/strict';

import { validateServerConfig } from '../../src/serverConfig';

for (const host of ['localhost', '127.0.0.1', '127.12.34.56', '::1', '[::1]', '0:0:0:0:0:0:0:1']) {
  assert.equal(
    validateServerConfig({
      host,
      port: 8787,
      path: '/mcp',
    }).ok,
    true,
    host,
  );
}

for (const host of ['0.0.0.0', '192.168.1.20', 'example.test', '::']) {
  const rejected = validateServerConfig({ host, port: 8787, path: '/mcp' });
  assert.equal(rejected.ok, false, host);
  if (!rejected.ok) assert.equal(rejected.reason, 'non_loopback_token_required', host);
  assert.equal(
    validateServerConfig({
      host,
      port: 8787,
      path: '/mcp',
      token: 'explicit-secret',
    }).ok,
    true,
    host,
  );
}

{
  const result = validateServerConfig({
    host: ' 0.0.0.0 ',
    port: 8787,
    path: ' mcp/ ',
    token: ' explicit-secret ',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.config, {
      host: '0.0.0.0',
      port: 8787,
      path: '/mcp',
      token: 'explicit-secret',
    });
  }
}

for (const port of [0, 65536, 8787.5, Number.NaN, '8787']) {
  const result = validateServerConfig({ host: '127.0.0.1', port, path: '/mcp' });
  assert.equal(result.ok, false, String(port));
  if (!result.ok) assert.equal(result.reason, 'port_out_of_range');
}

{
  const result = validateServerConfig({ host: '0.0.0.0', port: 8787, path: '/mcp', token: '   ' });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'non_loopback_token_required');
}

for (const input of [null, undefined, 'not-an-object']) {
  const result = validateServerConfig(input);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'host_required');
}
