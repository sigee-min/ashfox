'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { compileItemStudy, spritePreviewPng, spriteSheetPng } = require('./engine');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'dist/items');

function buildSource(source, directory = output) {
  const result = compileItemStudy(source);
  if (!result.ok) return result;
  fs.mkdirSync(directory, { recursive: true });
  const key = hash(Buffer.from('presentation-3' + result.sourceHash + hash(Buffer.from(source)) + result.products.map(p => p.receipt.buildKey).join('')));
  const target = path.join(directory, key);
  if (!fs.existsSync(target)) {
    const temp = fs.mkdtempSync(path.join(directory, '.pending-'));
    try {
      fs.writeFileSync(path.join(temp, 'source.items.json'), source);
      const order = ['apple','green_apple','golden_apple','amethyst','ruby_potion','iron_sword','copper_sword','crystal_sword','blue_potion','amber_potion'];
      const sorted = [...result.products].sort((a,b) => {
        const ai=order.indexOf(a.id), bi=order.indexOf(b.id);
        return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || a.id.localeCompare(b.id);
      });
      fs.writeFileSync(path.join(temp, 'sheet.png'), spriteSheetPng(sorted));
      for (const stage of ['silhouette', 'shade', 'grain']) {
        fs.writeFileSync(path.join(temp, `sheet.${stage}.png`), spriteSheetPng(sorted.map(p => ({ ...p, raster: p.stages[stage] }))));
      }
      const entries = [];
      for (const p of result.products) {
        fs.writeFileSync(path.join(temp, `${p.id}.png`), p.png);
        fs.writeFileSync(path.join(temp, `${p.id}@16x.png`), spritePreviewPng(p.raster));
        for (const [stage, raster] of Object.entries(p.stages)) {
          fs.writeFileSync(path.join(temp, `${p.id}.${stage}.png`), spritePreviewPng(raster));
        }
        fs.writeFileSync(path.join(temp, `${p.id}.evidence.json`), JSON.stringify(p.evidence));
        entries.push(p.receipt);
      }
      fs.writeFileSync(path.join(temp, 'receipt.json'), JSON.stringify({ key, sourceHash: result.sourceHash, items: entries }, null, 2) + '\n');
      fs.renameSync(temp, target);
    } catch (error) { fs.rmSync(temp, { recursive: true, force: true }); throw error; }
  }
  return { ok: true, key, directory: target, sourceHash: result.sourceHash };
}
if (require.main === module) {
  const file = process.argv[2] || path.join(root, 'examples/items/.ashfoxworkspace');
  const result = require('./native').buildWorkspace(file);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
module.exports = { buildSource, output, hash };
