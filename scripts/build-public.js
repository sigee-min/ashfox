const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const webOutput = path.join(repoRoot, 'apps', 'web', 'dist');
const siteOutput = path.join(repoRoot, 'apps', 'site', 'dist');
const publicOutput = path.join(repoRoot, 'dist', 'public');
const {
  buildSkillRelease
} = require('./build-skill-release');

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

requireFile(path.join(webOutput, 'workbench', 'index.html'));
requireFile(path.join(webOutput, 'workbench', 'agent-manifest.json'));
requireFile(path.join(siteOutput, 'index.html'));
requireFile(path.join(siteOutput, 'docs', 'index.html'));

fs.rmSync(publicOutput, { recursive: true, force: true });
fs.mkdirSync(publicOutput, { recursive: true });

copyDirectoryContents(siteOutput, publicOutput);
copyDirectoryContents(
  path.join(webOutput, 'assets'),
  path.join(publicOutput, 'assets')
);
const workbenchOutput = path.join(publicOutput, 'workbench');
fs.mkdirSync(workbenchOutput, { recursive: true });
copyDirectoryContents(
  path.join(webOutput, 'workbench'),
  workbenchOutput
);
buildSkillRelease(publicOutput);
removeSourceMaps(publicOutput);

fs.writeFileSync(
  path.join(publicOutput, '_redirects'),
  [
    '/home / 301',
    '/home/ / 301',
    '/workbench /workbench/ 301',
    fs.readFileSync(path.join(siteOutput, '_redirects'), 'utf8').trim(),
    ''
  ].join('\n')
);
fs.writeFileSync(
  path.join(publicOutput, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/index.html
  Cache-Control: public, max-age=0, must-revalidate

/workbench/index.html
  Cache-Control: public, max-age=0, must-revalidate

/downloads/*
  Cache-Control: public, max-age=0, must-revalidate

/media/guides/*.wav
  Content-Type: audio/wav

/docs/*
  Cache-Control: public, max-age=0, must-revalidate

/workbench/agent-manifest.json
  Cache-Control: public, max-age=0, must-revalidate

/workbench/reference/*
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: text/plain; charset=utf-8

/skills/ashfox/latest.json
  Cache-Control: public, max-age=0, must-revalidate

/skills/ashfox/files/*
  Cache-Control: public, max-age=0, must-revalidate

/skills/ashfox/ashfox.skill
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: application/zip

/skills/ashfox/ashfox.zip
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: application/zip

/assets/app.*
  Cache-Control: public, max-age=0, must-revalidate

/assets/site-*
  Cache-Control: public, max-age=31536000, immutable

/brand/*
  Cache-Control: public, max-age=3600, must-revalidate

/og.png
  Cache-Control: public, max-age=86400

/robots.txt
  Cache-Control: public, max-age=3600

/sitemap.xml
  Cache-Control: public, max-age=3600

/media/*
  Cache-Control: public, max-age=604800

/media/showcase/*
  Cache-Control: public, max-age=31536000, immutable

/examples/*.ashfoxworkspace
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: application/vnd.ashfox.workspace+json

/examples/*.glb
  Cache-Control: public, max-age=0, must-revalidate
  Content-Type: model/gltf-binary

`
);

const landingHtml = fs.readFileSync(
  path.join(publicOutput, 'index.html'),
  'utf8'
);
const workbenchHtml = fs.readFileSync(
  path.join(publicOutput, 'workbench', 'index.html'),
  'utf8'
);
if (!landingHtml.includes('<link rel="canonical" href="https://ashfox.io/">')) {
  throw new Error('Landing canonical URL is missing.');
}
if (
  !workbenchHtml.includes(
    '<link rel="canonical" href="https://ashfox.io/workbench/"'
  ) ||
  !workbenchHtml.includes(
    'data-ashfox-agent-manifest="/workbench/agent-manifest.json"'
  )
) {
  throw new Error('Workbench discovery metadata is inconsistent.');
}
if (
  fs.statSync(
    path.join(publicOutput, 'agent-manifest.json'),
    { throwIfNoEntry: false }
  )
) {
  throw new Error('Agent manifest must exist only below /workbench/.');
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
