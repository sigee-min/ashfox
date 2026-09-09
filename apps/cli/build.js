'use strict';
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');
const browser = esbuild.buildSync({entryPoints:[path.resolve(__dirname,'../../packages/render-core/src/observation/browser.ts')], bundle:true, platform:'browser', target:'es2020', format:'iife', globalName:'AshfoxObserver', write:false, minify:true});
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src/main.ts')],
  outfile: path.join(__dirname, 'dist/ashfox.cjs'),
  bundle: true, platform: 'node', target: 'node20', format: 'cjs',
  define: {ASHFOX_OBSERVER_BUNDLE: JSON.stringify(browser.outputFiles[0].text)},
  banner: { js: '#!/usr/bin/env node' }
});
fs.chmodSync(path.join(__dirname, 'dist/ashfox.cjs'), 0o755);
