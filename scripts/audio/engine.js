'use strict';
// Host bridge to the same pure compiler used by the shared asset pipeline.
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' } });
module.exports = require('../../packages/audio-core/src');
