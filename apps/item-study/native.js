'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spritePreviewPng, parseSpriteSource, sha256Digest } = require('./engine');
const { readSnapshot, checkSnapshot } = require('@ashfox/asset-build');

function buildWorkspace(file, directory = path.resolve(__dirname, '../../dist/items-native')) {
  const snapshot = readSnapshot(file), compiled = checkSnapshot(snapshot);
  const products = compiled.products.filter(p => p.kind === 'sprite');
  if (!products.length) throw new Error('Workspace has no sprites to view');
  if (new Set(products.map(p => p.sprite.id)).size !== products.length) throw new Error('Studio requires unique sprite ids across packages');
  const key = sha256Digest('native-studio:1:' + snapshot.hash).slice(7);
  fs.mkdirSync(directory, { recursive: true });
  const target = path.join(directory, key + '-' + randomUUID()), pending = fs.mkdtempSync(path.join(directory, '.pending-'));
  try {
    const source = { native: true, files: snapshot.files, items: [], paths: {}, references: {} };
    for (const product of products) {
      const sprite = product.sprite, input = snapshot.files.find(f => f.path === product.sourcePath);
      source.items.push(parseSpriteSource(input.source, input.path).item);
      const refs = new Set();
      const visit = owner => {
        const file = snapshot.files.find(f => f.path === owner);
        for (const dependency of parseSpriteSource(file.source, owner).imports) {
          const relative = path.posix.normalize(path.posix.join(path.posix.dirname(owner), dependency.path));
          if (!refs.has(relative)) { refs.add(relative); visit(relative); }
        }
      };
      visit(input.path); source.references[sprite.id] = [...refs].sort();
      fs.writeFileSync(path.join(pending, `${sprite.id}.source.ashfox`), input.source);
      source.paths[sprite.id] = product.sourcePath;
      fs.writeFileSync(path.join(pending, `${sprite.id}.png`), sprite.png);
      fs.writeFileSync(path.join(pending, `${sprite.id}@16x.png`), spritePreviewPng(sprite.raster));
      for (const [stage, raster] of Object.entries(sprite.stages)) fs.writeFileSync(path.join(pending, `${sprite.id}.${stage}.png`), spritePreviewPng(raster));
      fs.writeFileSync(path.join(pending, `${sprite.id}.evidence.json`), JSON.stringify(sprite.evidence));
    }
    fs.writeFileSync(path.join(pending, 'source.json'), JSON.stringify(source));
    fs.writeFileSync(path.join(pending, 'receipt.json'), JSON.stringify({ key, sourceHash: compiled.sourceHash, items: products.map(p => p.sprite.receipt) }));
    // Each preview is a fresh complete snapshot; presentation is not a compiler cache.
    fs.renameSync(pending, target);
    return { ok: true, key, directory: target, sourceHash: compiled.sourceHash };
  } catch (error) { fs.rmSync(pending, { recursive: true, force: true }); throw error; }
}
module.exports = { buildWorkspace };
