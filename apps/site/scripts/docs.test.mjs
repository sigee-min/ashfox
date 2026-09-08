import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDocumentation } from '../src/docs.mjs';

const fixture = await mkdtemp(path.join(tmpdir(), 'ashfox-docs-'));
try {
  await mkdir(path.join(fixture, 'architecture'));
  await writeFile(path.join(fixture, 'public.json'), JSON.stringify([
    { id: 'learn', label: 'Learn', pages: [
      { source: 'README.md', route: '/docs/' },
      { source: 'architecture/syntax.md', route: '/docs/language/syntax/' }
    ] }
  ]));
  await writeFile(path.join(fixture, 'README.md'),
    '# Start\n\nRead [syntax](architecture/syntax.md#units).');
  await writeFile(path.join(fixture, 'architecture/syntax.md'),
    '# Syntax\n\n## Units\n\n[Example](../../examples/griffin.ashfoxworkspace)\n\n[External](https://example.com/readme.md)');
  await writeFile(path.join(fixture, 'architecture/internal.md'), '# Private codebase');
  const pages = await loadDocumentation(fixture);
  assert.deepEqual(pages.map((page) => page.route), ['/docs/', '/docs/language/syntax/']);
  assert.match(pages[0].html, /href="\/docs\/language\/syntax\/#units"/);
  assert.match(pages[1].html, /href="\/examples\/griffin.ashfoxworkspace"/);
  assert.match(pages[1].html, /href="https:\/\/example.com\/readme.md"/);
  await writeFile(path.join(fixture, 'README.md'),
    '# Start\n\n[Internal](architecture/internal.md)');
  await assert.rejects(loadDocumentation(fixture), /links to unpublished/);
} finally {
  await rm(fixture, { recursive: true, force: true });
}

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const documents = await loadDocumentation(path.resolve(siteRoot, '../../docs'));
const sitemap = await readFile(path.join(siteRoot, 'dist/sitemap.xml'), 'utf8');
for (const document of documents) {
  const html = await readFile(path.join(siteRoot, 'dist', document.route, 'index.html'), 'utf8');
  for (const page of documents) {
    assert.ok(html.includes(`href="${page.route}"`), `${document.route} must expose ${page.route}`);
  }
  assert.ok(html.includes('aria-label="Continue reading"'));
  assert.ok(sitemap.includes(document.route));
}
for (const internal of ['codebase', 'asset-codebase', 'review', 'asset-language']) {
  const route = `/docs/architecture/${internal}/`;
  assert.ok(!sitemap.includes(route));
  await assert.rejects(readFile(path.join(siteRoot, 'dist', route, 'index.html')), { code: 'ENOENT' });
}
console.log('public docs catalog, navigation, links, and publication boundaries verified');
