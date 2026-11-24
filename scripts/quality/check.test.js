'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { readDevelopmentManifest } = require('./manifest');
const {
  dependencyPolicyViolations,
  importBoundaryViolations,
  tombstoneViolations,
  workspacePolicyViolations,
} = require('./repositoryPolicyGate');
const { assertSourcePatternRegistryMatches, sourcePatternFindings } = require('./patterns');

const repoRoot = path.resolve(__dirname, '..', '..');
const manifest = readDevelopmentManifest(repoRoot);
const prettierConfig = require('../../config/prettier.config');

// Prettier owns formatting; its options must stay derived from the manifest style.
assert.equal(manifest.engineering.style.formatter, 'prettier');
assert.equal(prettierConfig.printWidth, manifest.engineering.style.printWidth);
assert.equal(prettierConfig.tabWidth, manifest.engineering.style.indentSpaces);
assert.equal(prettierConfig.singleQuote, manifest.engineering.style.quotes === 'single');
assert.equal(prettierConfig.semi, manifest.engineering.style.semicolons === 'required');

assert.deepEqual(
  tombstoneViolations(['apps/removed/package.json', 'packages/removed/package.json'], (value) =>
    value.startsWith('apps/'),
  ),
  ['quality: removed boundary restored: apps/removed/package.json'],
);

assert.deepEqual(
  workspacePolicyViolations(['apps/forbidden'], {
    required: ['apps/required'],
    forbidden: ['apps/forbidden'],
  }),
  [
    'quality: forbidden workspace restored: apps/forbidden',
    'quality: required workspace is missing: apps/required',
  ],
);

assert.deepEqual(
  dependencyPolicyViolations(
    new Map([
      [
        'apps/site',
        {
          dependencies: {
            '@ashfox/internal-contracts': '0.0.0',
            react: '1.0.0',
          },
        },
      ],
      [
        'apps/cli',
        {
          dependencies: {
            '@ashfox/blockbench-runtime': '0.0.0',
            three: '1.0.0',
          },
        },
      ],
    ]),
    [
      {
        workspace: 'apps/site',
        sections: ['dependencies'],
        mode: 'allow-only',
        values: ['@ashfox/internal-contracts'],
      },
      {
        workspace: 'apps/cli',
        sections: ['dependencies'],
        mode: 'deny-prefixes',
        values: ['@ashfox/blockbench-'],
      },
    ],
  ),
  [
    'quality: apps/site cannot depend on react',
    'quality: apps/cli cannot depend on @ashfox/blockbench-runtime',
  ],
);

const boundary = {
  source: 'apps/site/',
  allowedExternalImports: ['@ashfox/internal-contracts'],
  forbiddenExternalPrefixes: ['@ashfox/'],
  forbiddenExternalPackageRoots: ['react', 'three'],
  forbiddenRelativeTargets: ['apps/cli/', 'packages/engine-core/'],
};
assert.deepEqual(
  importBoundaryViolations({
    repoRoot: '/repo',
    filePath: '/repo/apps/site/src/page.js',
    specifiers: [
      '@ashfox/internal-contracts',
      '@ashfox/engine-core',
      'react/jsx-runtime',
      '../../cli/src/main',
    ],
    boundary,
  }),
  [
    'quality: apps/site/ crosses product boundary in ' +
      'apps/site/src/page.js: @ashfox/engine-core',
    'quality: apps/site/ crosses product boundary in ' + 'apps/site/src/page.js: react/jsx-runtime',
    'quality: apps/site/ crosses product boundary in apps/site/src/page.js',
  ],
);

const sourcePolicies = manifest.quality.forbiddenSourcePatterns;
assert.doesNotThrow(() => assertSourcePatternRegistryMatches(sourcePolicies));
assert.throws(
  () => assertSourcePatternRegistryMatches(sourcePolicies.slice(1)),
  /do not match development-manifest\.json/,
);

const sourceRulesFor = (file, source) =>
  sourcePatternFindings(path.join(repoRoot, file), file, source, sourcePolicies).map(
    (finding) => finding.rule,
  );
assert.deepEqual(
  sourceRulesFor('packages/blockbench-runtime/src/logging.ts', "console.log('allowed');\n"),
  [],
);
assert.ok(
  sourceRulesFor(
    'packages/blockbench-runtime/src/usecases/example.ts',
    "console.log('blocked');\n",
  ).includes('console-in-src'),
);
assert.deepEqual(sourceRulesFor('docs/example.ts', "console.log('outside');\n"), []);
const unsafeRules = sourceRulesFor(
  'packages/engine-core/src/example.ts',
  'const value: any = input as unknown as string;\n',
);
assert.ok(unsafeRules.includes('explicit-any'));
assert.ok(unsafeRules.includes('double-assertion'));

console.log('ashfox quality fixture tests ok');
