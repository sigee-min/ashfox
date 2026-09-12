'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { hash, validate } = require('./storage');
const { compileSoundSource, measure, AUDIO_POLICY } = require('./engine');
// The shared core owns syntax, variant streams, synthesis, mastering and WAV.
// This host adapter only writes artifacts and optionally encodes the viewer's OGG.
const compile = async (files, directory) => {
  validate(files);
  const encoder = process.env.ASHFOX_FFMPEG_PATH || 'ffmpeg';
  const execute = (args) => execFileSync(encoder, args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024 });
  const encoderVersion = execute(['-version']).toString().split('\n')[0];
  fs.mkdirSync(directory, { recursive: true });
  const entries = [];
  for (const file of Object.keys(files).sort()) for (const product of compileSoundSource(files[file], file)) {
    const name = `${product.id}/${product.variant}`, wavName = name + '.wav', oggName = name + '.ogg';
    fs.mkdirSync(path.join(directory, product.id), { recursive: true });
    const wav = Buffer.from(product.wav);
    fs.writeFileSync(path.join(directory, wavName), wav);
    execute(['-v', 'error', '-y', '-i', path.join(directory, wavName), '-map_metadata', '-1', '-ac', '1', '-c:a', 'libvorbis', '-q:a', '5', path.join(directory, oggName)]);
    const ogg = fs.readFileSync(path.join(directory, oggName));
    const decoded = execute(['-v', 'error', '-i', path.join(directory, oggName), '-f', 'f32le', '-ac', '1', '-ar', '48000', 'pipe:1']);
    const decodedPcm = Float64Array.from({ length: decoded.length / 4 }, (_, i) => decoded.readFloatLE(i * 4));
    const stats = measure(decodedPcm);
    if (stats.peak >= 1 || Math.abs(decodedPcm.length - product.frames) > 1024) throw new Error('Encoded output exceeds peak/duration limits');
    entries.push({ sound: product.id, variant: product.variant, wav: wavName, ogg: oggName, wavHash: hash(wav), oggHash: hash(ogg),
      sourceHash: hash(files[file]), samples: product.frames, sampleRate: product.sampleRate, peak: product.peak, rms: product.rms, dc: product.dc, decodedPeak: stats.peak });
  }
  const dspHash = hash(AUDIO_POLICY);
  const receipt = { format: 'ashfox-audio-build', version: 1, sourceHash: hash(files), dspHash, node: process.version, encoderVersion, entries };
  fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
};
module.exports = { compile };
