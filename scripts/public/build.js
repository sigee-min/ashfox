const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../..');
const siteOutput = path.join(repoRoot, 'apps', 'site', 'dist');
const publicOutput = path.join(repoRoot, 'dist', 'public');
const {
  buildSkillRelease
} = require('../skill/build');

const requireFile = (target) => {
  if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Missing public build input: ${target}`);
  }
};

const copyDirectoryContents = (source, destination) => {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    fs.cpSync(
      path.join(source, entry.name),
      path.join(destination, entry.name),
      { recursive: true, force: true }
    );
  }
};

const removeSourceMaps = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      removeSourceMaps(target);
      continue;
    }
    if (entry.name.endsWith('.map')) fs.rmSync(target);
  }
};

requireFile(path.join(siteOutput, 'index.html'));
requireFile(path.join(siteOutput, 'docs', 'index.html'));

fs.rmSync(publicOutput, { recursive: true, force: true });
fs.mkdirSync(publicOutput, { recursive: true });

copyDirectoryContents(siteOutput, publicOutput);
buildSkillRelease(publicOutput);
removeSourceMaps(publicOutput);

fs.writeFileSync(
  path.join(publicOutput, '_redirects'),
  [
    '/home / 301',
    '/home/ / 301',
    fs.readFileSync(path.join(siteOutput, '_redirects'), 'utf8').trim(),
    ''
  ].join('\n')
);
fs.appendFileSync(path.join(publicOutput, '_headers'), `
/skills/ashfox/*
  Cache-Control: public, max-age=0, must-revalidate

/skills/ashfox/ashfox.skill
  Content-Type: application/zip

/skills/ashfox/ashfox.zip
  Content-Type: application/zip
`);

const landingHtml = fs.readFileSync(
  path.join(publicOutput, 'index.html'),
  'utf8'
);
if (!landingHtml.includes('<link rel="canonical" href="https://ashfox.io/">')) {
  throw new Error('Landing canonical URL is missing.');
}
for (const retired of ['workbench', 'agent-manifest.json']) {
  if (fs.existsSync(path.join(publicOutput, retired))) {
    throw new Error(`Retired browser authoring entry point in public output: ${retired}`);
  }
}
requireFile(path.join(publicOutput, 'skills', 'ashfox', 'latest.json'));
requireFile(path.join(publicOutput, 'skills', 'ashfox', 'ashfox.skill'));
requireFile(path.join(publicOutput, 'skills', 'ashfox', 'ashfox.zip'));
requireFile(path.join(
  publicOutput,
  'skills',
  'ashfox',
  'files',
  'SKILL.md'
));

console.log(`ashfox public bundle ready: ${publicOutput}`);
