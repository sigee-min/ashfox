'use strict';
// The item agent entry point now uses the common native-source CLI contract.
require('../../apps/cli/build');
if (process.argv.length === 2) process.argv.push('capabilities');
require('../../apps/cli/dist/ashfox.cjs');
