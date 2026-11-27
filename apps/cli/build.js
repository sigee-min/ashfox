'use strict';
const path = require('node:path');
const fs = require('node:fs');
const esbuild = require('esbuild');

const repoRoot = path.resolve(__dirname, '../..');
const stableVersion = require('../../scripts/release/stable.json').version;
const stableCli = `https://github.com/sigee-min/ashfox/releases/download/v${stableVersion}/ashfox-cli.tgz`;

const DOC_SOURCES = Object.freeze({
  agent: 'agent.md',
  grammar: 'language/README.md',
  model: 'language/model.md',
  rig: 'language/components.md',
  surface: 'language/textures.md',
  animation: 'guides/animation.md',
  vfx: 'language/vfx.md',
  sprite: 'language/sprites.md',
  sound: 'language/sounds.md',
  structure: 'language/structures.md',
  hooks: 'language/hooks.md',
  sdk: 'guides/sdk.md',
});

const loadDocsBundle = () => {
  const docs = {};
  for (const [topic, relPath] of Object.entries(DOC_SOURCES)) {
    const raw = fs.readFileSync(path.join(repoRoot, 'docs', relPath), 'utf8');
    docs[topic] = raw
      .replaceAll('{{stableCli}}', stableCli)
      .replaceAll('{{stableVersion}}', stableVersion);
  }
  return docs;
};

const loadStdLibraryBundle = () => {
  const stdRoot = path.join(repoRoot, 'library', 'std');
  const entries = {};
  if (!fs.existsSync(stdRoot)) return entries;
  const walk = (directory) => {
    for (const entry of fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.ashfox')) {
        const rel = path
          .relative(stdRoot, full)
          .split(path.sep)
          .join('/')
          .replace(/\.ashfox$/u, '');
        entries[`std/${rel}`] = fs.readFileSync(full, 'utf8');
      }
    }
  };
  walk(stdRoot);
  return entries;
};

const browser = esbuild.buildSync({
  entryPoints: [path.resolve(__dirname, '../../packages/render-core/src/observation/browser.ts')],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  globalName: 'AshfoxObserver',
  write: false,
  minify: true,
});
const devViewer = esbuild.buildSync({
  stdin: {
    contents: "import { mountDevViewer } from '@ashfox/render-core'; mountDevViewer();",
    resolveDir: path.resolve(__dirname, '../../packages/render-core'),
    loader: 'ts',
  },
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  globalName: 'AshfoxDevViewer',
  write: false,
  minify: true,
});
esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'src/main.ts')],
  outfile: path.join(__dirname, 'dist/ashfox.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  define: {
    ASHFOX_VERSION: JSON.stringify(require('../../package.json').version),
    ASHFOX_STARTER: JSON.stringify(require('../../scripts/release/project').projectFiles(repoRoot)),
    ASHFOX_OBSERVER_BUNDLE: JSON.stringify(browser.outputFiles[0].text),
    ASHFOX_DEV_VIEWER_BUNDLE: JSON.stringify(devViewer.outputFiles[0].text),
    ASHFOX_DOCS: JSON.stringify(loadDocsBundle()),
    ASHFOX_STD_LIBRARY: JSON.stringify(loadStdLibraryBundle()),
  },
  banner: { js: '#!/usr/bin/env node' },
});
fs.chmodSync(path.join(__dirname, 'dist/ashfox.cjs'), 0o755);
