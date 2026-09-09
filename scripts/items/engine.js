'use strict';
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });
module.exports = require('../../packages/engine-core/src/index');
