const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  dependencyCycles,
  dependencyDirectionViolations,
  dependencyGraph,
  sourceSizeHistoryViolations,
  sourceSizeRatchetViolations
} = require('./architecture');
const {
  codeFileStemViolations,
  ownerContractViolations,
  testFileLineViolations,
  testLayoutViolations
} = require('./layout');
const {
  readHistoricalSourceSizeBaselines
} = require('./sourceSizeRatchet');

const repoRoot = path.resolve(__dirname, '..', '..');
const engineIndex = path.join(
  repoRoot,
  'packages/engine-core/src/index.ts'
);
const runtimeLogging = path.join(
  repoRoot,
  'packages/blockbench-runtime/src/logging.ts'
);
const aliasCycle = dependencyGraph(
  [engineIndex, runtimeLogging],
  new Map([
    [
      engineIndex,
      "import '@ashfox/blockbench-runtime/logging';"
    ],
    [runtimeLogging, "import '@ashfox/engine-core';"]
  ])
);
assert.equal(
  dependencyCycles(aliasCycle).length,
  1,
  'workspace alias imports must participate in cycle detection'
);

assert.deepEqual(
  codeFileStemViolations([
    'packages/example/src/owner/contract.ts',
    'packages/example/tests/repeatedOwnerPrefixThatIsTooLong.test.ts'
  ], 20),
  [{
    file: 'packages/example/tests/repeatedOwnerPrefixThatIsTooLong.test.ts',
    length: 32,
    maximumLength: 20
  }],
  'owner folders keep source filename stems inside the manifest limit'
);

assert.deepEqual(
  ownerContractViolations([
    'packages/example/src/owner/contract.ts',
    'packages/example/src/owner/exampleContract.ts',
    'packages/example/src/exampleContract/reader.ts',
    'packages/example/src/owner/exampleContracts.ts',
    'packages/example/src/owner/example-contract.ts',
    'packages/example/src/example-contracts/reader.ts'
  ], 'contract'),
  [
    {
      file: 'packages/example/src/owner/exampleContract.ts',
      reason: 'contract files must be named contract'
    },
    {
      file: 'packages/example/src/exampleContract/reader.ts',
      reason: 'contract owner directory repeats its role: exampleContract'
    },
    {
      file: 'packages/example/src/owner/exampleContracts.ts',
      reason: 'contract files must be named contract'
    },
    {
      file: 'packages/example/src/owner/example-contract.ts',
      reason: 'contract files must be named contract'
    },
    {
      file: 'packages/example/src/example-contracts/reader.ts',
      reason: 'contract owner directory repeats its role: example-contracts'
    }
  ],
  'contract responsibility belongs to an owner contract.ts file'
);

const testLayoutPolicy = {
  testFileSuffix: '.test',
  testFileExtension: '.ts',
  testFileStem: 'lower-word',
  maxTestFileStemLength: 18,
  maxTestFileLines: 500,
  testOwners: [{
    workspace: 'packages/example',
    roots: ['texture']
  }]
};

assert.deepEqual(
  testFileLineViolations([
    { file: 'packages/example/tests/texture/ok.test.ts', lines: 500 },
    { file: 'packages/example/tests/texture/large.test.ts', lines: 501 },
    { file: 'packages/example/tests/texture/fixture.ts', lines: 900 }
  ], 500),
  [{
    file: 'packages/example/tests/texture/large.test.ts',
    lines: 501,
    maximumLines: 500
  }],
  'test size limits apply to executable tests without constraining fixtures'
);
assert.deepEqual(
  testLayoutViolations([
    'packages/example/tests/root.test.ts',
    'packages/example/tests/texture/textureRaster.test.ts',
    'packages/example/tests/texture/overlyDescriptiveRasterName.test.ts',
    'packages/example/tests/texture/role-mask.test.ts',
    'packages/example/tests/texture/runtime.test.js',
    'packages/example/tests/unowned/reader.test.ts',
    'packages/example/tests/support/supportReader.ts',
    'packages/example/tests/support/overlyDescriptiveHelperName.ts',
    'packages/example/tests/texture/raster.test.ts'
  ], testLayoutPolicy),
  [
    {
      file: 'packages/example/tests/root.test.ts',
      reason: 'test must live under an owner directory'
    },
    {
      file: 'packages/example/tests/texture/textureRaster.test.ts',
      reason: 'test stem must be one lowercase word'
    },
    {
      file: 'packages/example/tests/texture/textureRaster.test.ts',
      reason: 'test stem repeats owner prefix: texture'
    },
    {
      file: 'packages/example/tests/texture/overlyDescriptiveRasterName.test.ts',
      reason: 'test stem has 27 characters (max 18)'
    },
    {
      file: 'packages/example/tests/texture/overlyDescriptiveRasterName.test.ts',
      reason: 'test stem must be one lowercase word'
    },
    {
      file: 'packages/example/tests/texture/role-mask.test.ts',
      reason: 'test stem must be one lowercase word'
    },
    {
      file: 'packages/example/tests/texture/runtime.test.js',
      reason: 'test files must use .test.ts'
    },
    {
      file: 'packages/example/tests/unowned/reader.test.ts',
      reason: 'undeclared test owner: unowned'
    },
    {
      file: 'packages/example/tests/support/supportReader.ts',
      reason: 'test stem must be one lowercase word'
    },
    {
      file: 'packages/example/tests/support/supportReader.ts',
      reason: 'test stem repeats owner prefix: support'
    },
    {
      file: 'packages/example/tests/support/overlyDescriptiveHelperName.ts',
      reason: 'test stem has 27 characters (max 18)'
    },
    {
      file: 'packages/example/tests/support/overlyDescriptiveHelperName.ts',
      reason: 'test stem must be one lowercase word'
    }
  ],
  'tests and their support code use short owner-scoped lowercase filenames'
);

assert.deepEqual(
  sourceSizeRatchetViolations([
    { file: 'apps/cli/src/new-large.ts', lines: 501 },
    { file: 'apps/cli/src/existing-large.ts', lines: 520 },
    { file: 'apps/cli/src/shrunk.ts', lines: 499 }
  ], {
    'apps/cli/src/existing-large.ts': 519,
    'apps/cli/src/shrunk.ts': 550,
    'apps/cli/src/missing.ts': 530
  }, 500),
  [
    {
      file: 'apps/cli/src/new-large.ts',
      lines: 501,
      baseline: null,
      allowed: 500,
      reason: 'new source file exceeds the ratchet threshold'
    },
    {
      file: 'apps/cli/src/existing-large.ts',
      lines: 520,
      baseline: 519,
      allowed: 519,
      reason: 'source file grew beyond its committed baseline'
    },
    {
      file: 'apps/cli/src/shrunk.ts',
      lines: 499,
      baseline: 550,
      allowed: 500,
      reason: 'baseline entry must be removed after crossing the threshold'
    },
    {
      file: 'apps/cli/src/missing.ts',
      lines: 0,
      baseline: 530,
      allowed: 500,
      reason: 'baseline entry refers to a missing source file'
    }
  ],
  'source size ratchet rejects growth and stale baseline entries'
);

assert.deepEqual(
  sourceSizeRatchetViolations([
    { file: 'apps/cli/src/shrunk-large.ts', lines: 510 }
  ], {
    'apps/cli/src/shrunk-large.ts': 520
  }, 500),
  [{
    file: 'apps/cli/src/shrunk-large.ts',
    lines: 510,
    baseline: 520,
    allowed: 510,
    reason: 'committed baseline must be lowered to the current size'
  }],
  'source size ratchet requires every reduction to lower its baseline'
);

assert.deepEqual(
  sourceSizeRatchetViolations([
    { file: 'apps/cli/src/existing-large.ts', lines: 519 }
  ], {
    'apps/cli/src/existing-large.ts': 519
  }, 500),
  [],
  'source size ratchet accepts an unchanged committed baseline'
);

assert.deepEqual(
  sourceSizeHistoryViolations({
    'apps/cli/src/existing-large.ts': 520,
    'apps/cli/src/new-large.ts': 510,
    'apps/cli/src/reintroduced.ts': 505
  }, [
    {
      'apps/cli/src/existing-large.ts': 519,
      'apps/cli/src/reintroduced.ts': 530
    },
    {
      'apps/cli/src/existing-large.ts': 521
    }
  ], 500),
  [
    {
      file: 'apps/cli/src/existing-large.ts',
      lines: 520,
      baseline: 520,
      allowed: 519,
      reason: 'baseline increased relative to repository history'
    },
    {
      file: 'apps/cli/src/new-large.ts',
      lines: 510,
      baseline: 510,
      allowed: 500,
      reason: 'baseline entry is new or was previously removed'
    },
    {
      file: 'apps/cli/src/reintroduced.ts',
      lines: 505,
      baseline: 505,
      allowed: 500,
      reason: 'baseline entry is new or was previously removed'
    }
  ],
  'history ratchet rejects baseline growth, new keys, and reintroduced keys'
);

assert.deepEqual(
  sourceSizeHistoryViolations({
    'apps/cli/src/existing-large.ts': 510
  }, [
    { 'apps/cli/src/existing-large.ts': 519 },
    { 'apps/cli/src/existing-large.ts': 521 }
  ], 500),
  [],
  'history ratchet accepts monotonic baseline reductions'
);

const historyFixtureRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ashfox-size-history-')
);
const historyBaselinePath = path.join(
  historyFixtureRoot,
  'scripts/quality/source-size-baseline.json'
);
const runFixtureGit = (...args) => execFileSync('git', args, {
  cwd: historyFixtureRoot,
  stdio: 'ignore'
});
try {
  fs.mkdirSync(path.dirname(historyBaselinePath), { recursive: true });
  runFixtureGit('init');
  runFixtureGit('config', 'user.email', 'quality@ashfox.invalid');
  runFixtureGit('config', 'user.name', 'ashfox quality');
  fs.writeFileSync(historyBaselinePath, JSON.stringify({ legacy: 530 }));
  runFixtureGit('add', '.');
  runFixtureGit('commit', '-m', 'initial baseline');
  fs.rmSync(historyBaselinePath);
  runFixtureGit('add', '-u');
  runFixtureGit('commit', '-m', 'remove baseline');
  fs.writeFileSync(historyBaselinePath, JSON.stringify({ legacy: 505 }));
  runFixtureGit('add', '.');
  runFixtureGit('commit', '-m', 'reintroduce baseline');
  const history = readHistoricalSourceSizeBaselines({
    repoRoot: historyFixtureRoot,
    baselinePath: historyBaselinePath,
    currentBaseline: { legacy: 505 }
  });
  assert.deepEqual(
    history,
    [{}, { legacy: 530 }],
    'Git history reader preserves deletion commits as absent baselines'
  );
  assert.equal(
    sourceSizeHistoryViolations({ legacy: 505 }, history, 500).length,
    1,
    'a removed baseline entry cannot be reintroduced below its old allowance'
  );
} finally {
  fs.rmSync(historyFixtureRoot, { recursive: true, force: true });
}

const projectSource = path.join(
  repoRoot,
  'packages/engine-core/src/project/program/asset/parse.ts'
);
const compilerTarget = path.join(
  repoRoot,
  'packages/engine-core/src/compiler/program/asset/instantiate.ts'
);
const aliasInversion = dependencyGraph(
  [projectSource, compilerTarget],
  new Map([
    [
      projectSource,
      "import '@ashfox/engine-core/compiler/program/asset/instantiate';"
    ],
    [compilerTarget, '']
  ])
);
assert.equal(
  dependencyDirectionViolations(aliasInversion).length,
  1,
  'workspace alias imports must participate in layer checks'
);

const constraintSource = path.join(
  repoRoot,
  'packages/engine-core/src/project/program/asset/parse.ts'
);
const tokenReaderTarget = path.join(
  repoRoot,
  'packages/engine-core/src/compiler/program/asset/instantiate.ts'
);
const constraintReaderInversion = dependencyGraph(
  [constraintSource, tokenReaderTarget],
  new Map([
    [constraintSource,
      "import '../../../compiler/program/asset/instantiate';"],
    [tokenReaderTarget, '']
  ])
);
assert.deepEqual(
  dependencyDirectionViolations(constraintReaderInversion),
  [{
    source: 'packages/engine-core/src/project/program/asset/parse.ts',
    target:
      'packages/engine-core/src/compiler/program/asset/instantiate.ts'
  }],
  'the project parser cannot depend on compiler planning'
);

console.log('ashfox architecture fixture tests ok');
