const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { zipSync } = require('fflate');
const { SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION } = require('@ashfox/internal-contracts');

const repoRoot = path.resolve(__dirname, '../..');
const skillRoot = path.join(repoRoot, 'skills', 'ashfox');
const releaseFileDefinitions = [
  {
    path: 'SKILL.md',
    role: 'core',
  },
  {
    path: 'agents/openai.yaml',
    role: 'adapter',
    clients: ['codex'],
  },
  {
    path: 'scripts/sync.py',
    role: 'core',
  },
];
const releaseFiles = releaseFileDefinitions.map((file) => file.path);
const portableFiles = releaseFileDefinitions
  .filter((file) => file.role === 'core')
  .map((file) => file.path);

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const allFiles = (directory, prefix = '') =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const relative = path.posix.join(prefix, entry.name);
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? allFiles(target, relative) : [relative];
    })
    .sort();

const deterministicArchive = (fileData) => {
  const archiveEntries = Object.fromEntries(
    portableFiles.map((relative) => [
      `ashfox/${relative}`,
      [new Uint8Array(fileData.get(relative)), { mtime: new Date('1980-01-01T00:00:00.000Z') }],
    ]),
  );
  return Buffer.from(zipSync(archiveEntries, { level: 9 }));
};

const packageDescriptor = (url, data, format) => ({
  format,
  url,
  sha256: sha256(data),
  bytes: data.length,
});

const INSTALL_TARGETS = [
  {
    client: 'agent-skills',
    project: '.agents/skills/ashfox',
    user: '~/.agents/skills/ashfox',
  },
  {
    client: 'claude-code',
    project: '.claude/skills/ashfox',
    user: '~/.claude/skills/ashfox',
  },
  {
    client: 'cursor',
    project: '.cursor/skills/ashfox',
    user: '~/.cursor/skills/ashfox',
  },
  {
    client: 'github-copilot',
    project: '.github/skills/ashfox',
    user: '~/.copilot/skills/ashfox',
  },
  {
    client: 'gemini-cli',
    project: '.gemini/skills/ashfox',
    user: '~/.gemini/skills/ashfox',
  },
  {
    client: 'codex',
    project: '.codex/skills/ashfox',
    user: '~/.codex/skills/ashfox',
  },
];

const validateSkillSources = () => {
  const actualFiles = allFiles(skillRoot);
  if (JSON.stringify(actualFiles) !== JSON.stringify(releaseFiles)) {
    throw new Error(`ashfox skill files must be exactly: ${releaseFiles.join(', ')}`);
  }
  const skillMarkdown = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  if (
    !/^---\nname: ashfox\ndescription: [^\n]+\n---\n/.test(skillMarkdown) ||
    skillMarkdown.includes('TODO')
  ) {
    throw new Error('ashfox SKILL.md metadata is invalid or incomplete.');
  }
  const openAiMetadata = fs.readFileSync(path.join(skillRoot, 'agents', 'openai.yaml'), 'utf8');
  if (!openAiMetadata.includes('$ashfox')) {
    throw new Error('ashfox skill default prompt must invoke $ashfox.');
  }
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
    throw new Error('Root package version is required for the skill release.');
  }
  return packageJson.version;
};

const stageSkillFiles = (filesOutput) => {
  fs.mkdirSync(filesOutput, { recursive: true });
  const fileData = new Map();
  const files = releaseFileDefinitions.map((definition) => {
    const relative = definition.path;
    const data = fs.readFileSync(path.join(skillRoot, ...relative.split('/')));
    fileData.set(relative, data);
    const destination = path.join(filesOutput, ...relative.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, data);
    return {
      path: relative,
      url: `https://ashfox.io/skills/ashfox/files/${relative}`,
      sha256: sha256(data),
      bytes: data.length,
      role: definition.role,
      ...(definition.clients ? { clients: definition.clients } : {}),
    };
  });
  return { fileData, files };
};

const createSkillDescriptor = ({ release, archive, files }) => ({
  schemaVersion: SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION,
  name: 'ashfox',
  release,
  specificationUrl: 'https://agentskills.io/specification',
  documentationUrl: 'https://ashfox.io/docs/guides/agent-workflow/',
  sourceUrl: 'https://github.com/sigee-min/ashfox/tree/main/skills/ashfox',
  packages: {
    agentSkill: packageDescriptor(
      'https://ashfox.io/skills/ashfox/ashfox.skill',
      archive,
      'agent-skill',
    ),
    claudeZip: packageDescriptor('https://ashfox.io/skills/ashfox/ashfox.zip', archive, 'zip'),
  },
  installTargets: INSTALL_TARGETS,
  files,
});

const buildSkillRelease = (publicOutput) => {
  const release = validateSkillSources();
  const outputRoot = path.join(publicOutput, 'skills', 'ashfox');
  const { fileData, files } = stageSkillFiles(path.join(outputRoot, 'files'));
  const archive = deterministicArchive(fileData);
  fs.writeFileSync(path.join(outputRoot, 'ashfox.skill'), archive);
  fs.writeFileSync(path.join(outputRoot, 'ashfox.zip'), archive);
  const descriptor = createSkillDescriptor({ release, archive, files });
  fs.writeFileSync(
    path.join(outputRoot, 'latest.json'),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  return descriptor;
};

module.exports = {
  SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION,
  buildSkillRelease,
  portableFiles,
  releaseFiles,
  sha256,
};
