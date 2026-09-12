const esbuild = require('esbuild');
const path = require('path');

const repoRoot = path.resolve(__dirname, '../..');

const buildPlugin = () =>
  esbuild.build({
    entryPoints: [
      path.join(repoRoot, 'apps/blockbench-plugin/src/index.ts')
    ],
    outfile: path.join(repoRoot, 'dist/ashfox.js'),
    bundle: true,
    sourcemap: true,
    platform: 'browser',
    format: 'iife',
    target: ['es2020'],
    logLevel: 'info'
  });

const buildSidecar = () =>
  esbuild.build({
    entryPoints: [
      path.join(repoRoot, 'apps/blockbench-mcp-sidecar/src/index.ts')
    ],
    outfile: path.join(repoRoot, 'dist/ashfox-sidecar.js'),
    bundle: true,
    sourcemap: true,
    platform: 'node',
    format: 'cjs',
    target: ['es2020'],
    logLevel: 'info'
  });

Promise.all([buildPlugin(), buildSidecar()])
  .then(() => {
    console.log('blockbench compatibility build ok');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
