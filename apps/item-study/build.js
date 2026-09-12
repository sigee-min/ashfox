'use strict';
const path = require('node:path');
const { buildWorkspace } = require('./native');
const input = process.argv[2] || path.resolve(__dirname, '../../examples/items/.ashfoxworkspace');
console.log(JSON.stringify(buildWorkspace(input), null, 2));
