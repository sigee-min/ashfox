'use strict';

const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { compareText } = require('@ashfox/internal-contracts');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

module.exports = Object.freeze({
  compareText,
  readJson,
  sha256,
});
