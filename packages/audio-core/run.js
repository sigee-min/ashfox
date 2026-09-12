'use strict';
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'CommonJS' } });
require('./tests/program/sound.test');
require('./tests/program/chirp.test');
