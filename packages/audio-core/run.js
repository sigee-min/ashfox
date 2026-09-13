'use strict';
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });
const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(__dirname, 'tests/program');
const tests = fs.readdirSync(directory).filter(file => file.endsWith('.test.ts')).sort();
if (!tests.length) throw new Error('No audio tests found');
for (const file of tests) require(path.join(directory, file));
