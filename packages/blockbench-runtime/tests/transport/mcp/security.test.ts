import assert from 'node:assert/strict';

import { validateIngressSecurity } from '../../../src/transport/mcp/ingressSecurity';
import type { HttpRequest, McpServerConfig } from '../../../src/transport/mcp/types';

const config: McpServerConfig = {
  path: '/mcp',
  endpoint: { host: '127.0.0.1', port: 8787 },
};

const request = (headers: Record<string, string>): HttpRequest => ({
  method: 'POST',
  url: '/mcp',
  headers,
  body: '{}',
});

assert.equal(validateIngressSecurity(request({ host: 'localhost:8787' }), config), null);
assert.equal(validateIngressSecurity(request({ host: '127.9.8.7:8787' }), config), null);
assert.equal(validateIngressSecurity(request({ host: '[::1]:8787' }), config), null);
assert.equal(validateIngressSecurity(request({}), config)?.code, 'host_required');
assert.equal(
  validateIngressSecurity(request({ host: 'attacker.example:8787' }), config)?.code,
  'host_not_allowed',
);
assert.equal(
  validateIngressSecurity(request({ host: 'localhost:8788' }), config)?.code,
  'host_not_allowed',
);
assert.equal(
  validateIngressSecurity(
    request({
      host: 'localhost:8787',
      origin: 'http://attacker.example:8787',
    }),
    config,
  )?.code,
  'origin_not_allowed',
);
assert.equal(
  validateIngressSecurity(
    request({
      host: 'localhost:8787',
      origin: 'http://localhost:8787',
    }),
    config,
  ),
  null,
);

const tokenConfig: McpServerConfig = { ...config, token: 'secret' };
assert.equal(
  validateIngressSecurity(
    request({
      host: 'localhost:8787',
      origin: 'https://trusted.example',
      authorization: 'Bearer secret',
    }),
    tokenConfig,
  ),
  null,
);
assert.equal(
  validateIngressSecurity(
    request({
      host: 'attacker.example:8787',
      origin: 'https://trusted.example',
      authorization: 'Bearer secret',
    }),
    tokenConfig,
  )?.code,
  'host_not_allowed',
);
