import { createHash } from 'node:crypto';
import {
  readdir,
  readFile,
  stat
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { siteMessages } from '../src/messages.mjs';
import { defaultLocale } from '../src/locales.mjs';
const landingMessages = siteMessages(defaultLocale);

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = path.resolve(siteRoot, '../..');
const outputRoot = path.join(siteRoot, 'dist');
const showcaseRoot = path.join(
  repositoryRoot,
  'assets',
  'showcase',
  'shared-creatures'
);
const showcaseManifestPath = path.join(showcaseRoot, 'showcase.json');
const canonicalWorkspaceRelativePath =
  'assets/workspaces/shared-creatures.ashfoxworkspace';
const canonicalWorkspacePath = path.join(
  repositoryRoot,
  canonicalWorkspaceRelativePath
);
const griffinGlbRelativePath = 'examples/griffin.glb';
const griffinGlbSourcePath = path.join(
  repositoryRoot,
  'assets',
  'exports',
  'griffin',
  'griffin.glb'
);

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    })
  );
  return nested.flat();
};

const exists = async (target) => {
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
};

const digestBytes = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const attribute = (tag, name) =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'u'))?.[1] ?? null;

const failures = [];
const htmlFiles = (await walk(outputRoot)).filter((file) =>
  file.endsWith('.html')
);
const indexedCanonicalUrls = [];
const retiredAuthoredContractTerms = [
  /\bminecraft-model\b/iu,
  /\bIntent Program\b/u,
  /\bintent-program(?:-v1)?\b/u,
  /\bintentProgram\b/u,
  /\bmodel-v\d+\b/iu,
  /\bsemantic candidate\b/iu,
  /\bsemantic[ _-]+(?:intent|profile|readiness)\b/iu,
  /\bauthoring[ _-]+(?:profile|invariant|readiness)\b/iu,
  /\b(?:AuthoringProfile|authoringProfile)\b/u,
  /\b(?:invalid[._-](?:intent|authoring(?:[._-](?:profile|invariant))?)|pending[._-]source)\b/iu,
  /(?:project|compiler)\/program\/(?:semantic|profile|review|design)\b/iu,
  /\breadiness\/(?:intent|authoring)\b/iu,
  /\bVisual Form Plan\b/iu,
  /project\/program\/design/iu,
  /compiler\/program\/design/iu,
  /\bAuthoredDesignProgram\b/u,
  /\bauthoredDesignProgram\b/u,
  /\bAuthoredDesign\b/u,
  /\bauthoredDesign\b/u,
  /authored\.design/iu,
  /authored-design/iu,
  /authored visual design/iu,
  /authored-visual-design/iu,
  /\bAuthoredModel(?:Source)?\b/u,
  /\bauthoredModel(?:Source)?\b/u,
  /\bauthored model source\b/iu,
  /\bauthored-model\b/iu,
  /\bexplicit-model-source\b/iu,
  /\bauthored\.model\.replace\b/iu,
  /\breplace-authored-model\b/iu,
  /(?:project|compiler)\/program\/model\b/iu,
  /\bmask-ref\b/iu,
  /\b(?:FillRectShadeLike|FillShadeDirection|FILL_SHADE_DIRECTIONS|fillShade|textureFillShade|pixelRectShade|deterministicPixelNoise|stableTextureSeed|pixelTonePalette)\b/iu,
  /\b(?:support host|body relationships|focal meaning|face host|idle mode)\b/iu,
  /\b(?:let ashfox|ashfox) derive (?:ids|pivots|uvs|texture pixels)\b/iu,
];
const retiredAuthoredStatementSyntax = [
  /(^|\n)[ \t]*use\s*\{/u,
  /(^|\n)[ \t]*usage\s*=/u,
  // `pattern blotch` owns texel scale; reject only the retired static form.
  /(^|\n)[ \t]*scale\s*=(?!=)(?![^\n]*tx\b)/iu,
  /(^|\n)[ \t]*symmetry\s*=/u,
  /\bsampling\s*=(?!=)/iu,
  /\btranslate\s*=(?!=)/iu,
  /\brotate\s*=(?!=)/iu,
  /\bstatic\s+scale\s*=(?!=)/iu,
  /(^|\n)[ \t]*animation\s+[A-Za-z_$][A-Za-z0-9_$-]*\s*\{/u,
  /\bfn\s+[A-Za-z_$][A-Za-z0-9_$-]*\s*\(/iu,
  /(^|\n)[ \t]*macro\s+[A-Za-z_$][A-Za-z0-9_$-]*\s*\(/u,
  /(^|\n)[ \t]*call\s+[A-Za-z_$][A-Za-z0-9_$-]*\s*\(/u,
  /(^|\n)[ \t]*(?:class|trait|mixin)\s+[A-Za-z_$][A-Za-z0-9_$-]*/u,
  /(^|\n)[ \t]*extends\s+[A-Za-z_$][A-Za-z0-9_$-]*/u,
  /\bbox-uv\s*=(?!=)/iu,
  /\buv-offset\s*=(?!=)/iu,
  /\buv-origin\s*=(?!=)/iu,
  /(^|\n)[ \t]*uv\s*=(?!=)/iu,
  /(^|\n)[ \t]*alpha\s*=(?!=)/iu,
  /(^|\n)[ \t]*mask(?:[ \t]+[A-Za-z_$][A-Za-z0-9_$-]*|[ \t]*=)/u,
  /(^|\n)[ \t]*shade\s*\{/iu,
  /(^|\n)[ \t]*grain\s+clustered\s*\{[^}]*\b(?:scale|density|phase)\s*=(?!=)/isu,
  /(^|\n)[ \t]*amount\s*=(?!=)/iu,
  /(^|\n)[ \t]*colors\s*=/iu,
  /(^|\n)[ \t]*roughness\s*=(?!=)/iu,
  /(^|\n)[ \t]*continuity\s*=(?!=)/iu,
  /(^|\n)[ \t]*(?:pixel|rect)\s*\(/u,
  /\b(?:direction|cluster)\s*=(?!=)/iu,
  /(^|\n)[ \t]*(?:shadow|base|light)\s*=\s*#[0-9a-f]{6}\s*;/iu,
  /(^|\n)[ \t]*(?:annotate|assert)\b/iu
];
const retiredCaptureModeTerms = [
  /\b(?:createResultPng|createAnimatedGif|renderAnimatedGif|resultCaptureFile)\b/u,
  /\bkind\s*[:=]\s*['"](?:result|animation|history)['"]/iu,
  /\b(?:result|animation|history)[ _-]+capture\b/iu,
  /\bcapture[ _-]+(?:result|animation|history)\b/iu
];

const retiredContractSourceScopes = [
  path.join(repositoryRoot, 'apps/site/src'),
  path.join(repositoryRoot, 'packages/engine-core/src'),
  path.join(repositoryRoot, 'packages/blockbench-contracts/src'),
  path.join(repositoryRoot, 'packages/blockbench-runtime/src'),
  path.join(repositoryRoot, 'packages/internal-contracts/src'),
  path.join(repositoryRoot, 'docs'),
  path.join(repositoryRoot, 'examples'),
  path.join(repositoryRoot, 'skills/ashfox')
];
// Release history records removed contracts; only current guidance is checked.
const retiredContractFiles = [
  path.join(repositoryRoot, 'README.md'),
  path.join(repositoryRoot, 'CONTRIBUTING.md'),
  path.join(repositoryRoot, 'development-manifest.json'),
  path.join(repositoryRoot, 'development-manifest.schema.json')
];
const retiredSourceFiles = [
  ...(await Promise.all(retiredContractSourceScopes.map(async (scope) =>
    (await walk(scope)).filter((file) =>
      /\.(?:ashfox|json|md|mjs|js|ts|tsx)$/u.test(file))
  ))).flat(),
  ...retiredContractFiles
];
// Model retirement rules do not define the sprite or sound property grammar.
const isOtherAssetGrammar = source => /^ashfox-model 1\s+(?:sprite|sound)\b/u.test(source.trim()) ||
  (/^ashfox-model 1\s+module\b/u.test(source.trim()) && /\bexport\s+(?:mask|material|stamp)\b/u.test(source));
for (const file of retiredSourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const term of retiredAuthoredContractTerms) {
    if (term.test(source)) {
      failures.push(`${file}: retired authored contract term remains in source`);
    }
  }
  for (const term of retiredCaptureModeTerms) {
    if (term.test(source)) {
      failures.push(`${file}: retired capture mode term remains in source`);
    }
  }
  // These patterns describe authored DSL statements. Restrict them to
  // authored/documentation text so ordinary TypeScript/JavaScript `class`,
  // `extends`, and similar language constructs do not become false positives.
  if (/\.(?:ashfox|md|html|json)$/u.test(file)) {
    const modelStatements = isOtherAssetGrammar(source) ? '' : source.replace(
      /```(?:text|ashfox)?\n(ashfox-model 1[\s\S]*?)```/gu,
      (block, body) => isOtherAssetGrammar(body) ? '' : block);
    for (const term of retiredAuthoredStatementSyntax) {
      if (term.test(modelStatements)) {
        failures.push(`${file}: retired authored statement syntax remains in source`);
      }
    }
  }
}

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const term of retiredAuthoredContractTerms) {
    if (term.test(html)) {
      failures.push(`${file}: retired authored contract term is published`);
    }
  }
  for (const term of retiredCaptureModeTerms) {
    if (term.test(html)) {
      failures.push(`${file}: retired capture mode term is published`);
    }
  }
  const ids = new Set(
    [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1])
  );
  const hrefs = [...html.matchAll(/\shref="([^"]+)"/g)]
    .map((match) => match[1]);
  for (const href of hrefs) {
    if (
      /^(?:https?:|mailto:)/.test(href) ||
      href === '/' ||
      href.startsWith('/?')
    ) {
      continue;
    }
    if (href.startsWith('#')) {
      if (!ids.has(href.slice(1))) {
        failures.push(`${file}: missing local anchor ${href}`);
      }
      continue;
    }
    const [pathname, hash] = href.split('#');
    if (!pathname.startsWith('/')) continue;
    const target = pathname.endsWith('/')
      ? path.join(outputRoot, pathname, 'index.html')
      : path.join(outputRoot, pathname);
    if (!(await exists(target))) {
      failures.push(`${file}: missing link target ${href}`);
      continue;
    }
    if (hash && target.endsWith('.html')) {
      const targetHtml = await readFile(target, 'utf8');
      if (!targetHtml.includes(`id="${hash}"`)) {
        failures.push(`${file}: missing target anchor ${href}`);
      }
    }
  }
  const sources = [...html.matchAll(/\ssrc="([^"]+)"/g)]
    .map((match) => match[1]);
  for (const source of sources) {
    if (/^(?:https?:|data:)/.test(source)) continue;
    const pathname = source.split(/[?#]/)[0];
    if (!pathname.startsWith('/')) continue;
    if (!(await exists(path.join(outputRoot, pathname)))) {
      failures.push(`${file}: missing source asset ${source}`);
    }
  }
  if (/localhost|127\.0\.0\.1/.test(html)) {
    failures.push(`${file}: local development origin leaked into output`);
  }
  if (/\/gallery\/|\/demos\/|data-agent-demo|data-scroll-story/.test(html)) {
    failures.push(`${file}: retired gallery or demo markup is published`);
  }
  const requiredMetadata = [
    '<meta name="description"',
    '<meta name="robots"',
    '<meta property="og:title"',
    '<meta property="og:description"',
    '<meta property="og:url"',
    '<meta property="og:image"',
    '<meta name="twitter:card"',
    '<link rel="canonical"'
  ];
  const isNotFoundPage = path.basename(file) === '404.html';
  for (const metadata of requiredMetadata) {
    if (!html.includes(metadata)) {
      failures.push(`${file}: missing SEO metadata ${metadata}`);
    }
  }
  if (!isNotFoundPage) {
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    if (!canonical) failures.push(`${file}: canonical URL is missing`);
    else indexedCanonicalUrls.push(canonical);
  }
}

const outputFiles = await walk(outputRoot);
if (outputFiles.some((file) => file.endsWith('.map'))) {
  failures.push('source maps must not be present in the static site output');
}
for (const required of ['_headers', 'og.png', 'robots.txt', 'sitemap.xml']) {
  if (!(await exists(path.join(outputRoot, required)))) {
    failures.push(`static site output is missing ${required}`);
  }
}
for (const retiredDirectory of ['gallery', 'demos']) {
  try {
    if ((await stat(path.join(outputRoot, retiredDirectory))).isDirectory()) {
      failures.push(`retired ${retiredDirectory} output is still published`);
    }
  } catch {
    // Absence is the required hardcut state.
  }
}

const sitemapPath = path.join(outputRoot, 'sitemap.xml');
if (await exists(sitemapPath)) {
  const sitemap = await readFile(sitemapPath, 'utf8');
  for (const canonical of indexedCanonicalUrls) {
    if (!sitemap.includes(`<loc>${canonical}</loc>`)) {
      failures.push(`sitemap is missing canonical URL ${canonical}`);
    }
  }
  if (sitemap.includes('/gallery/') || sitemap.includes('/demos/')) {
    failures.push('sitemap still publishes retired gallery or demo routes');
  }
}

const landingHtml = await readFile(path.join(outputRoot, 'index.html'), 'utf8');
const showcaseManifest = JSON.parse(
  await readFile(showcaseManifestPath, 'utf8')
);
const expectedShowcaseIdentities = [
  'workbench/griffin',
  'creatures/fox',
  'creatures/goblin'
];
const manifestIdentities = showcaseManifest.entries?.map(
  (entry) => `${entry.packageName}/${entry.entryName}`
) ?? [];
if (
  showcaseManifest.format !== 'ashfox-showcase' ||
  showcaseManifest.version !== 1 ||
  showcaseManifest.workspace?.path !== canonicalWorkspaceRelativePath ||
  manifestIdentities.join('|') !== expectedShowcaseIdentities.join('|')
) {
  failures.push(
    'showcase manifest must describe the canonical Griffin/Fox/Goblin replay set'
  );
}

for (const required of ['data-live-model', 'data-model-motion="wing_display"', 'data-item-image', 'data-landing-audio', 'data-source-code', 'id="quick-start"']) {
  if (!landingHtml.includes(required)) failures.push(`Landing is missing ${required}`);
}
if (/data-character-player|data-workspace-download|data-showroom-data/u.test(landingHtml)) failures.push('Retired showroom is still published');
if (/<audio[^>]*autoplay/u.test(landingHtml)) failures.push('Landing sound must require an explicit play action');
for (const name of ['griffin.glb', 'sword.png', 'amethyst.png', 'claw-base.wav', 'claw-alternate.wav', 'hero.js']) {
  if (!(await exists(path.join(outputRoot, 'media/landing', name)))) failures.push(`Missing landing asset: ${name}`);
}
const heroModel = await readFile(path.join(outputRoot, 'media/landing/griffin.glb'));
if (heroModel.subarray(0, 4).toString('ascii') !== 'glTF') failures.push('Live model must be a real GLB');
const heroJson = JSON.parse(heroModel.subarray(20, 20 + heroModel.readUInt32LE(12)).toString());
for (const name of ['look_around', 'wing_display', 'greeting']) {
  if (!heroJson.animations?.some(clip => clip.name === name)) failures.push(`Missing live motion: ${name}`);
}
if (heroJson.extensionsRequired?.length) failures.push('Landing GLB must use portable encoding');

const canonicalWorkspace = await readFile(canonicalWorkspacePath);
if (digestBytes(canonicalWorkspace) !== showcaseManifest.workspace?.sha256) {
  failures.push('Showcase source receipt is stale');
}
const griffinGlb = await readFile(griffinGlbSourcePath);
const publishedGriffinGlbPath = path.join(outputRoot, griffinGlbRelativePath);
if (!(await exists(publishedGriffinGlbPath))) {
  failures.push('published Griffin GLB is missing');
} else {
  const publishedGriffinGlb = await readFile(publishedGriffinGlbPath);
  if (!publishedGriffinGlb.equals(griffinGlb)) {
    failures.push('published Griffin GLB must be byte-identical and current');
  }
}
const publishedWorkspaceFiles = outputFiles.filter((file) =>
  file.endsWith('.ashfoxworkspace') && file.startsWith(path.join(outputRoot, 'assets/workspaces'))
);
if (publishedWorkspaceFiles.length) failures.push('Internal model snapshots must not be published');
const committedPublicWorkspaces = (await walk(path.join(siteRoot, 'public')))
  .filter((file) => file.endsWith('.ashfoxworkspace'));
if (committedPublicWorkspaces.length !== 0) {
  failures.push('apps/site/public must not own a workspace copy');
}
if (!landingHtml.includes('href="/media/landing/griffin.glb"') || !landingHtml.includes('href="/examples/griffin/workbench/main.ashfox"')) {
  failures.push('Landing must offer the actual model and example source');
}

const rootReadme = await readFile(path.join(repositoryRoot, 'README.md'), 'utf8');
for (const requiredReadmeReference of [
  'assets/showcase/shared-creatures/griffin-build-replay.gif',
  'assets/showcase/shared-creatures/fox-build-replay.gif',
  'assets/showcase/shared-creatures/goblin-build-replay.gif',
  'examples/griffin/workbench/main.ashfox',
  'assets/exports/griffin/griffin.glb',
  'examples/shared-creatures/',
  'https://ashfox.io/#examples',
  'https://ashfox.io/docs/guides/cli/'
]) {
  if (!rootReadme.includes(requiredReadmeReference)) {
    failures.push(`README showcase reference is missing: ${requiredReadmeReference}`);
  }
}
if (!rootReadme.includes(landingMessages.provenance)) {
  failures.push('README must identify the replay as a reconstruction');
}
for (const readmeReplay of [
  'griffin-build-replay.gif',
  'fox-build-replay.gif',
  'goblin-build-replay.gif'
]) {
  if (!(await exists(path.join(
    repositoryRoot,
    'assets/showcase/shared-creatures',
    readmeReplay
  )))) {
    failures.push(`README replay target is missing: ${readmeReplay}`);
  }
}
if (!(await exists(path.join(
  repositoryRoot,
  'assets/exports/griffin/griffin.glb'
)))) {
  failures.push('README Griffin GLB target is missing');
}

const agentInstructionControlCount = (
  landingHtml.match(/\sdata-copy-agent-instruction(?:\s|>)/g) ?? []
).length;
if (agentInstructionControlCount !== 1) {
  failures.push(
    `landing has ${agentInstructionControlCount} agent instruction controls, expected 1`
  );
}
const instructionButtons = landingHtml.match(
  /<button(?=[^>]*\sdata-copy-agent-instruction(?:\s|>))[^>]*>/gu
) ?? [];
if (instructionButtons.some((button) =>
  attribute(button, 'data-instruction') !== landingMessages.instruction
)) {
  failures.push('every setup button must copy the current agent instruction');
}
if (!landingHtml.includes('id="quick-start"') ||
    !landingHtml.includes('class="hero-start"')) {
  failures.push('landing must provide a reachable source authoring setup');
}
for (const required of ['Assets<br>as Code.', 'Built for voxel games.', 'id="workflow"',
  'id="frontier"', '/docs/guides/assets-as-code/', landingMessages.provenance]) {
  if (!landingHtml.includes(required)) failures.push(`Assets as Code landing is missing ${required}`);
}
for (const entry of ['griffin', 'fox', 'goblin']) {
  if (!landingHtml.includes(`/examples/${entry}.glb`)) failures.push(`Advanced example ${entry} has no output`);
}
const siteScriptSource = landingHtml.match(
  /<script type="module" src="([^"]+)"/
)?.[1];
if (!siteScriptSource) {
  failures.push('landing module script is missing');
} else {
  const siteScript = await readFile(path.join(outputRoot, siteScriptSource), 'utf8');
  if (/landingPlayback|gallery/.test(siteScript)) {
    failures.push('site script still imports retired gallery or demo playback');
  }
}

if (failures.length > 0) {
  throw new Error(`Static site validation failed:\n${failures.join('\n')}`);
}

console.log(`ashfox static site validation ok: ${htmlFiles.length} pages`);
