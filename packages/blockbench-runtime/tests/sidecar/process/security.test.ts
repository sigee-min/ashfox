import assert from 'node:assert/strict';

import type { Logger } from '../../../src/logging';
import { SidecarProcess } from '../../../src/sidecar/SidecarProcess';
import { noopLog } from '../../helpers';

let errorMeta: Record<string, unknown> | undefined;
const logger: Logger = {
  ...noopLog,
  error: (_message, meta) => {
    errorMeta = meta;
  },
};

const sidecar = new SidecarProcess(
  { host: '0.0.0.0', port: 8787, path: '/mcp' },
  { handle: async () => ({ ok: true, data: {} }) } as never,
  logger,
);

assert.equal(sidecar.start(), false);
assert.equal(errorMeta?.reason, 'non_loopback_token_required');
