'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash, validate } = require('./storage');
const { measure, AUDIO_POLICY } = require('./engine');
// The shared core owns syntax, variant streams, synthesis, mastering and WAV.
// This host adapter writes artifacts and runs built-in WASM Vorbis encoding/decoding.
const { runJob, createVorbisEncoder, decodeVorbis } = require('@ashfox/asset-build');
const compile = async (files, directory, signal) => {
  validate(files);
  const products = await runJob(path.join(__dirname, 'synthesis.js'), files, signal);
  const hasOneshot = products.some(({ product }) => product.playback.kind === 'oneshot');
  const encoder = hasOneshot ? await createVorbisEncoder(signal) : null;
  const encoderVersion = encoder ? encoder.fingerprint : null;
  fs.mkdirSync(directory, { recursive: true });
  const entries = [];
  for (const { file, product } of products) {
    const name = `${product.id}/${product.variant}`,
      wavName = name + '.wav',
      oggName = name + '.ogg';
    fs.mkdirSync(path.join(directory, product.id), { recursive: true });
    const wav = Buffer.from(product.wav);
    fs.writeFileSync(path.join(directory, wavName), wav);
    let encoded = {};
    if (product.playback.kind === 'oneshot') {
      const ogg = Buffer.from(await encoder.encode(wav));
      fs.writeFileSync(path.join(directory, oggName), ogg);
      const decoded = await decodeVorbis(ogg);
      const decodedPcm = Float64Array.from(decoded.samples);
      const stats = measure(decodedPcm);
      if (stats.peak >= 1 || Math.abs(decodedPcm.length - product.frames) > 1024)
        throw new Error('Encoded output exceeds peak/duration limits');
      encoded = { ogg: oggName, oggHash: hash(ogg), decodedPeak: stats.peak };
    }
    entries.push({
      sound: product.id,
      variant: product.variant,
      wav: wavName,
      wavHash: hash(wav),
      ...encoded,
      playback: product.playback,
      rawFrames: product.rawFrames,
      seamDelta: product.seamDelta,
      maxAdjacentDelta: product.maxAdjacentDelta,
      sourceHash: hash(files[file]),
      samples: product.frames,
      sampleRate: product.sampleRate,
      peak: product.peak,
      rms: product.rms,
      dc: product.dc,
    });
  }
  const dspHash = hash(AUDIO_POLICY);
  const receipt = {
    format: 'ashfox-audio-build',
    version: 1,
    sourceHash: hash(files),
    dspHash,
    node: process.version,
    encoderVersion,
    entries,
  };
  fs.writeFileSync(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
};
module.exports = { compile };
