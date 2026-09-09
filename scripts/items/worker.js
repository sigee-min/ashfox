'use strict';
const { parentPort, workerData } = require('node:worker_threads');
const { buildSource } = require('./build');
parentPort.postMessage(buildSource(workerData.source, workerData.output));
