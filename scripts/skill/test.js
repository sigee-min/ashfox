const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION,
  buildSkillRelease,
  portableFiles,
  releaseFiles,
  sha256
} = require('./build');
const { unzipSync } = require('fflate');

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-skill-'));
const secondOutput = fs.mkdtempSync(
  path.join(os.tmpdir(), 'ashfox-skill-repeat-')
);
try {
  const descriptor = buildSkillRelease(output);
  assert.equal(
    descriptor.schemaVersion,
    SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION
  );
  assert.equal(descriptor.name, 'ashfox');
  assert.deepEqual(
    descriptor.files.map((entry) => entry.path),
    releaseFiles
  );
  assert.equal(
    descriptor.specificationUrl,
    'https://agentskills.io/specification'
  );
  assert.deepEqual(
    descriptor.installTargets.map((target) => target.client),
    [
      'agent-skills',
      'claude-code',
      'cursor',
      'github-copilot',
      'gemini-cli',
      'codex'
    ]
  );
  for (const entry of descriptor.files) {
    const data = fs.readFileSync(
      path.join(output, 'skills', 'ashfox', 'files', entry.path)
    );
    assert.equal(data.length, entry.bytes);
    assert.equal(sha256(data), entry.sha256);
    assert.equal(new URL(entry.url).origin, 'https://ashfox.io');
  }
  const skillPackage = fs.readFileSync(
    path.join(output, 'skills', 'ashfox', 'ashfox.skill')
  );
  const claudePackage = fs.readFileSync(
    path.join(output, 'skills', 'ashfox', 'ashfox.zip')
  );
  assert.deepEqual(skillPackage, claudePackage);
  assert.equal(
    sha256(skillPackage),
    descriptor.packages.agentSkill.sha256
  );
  buildSkillRelease(secondOutput);
  assert.deepEqual(
    skillPackage,
    fs.readFileSync(
      path.join(secondOutput, 'skills', 'ashfox', 'ashfox.skill')
    ),
    'portable packages must be reproducible across builds'
  );
  const archive = unzipSync(new Uint8Array(skillPackage));
  assert.deepEqual(
    Object.keys(archive).sort(),
    portableFiles.map((relative) => `ashfox/${relative}`).sort()
  );
  assert.ok(archive['ashfox/SKILL.md']);
  assert.equal(archive['ashfox/agents/openai.yaml'], undefined);
  const python = spawnSync(
    'python3',
    [
      '-c',
      [
        'from pathlib import Path',
        'source = Path("skills/ashfox/scripts/sync.py").read_text()',
        'compile(source, "sync.py", "exec")'
      ].join('; ')
    ],
    { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }
  );
  assert.equal(python.status, 0, python.stderr);
  const syncSimulation = spawnSync(
    'python3',
    ['scripts/skill/sync.test.py', output],
    {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1'
      }
    }
  );
  assert.equal(syncSimulation.status, 0, syncSimulation.stderr);
  assert.match(syncSimulation.stdout, /sync simulation ok/);
  console.log('ashfox skill release validation ok');
} finally {
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(secondOutput, { recursive: true, force: true });
}
