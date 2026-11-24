import assert from 'node:assert/strict';

import { resolveSidecarServerConfig } from '../../src/sidecar/cliConfig';

{
  const result = resolveSidecarServerConfig([]);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.config.host, '127.0.0.1');
}

{
  const result = resolveSidecarServerConfig(['--host', '0.0.0.0']);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'non_loopback_token_required');
}

{
  const result = resolveSidecarServerConfig([
    '--host',
    '0.0.0.0',
    '--port',
    '9444',
    '--path',
    'agent/',
    '--token',
    ' explicit-secret ',
  ]);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.config, {
      host: '0.0.0.0',
      port: 9444,
      path: '/agent',
      token: 'explicit-secret',
    });
  }
}

for (const port of ['8787garbage', '8787.5', '0', '65536']) {
  const result = resolveSidecarServerConfig(['--port', port]);
  assert.equal(result.ok, false, port);
  if (!result.ok) assert.equal(result.reason, 'port_out_of_range', port);
}

{
  const result = resolveSidecarServerConfig(['--host', '0.0.0.0', '--token', '--path', '/mcp']);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, 'non_loopback_token_required');
}
