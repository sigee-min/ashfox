'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { compileSoundSource } = require('./engine');
try {
  const products = Object.keys(workerData).sort().flatMap((file) => compileSoundSource(workerData[file], file).map((product) => ({ file, product })));
  parentPort.postMessage({ ok: true, value: products });
} catch (error) {
  parentPort.postMessage({ ok: false, message: error.message, code: 'sound.compile' });
}
