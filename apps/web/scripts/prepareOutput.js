const fs = require('node:fs');
const path = require('node:path');

const { outdir, webRoot } = require('./buildOptions');

const repoRoot = path.resolve(webRoot, '..', '..');
const brandSource = path.join(repoRoot, 'assets', 'brand');
const staticFiles = [
  'workbench/agent-manifest.json',
  'workbench/index.html'
];
const copiedStaticFiles = ['workbench/index.html'];

const loadAgentManifest = () => {
  require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
      module: 'CommonJS',
      moduleResolution: 'Node'
    }
  });
  return require(
    '../src/features/agent/agentManifest'
  ).agentManifest;
};

const prepareOutput = ({ includeShowcaseTooling = false } = {}) => {
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });
  for (const destination of copiedStaticFiles) {
    const target = path.join(outdir, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(
      path.join(webRoot, path.basename(destination)),
      target
    );
  }
  const manifestTarget = path.join(
    outdir,
    'workbench',
    'agent-manifest.json'
  );
  fs.mkdirSync(path.dirname(manifestTarget), { recursive: true });
  const manifest = loadAgentManifest();
  fs.writeFileSync(
    manifestTarget,
    `${JSON.stringify(manifest)}\n`
  );
  // Keep relative links and executable examples available on standalone dev
  // Workbench origins too; the site and agent read the same maintained sources.
  const documentation = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'docs', 'public.json'), 'utf8'
  ));
  for (const page of documentation.flatMap((section) => section.pages)) {
    const target = path.join(outdir, 'workbench', 'reference', page.source);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, 'docs', page.source), target);
  }
  fs.mkdirSync(path.join(outdir, 'workbench', 'examples'), { recursive: true });
  for (const workspaceName of [
    'shared-creatures.ashfoxworkspace',
    'griffin.ashfoxworkspace',
    'fox.ashfoxworkspace',
    'goblin.ashfoxworkspace'
  ]) {
    fs.copyFileSync(
      path.join(repoRoot, 'examples', workspaceName),
      path.join(outdir, 'workbench', 'examples', workspaceName)
    );
  }
  for (const resource of manifest.documentation.resources) {
    const target = path.join(outdir, resource.href.slice(1));
    if (!fs.statSync(target, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing agent documentation: ${resource.href}`);
    }
  }
  fs.cpSync(brandSource, path.join(outdir, 'brand'), {
    recursive: true
  });
  if (includeShowcaseTooling) {
    const toolingRoot = path.join(outdir, 'tooling');
    fs.mkdirSync(toolingRoot, { recursive: true });
    fs.copyFileSync(
      path.join(repoRoot, 'examples', 'shared-creatures.ashfoxworkspace'),
      path.join(toolingRoot, 'shared-creatures.ashfoxworkspace')
    );
  }
};

module.exports = { prepareOutput, staticFiles };
