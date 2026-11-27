'use strict';

/**
 * CI Doc-Test gate: scans every fenced ```ashfox block in docs/**\/*.md and
 * skills/ashfox/**\/*.md and compiles it against the live compiler + library/std/.
 * Blocks explicitly tagged ```ashfox invalid must fail parsing or compilation.
 */
const fs = require('node:fs');
const path = require('node:path');
const { register } = require('ts-node');
const { compareText } = require('../shared');

const ROOT = path.resolve(__dirname, '..', '..');
const DOC_SCOPES = Object.freeze(['docs', 'skills/ashfox']);
const FENCE_PATTERN = /^(`{3,})ashfox(?:[ \t]+([^\r\n]*))?\r?\n([\s\S]*?)^\1[ \t]*$/gm;

const walkMarkdownFiles = (root = ROOT, scopes = DOC_SCOPES) => {
  const files = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
  };
  for (const scope of scopes) visit(path.join(root, scope));
  return files;
};

const extractAshfoxBlocks = (markdown, fileLabel) => {
  const blocks = [];
  FENCE_PATTERN.lastIndex = 0;
  let match;
  while ((match = FENCE_PATTERN.exec(markdown)) !== null) {
    const line = markdown.slice(0, match.index).split(/\r?\n/).length;
    const flags = (match[2] ?? '').trim().split(/\s+/).filter(Boolean);
    blocks.push({
      file: fileLabel,
      line,
      expectInvalid: flags.includes('invalid'),
      source: match[3],
    });
  }
  return blocks;
};

const loadStdFilesFromDisk = (root = ROOT) => {
  const stdRoot = path.join(root, 'library', 'std');
  const files = [];
  const visit = (directory) => {
    if (!fs.existsSync(directory)) return;
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareText(left.name, right.name));
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.ashfox')) {
        files.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          source: fs.readFileSync(full, 'utf8'),
        });
      }
    }
  };
  visit(stdRoot);
  return files;
};

const BUCKET_BY_KIND = Object.freeze({
  model: 'models',
  sprite: 'sprites',
  sound: 'sounds',
  structure: 'structures',
  compound: 'structures',
  vfx: 'vfx',
});

const singleEntryConfig = (entryName, entryPath) =>
  JSON.stringify({
    format: 'ashfox-workspace',
    version: 2,
    name: 'standalone',
    packages: [
      {
        name: 'standalone',
        root: '',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name: entryName, path: entryPath }],
          modules: [],
          dependencies: [],
        },
      },
    ],
    include: ['**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  });

const compileBlock = (block, engine, stdFiles) => {
  try {
    const inspected = engine.inspectNativeSource(block.source, 'entry.ashfox');
    if (inspected.kind === 'module') {
      return { ok: true, kind: inspected.kind, id: inspected.id };
    }
    const bucket = BUCKET_BY_KIND[inspected.kind] ?? 'models';
    const entryPath = `assets/${bucket}/entry.ashfox`;
    const config = singleEntryConfig(inspected.id, entryPath);
    const compiled = engine.compileDirectoryWorkspace(config, [
      { path: entryPath, source: block.source },
      ...stdFiles,
    ]);
    if (!compiled.ok) {
      const first = compiled.diagnostics[0];
      return {
        ok: false,
        reason: first ? `[${first.code}] ${first.message}` : 'Compilation failed',
      };
    }
    return { ok: true, kind: inspected.kind, id: inspected.id };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
};

const verifyBlocks = (blocks, engine, stdFiles = []) => {
  const failures = [];
  for (const block of blocks) {
    const result = compileBlock(block, engine, stdFiles);
    if (block.expectInvalid && result.ok) {
      failures.push(
        `${block.file}:${block.line}: expected \`\`\`ashfox invalid block to fail, but it compiled (${result.kind} ${result.id})`,
      );
    } else if (!block.expectInvalid && !result.ok) {
      failures.push(`${block.file}:${block.line}: ${result.reason}`);
    }
  }
  return failures;
};

const runDoctest = (root = ROOT) => {
  register({
    transpileOnly: true,
    compilerOptions: { module: 'CommonJS', moduleResolution: 'Node' },
  });
  const engine = require('@ashfox/engine-core');
  const stdFiles = loadStdFilesFromDisk(root);
  const files = walkMarkdownFiles(root, DOC_SCOPES);
  const blocks = files.flatMap((file) =>
    extractAshfoxBlocks(
      fs.readFileSync(file, 'utf8'),
      path.relative(root, file).split(path.sep).join('/'),
    ),
  );
  const failures = verifyBlocks(blocks, engine, stdFiles);
  return { fileCount: files.length, blockCount: blocks.length, failures };
};

const main = () => {
  const { fileCount, blockCount, failures } = runDoctest(ROOT);
  if (failures.length > 0) {
    console.error('ashfox doctest gate failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `ashfox doctest gate ok: ${blockCount} ashfox blocks across ${fileCount} markdown files`,
  );
};

if (require.main === module) main();

module.exports = Object.freeze({
  extractAshfoxBlocks,
  loadStdFilesFromDisk,
  verifyBlocks,
  walkMarkdownFiles,
});
