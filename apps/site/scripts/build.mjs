import stableRelease from '../../../scripts/release/stable.js';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import { createHash } from 'node:crypto';
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDocumentation } from '../src/docs.mjs';
import {
  renderDocumentationPage,
  renderLandingPage,
  renderNotFoundPage
} from '../src/templates/index.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(siteRoot, '..', '..');
const docsRoot = path.join(repoRoot, 'docs');
const brandRoot = path.join(repoRoot, 'assets', 'brand');
const showcaseRoot = path.join(
  repoRoot,
  'assets',
  'showcase',
  'shared-creatures'
);
const showcaseManifestPath = path.join(showcaseRoot, 'showcase.json');
const canonicalWorkspacePath = path.join(
  repoRoot,
  'assets', 'workspaces',
  'shared-creatures.ashfoxworkspace'
);
const sourceRoot = path.join(siteRoot, 'src');
const publicRoot = path.join(siteRoot, 'public');
const outputRoot = path.join(siteRoot, 'dist');

const workbenchUrl = '/workbench/';
const siteOrigin = 'https://ashfox.io';
const canonicalWorkspaceRelativePath =
  'assets/workspaces/shared-creatures.ashfoxworkspace';

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertExactKeys = (value, keys, label) => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join('|') !== expected.join('|')) {
    throw new Error(`${label} must contain exactly ${expected.join(', ')}.`);
  }
};

const requiredString = (value, label) => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
};

const requiredInteger = (value, label) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
};

const requiredDigest = (value, label) => {
  const digest = requiredString(value, label);
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
  }
  return digest;
};

const localMediaName = (value, extension, label) => {
  const fileName = requiredString(value, label);
  if (
    path.basename(fileName) !== fileName ||
    !/^[a-z0-9][a-z0-9_-]*\.[a-z0-9]+$/u.test(fileName) ||
    path.extname(fileName) !== extension
  ) {
    throw new Error(`${label} must name one local ${extension} file.`);
  }
  return fileName;
};

const digestBytes = (bytes) =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

const readShowcase = async () => {
  const manifest = JSON.parse(await readFile(showcaseManifestPath, 'utf8'));
  assertExactKeys(
    manifest,
    ['format', 'version', 'workspace', 'capture', 'entries'],
    'Showcase manifest'
  );
  if (manifest.format !== 'ashfox-showcase' || manifest.version !== 1) {
    throw new Error('Showcase manifest must use ashfox-showcase version 1.');
  }
  assertExactKeys(
    manifest.workspace,
    ['path', 'sha256', 'workspaceHash'],
    'Showcase workspace'
  );
  if (manifest.workspace.path !== canonicalWorkspaceRelativePath) {
    throw new Error('Showcase manifest must reference the canonical workspace.');
  }
  const workspaceDigest = requiredDigest(
    manifest.workspace.sha256,
    'Showcase workspace sha256'
  );
  requiredDigest(
    manifest.workspace.workspaceHash,
    'Showcase workspace workspaceHash'
  );
  assertExactKeys(
    manifest.capture,
    ['fingerprint', 'environment', 'camera', 'width', 'height', 'fps'],
    'Showcase capture'
  );
  if (
    manifest.capture.environment !== 'studio' ||
    manifest.capture.camera !== 'perspective' ||
    manifest.capture.width !== 640 ||
    manifest.capture.height !== 360 ||
    manifest.capture.fps !== 10
  ) {
    throw new Error('Showcase capture settings do not match the public contract.');
  }
  requiredString(manifest.capture.fingerprint, 'Showcase capture fingerprint');
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error('Showcase manifest must declare generated entries.');
  }
  const expectedEntries = [
    'workbench/griffin',
    'creatures/fox',
    'creatures/goblin'
  ];
  const entries = manifest.entries.map((entry, index) => {
    const label = `Showcase entry ${index}`;
    assertExactKeys(entry, [
      'packageName', 'entryName', 'closureHash', 'buildKey', 'productHash',
      'artifact', 'poster', 'artifactSha256', 'posterSha256', 'byteLength',
      'frameCount', 'eventCount', 'motions', 'video'
    ], label);
    const packageName = requiredString(entry.packageName, `${label} packageName`);
    const entryName = requiredString(entry.entryName, `${label} entryName`);
    if (`${packageName}/${entryName}` !== expectedEntries[index]) {
      throw new Error(`${label} is not in canonical Griffin/Fox/Goblin order.`);
    }
    assertExactKeys(entry.video, ['artifact', 'sha256', 'byteLength'], `${label} video`);
    return {
      video: {
        artifact: localMediaName(entry.video.artifact, '.mp4', `${label} video artifact`),
        sha256: requiredDigest(entry.video.sha256, `${label} video sha256`),
        byteLength: requiredInteger(entry.video.byteLength, `${label} video byteLength`)
      },
      motions: entry.motions.map((motion) => {
        assertExactKeys(motion, ['name', 'duration', 'artifact', 'sha256', 'byteLength'], `${label} motion`);
        if (!/^[a-z_]+$/u.test(motion.name) || !Number.isFinite(motion.duration) || motion.duration <= 0) throw new Error('Invalid motion identity');
        return { name: motion.name, duration: motion.duration,
          artifact: localMediaName(motion.artifact, '.mp4', `${label} motion artifact`),
          sha256: requiredDigest(motion.sha256, `${label} motion sha256`),
          byteLength: requiredInteger(motion.byteLength, `${label} motion byteLength`) };
      }),
      packageName,
      entryName,
      closureHash: requiredDigest(entry.closureHash, `${label} closureHash`),
      buildKey: requiredDigest(entry.buildKey, `${label} buildKey`),
      productHash: requiredDigest(entry.productHash, `${label} productHash`),
      artifact: localMediaName(entry.artifact, '.gif', `${label} artifact`),
      poster: localMediaName(entry.poster, '.png', `${label} poster`),
      artifactSha256: requiredDigest(
        entry.artifactSha256,
        `${label} artifactSha256`
      ),
      posterSha256: requiredDigest(entry.posterSha256, `${label} posterSha256`),
      byteLength: requiredInteger(entry.byteLength, `${label} byteLength`),
      frameCount: requiredInteger(entry.frameCount, `${label} frameCount`),
      eventCount: requiredInteger(entry.eventCount, `${label} eventCount`)
    };
  });
  const workspaceBytes = await readFile(canonicalWorkspacePath);
  if (digestBytes(workspaceBytes) !== workspaceDigest) {
    throw new Error('Showcase workspace digest is stale. Regenerate its media.');
  }
  return {
    capture: manifest.capture,
    entries,
    workspaceBytes
  };
};

const hashedAsset = async (sourceName, transform) => {
  const source = await readFile(path.join(sourceRoot, sourceName));
  const bytes = transform
    ? Buffer.from(transform(source.toString('utf8')))
    : source;
  const extension = path.extname(sourceName);
  if (extension === '.js') new Script(bytes.toString('utf8'));
  const name = path.basename(sourceName, extension);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const outputName = `${name}-${hash}${extension}`;
  await writeFile(path.join(outputRoot, 'assets', outputName), bytes);
  return `/assets/${outputName}`;
};

const hashedShowcaseMedia = async (fileName, expectedDigest, byteLength) => {
  const bytes = await readFile(path.join(showcaseRoot, fileName));
  const digest = digestBytes(bytes);
  if (digest !== expectedDigest) {
    throw new Error(`Showcase media digest is stale: ${fileName}`);
  }
  if (byteLength !== undefined && bytes.byteLength !== byteLength) {
    throw new Error(`Showcase media byte length is stale: ${fileName}`);
  }
  const extension = path.extname(fileName);
  const name = path.basename(fileName, extension);
  const outputName = `${name}-${digest.slice('sha256:'.length, 19)}${extension}`;
  await writeFile(path.join(outputRoot, 'media', 'showcase', outputName), bytes);
  return `/media/showcase/${outputName}`;
};

const writeRoute = async (route, html) => {
  const relative = route === '/'
    ? 'index.html'
    : path.join(route.replace(/^\/|\/$/g, ''), 'index.html');
  const destination = path.join(outputRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, html);
};

const escapeXml = (value) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const sitemap = (routes) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((route) => `  <url><loc>${escapeXml(new URL(route, siteOrigin).toString())}</loc></url>`).join('\n')}
</urlset>
`;

execFileSync(process.execPath, [path.join(repoRoot, 'scripts/docs/build.js')], { cwd: repoRoot, stdio: 'inherit' });
await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, 'assets'), { recursive: true });
await mkdir(path.join(outputRoot, 'media', 'showcase'), { recursive: true });
await mkdir(path.join(outputRoot, 'examples'), { recursive: true });
await mkdir(path.join(outputRoot, 'assets/workspaces'), { recursive: true });

const landingCss = await readFile(path.join(sourceRoot, 'landing.css'), 'utf8');
const motionJs = await readFile(path.join(sourceRoot, 'motion.js'), 'utf8');
const landingJs = await readFile(path.join(sourceRoot, 'landing.js'), 'utf8');
const assets = {
  css: await hashedAsset('site.css', source => source + '\n' + landingCss),
  js: await hashedAsset('site.js', source => source + '\n' + motionJs + '\n' + landingJs)
};
const config = { siteOrigin, workbenchUrl, stable: stableRelease.readStable(repoRoot) };
const documents = await loadDocumentation(docsRoot);
const generatedShowcase = await readShowcase();
const showcase = {
  capture: generatedShowcase.capture,
  workspaceHref: `/${canonicalWorkspaceRelativePath}`,
  sourceHref:
    'https://github.com/sigee-min/ashfox/blob/main/' +
    canonicalWorkspaceRelativePath,
  workbenchHref: workbenchUrl,
  entries: await Promise.all(generatedShowcase.entries.map(async (entry) => ({
    workspaceHref: `/assets/workspaces/${entry.entryName}.ashfoxworkspace`,
    glbHref: `/examples/${entry.entryName}.glb`,
    motions: await Promise.all(entry.motions.map(async (motion) => ({ name: motion.name, duration: motion.duration, src: await hashedShowcaseMedia(motion.artifact, motion.sha256, motion.byteLength) }))),
    packageName: entry.packageName,
    entryName: entry.entryName,
    replayVideoSrc: await hashedShowcaseMedia(entry.video.artifact, entry.video.sha256, entry.video.byteLength),
    replaySrc: await hashedShowcaseMedia(
      entry.artifact,
      entry.artifactSha256,
      entry.byteLength
    ),
    posterSrc: await hashedShowcaseMedia(entry.poster, entry.posterSha256)
  })))
};
await writeFile(
  path.join(outputRoot, canonicalWorkspaceRelativePath),
  generatedShowcase.workspaceBytes
);
for (const entry of generatedShowcase.entries) {
  await cp(path.join(repoRoot, `assets/workspaces/${entry.entryName}.ashfoxworkspace`), path.join(outputRoot, `assets/workspaces/${entry.entryName}.ashfoxworkspace`));
  await cp(path.join(repoRoot, `assets/exports/${entry.entryName}/${entry.entryName}.glb`), path.join(outputRoot, `examples/${entry.entryName}.glb`));
}

// Publish source examples without generated output or internal model snapshots.
const copyNativeSources = async (relative) => {
  for (const entry of await readdir(path.join(repoRoot, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory() && !['dist', 'build', 'exports', '.ashfox', 'node_modules'].includes(entry.name)) {
      await copyNativeSources(child);
    } else if (entry.isFile() && (entry.name.endsWith('.ashfox') || entry.name === '.ashfoxworkspace')) {
      const destination = path.join(outputRoot, child);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(repoRoot, child), destination);
    }
  }
};
await copyNativeSources('examples');
execFileSync(process.execPath, [path.join(repoRoot, 'scripts/landing/build.js')], { cwd: repoRoot, stdio: 'inherit' });
await cp(path.join(repoRoot, 'dist/landing'), path.join(outputRoot, 'media/landing'), { recursive: true });
await cp(path.join(repoRoot, 'dist/docs-delivery'), path.join(outputRoot, 'downloads'), { recursive: true });
await cp(path.join(repoRoot, 'assets/docs'), path.join(outputRoot, 'media/guides'), { recursive: true, filter: source => !source.endsWith('receipt.json') });

await writeRoute('/', renderLandingPage({ assets, config, showcase }));
for (const document of documents) {
  await writeRoute(
    document.route,
    renderDocumentationPage({ assets, config, document, documents })
  );
}
await writeFile(
  path.join(outputRoot, '404.html'),
  renderNotFoundPage({ assets, config })
);
await cp(publicRoot, outputRoot, { recursive: true });
await cp(brandRoot, path.join(outputRoot, 'brand'), { recursive: true });
await writeFile(
  path.join(outputRoot, '_headers'),
  `/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/docs/*
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
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

/assets/workspaces/*.ashfoxworkspace
  Content-Type: application/vnd.ashfox.workspace+json
  Cache-Control: public, max-age=0, must-revalidate

/downloads/*
  Cache-Control: public, max-age=0, must-revalidate

/media/guides/*.wav
  Content-Type: audio/wav

/examples/*.glb
  Content-Type: model/gltf-binary
  Cache-Control: public, max-age=0, must-revalidate

`
);
await writeFile(
  path.join(outputRoot, '_redirects'),
  `/docs /docs/ 301
`
);
await writeFile(
  path.join(outputRoot, 'robots.txt'),
  `User-agent: *
Allow: /

Sitemap: ${siteOrigin}/sitemap.xml
`
);
await writeFile(
  path.join(outputRoot, 'sitemap.xml'),
  sitemap([
    '/',
    '/workbench/',
    ...documents.map((document) => document.route)
  ])
);

console.log(
  `ashfox static site built: ${documents.length} docs, ${outputRoot}`
);
