import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderDocumentationPage } from '../src/templates/docs.mjs';
import { loadAllDocumentation } from '../src/docs.mjs';

let fallbackHtml;
const fixture = await mkdtemp(path.join(tmpdir(), 'ashfox-locales-'));
try {
  await mkdir(path.join(fixture, 'translations/ko'), { recursive: true });
  const source = '# Start\n\nRead [other](other.md#units).\n\n## Stable anchor\n\n```sh\nashfox --version\n```\n';
  await writeFile(path.join(fixture, 'public.json'), JSON.stringify([{id:'start',label:'Start',pages:[
    {source:'README.md', route:'/docs/'}, {source:'other.md', route:'/docs/other/'}
  ]}]));
  await writeFile(path.join(fixture, 'README.md'), source);
  await writeFile(path.join(fixture, 'other.md'), '# Other\n\n## Units\n');
  await writeFile(path.join(fixture, 'translations/ko/README.md'), '# 시작\n\n[다른 문서](other.md#units)\n\n## 안정적인 앵커\n\n{{source-code:0}}\n');
  const revision = createHash('sha256').update(source).digest('hex');
  await writeFile(path.join(fixture, 'translations/ko/revisions.json'), JSON.stringify({'README.md':revision}));
  let pages = await loadAllDocumentation(fixture);
  const translated = pages.find(page => page.route === '/ko/docs/');
  const fallback = pages.find(page => page.route === '/ko/docs/other/');
  assert.equal(translated.contentLanguage, 'ko');
  assert.equal(translated.stale, false);
  assert.match(translated.html, /id="stable-anchor"/);
  assert.match(translated.html, /href="\/ko\/docs\/other\/#units"/);
  assert.match(translated.html, /ashfox --version/);
  assert.equal(fallback.fallback, true);
  assert.equal(fallback.contentLanguage, 'en');
  fallbackHtml = renderDocumentationPage({assets:{css:'/assets/test.css',js:'/assets/test.js',social:{docs:'/og-docs.png'}},config:{siteOrigin:'https://ashfox.io'},document:fallback,documents:pages.filter(page=>page.locale.code==='ko')});
  assert.equal(fallback.alternatives.find(locale => locale.code === 'ko').translated, false);
  await writeFile(path.join(fixture, 'README.md'), source + '\nChanged paragraph.\n');
  pages = await loadAllDocumentation(fixture);
  assert.equal(pages.find(page => page.route === '/ko/docs/').stale, true);
  assert.equal(pages.find(page => page.route === '/ko/docs/').contentLanguage, 'en');
  await writeFile(path.join(fixture, 'README.md'), source);
  await writeFile(path.join(fixture, 'translations/ko/README.md'), '# 시작\n\n{{source-code:99}}');
  await assert.rejects(loadAllDocumentation(fixture), /Unknown source code block/);
} finally { await rm(fixture, {recursive:true,force:true}); }

const output = new URL('../dist/', import.meta.url);
const english = await readFile(new URL('docs/index.html', output), 'utf8');
const korean = await readFile(new URL('ko/docs/index.html', output), 'utf8');
const fallback = fallbackHtml;
assert.match(english, /<html lang="en">/);
assert.match(korean, /<html lang="ko">/);
assert.match(korean, /hreflang="en" href="https:\/\/ashfox.io\/docs\/"/);
assert.match(korean, /hreflang="ko" href="https:\/\/ashfox.io\/ko\/docs\/"/);
assert.match(korean, /rel="canonical" href="https:\/\/ashfox.io\/ko\/docs\/"/);
assert.match(korean, /href="\/docs\/" lang="en"/);
assert.match(fallback, /name="robots" content="noindex,follow"/);
assert.match(fallback, /rel="canonical" href="https:\/\/ashfox.io\/docs\/other\/"/);
assert.doesNotMatch(fallback, /hreflang="ko"/);
assert.match(fallback, /아직 한국어로 번역되지/);
assert.match(fallback, /<div lang="en"/);
console.log('Docs locales: same-page switch, stable anchors, shared code, stale and missing translations, canonical/hreflang pass');

for (const route of ['', 'ko/']) {
  const html = await readFile(new URL(`${route}index.html`, output), 'utf8');
  assert.match(html, /class="language-menu" data-language-menu/);
  assert.doesNotMatch(html, /class="docs-languages"/);
  assert.match(html, /hreflang="ko" href="https:\/\/ashfox.io\/ko\/"/);
  assert.match(html, new RegExp(`rel="canonical" href="https://ashfox.io/${route}"`));
  assert.ok(html.includes(`href="/${route}#quick-start"`));
  assert.doesNotMatch(html, />undefined</);
}
assert.doesNotMatch(korean, /class="docs-languages"/);
assert.match(korean, /class="language-menu" data-language-menu/);
const koreanLanding = await readFile(new URL('ko/index.html', output), 'utf8');
assert.match(koreanLanding, /에셋의 원본도 내 저장소에/);
assert.match(koreanLanding, /크리처 하나를 온전히/);
assert.match(await readFile(new URL('sitemap.xml', output), 'utf8'), /<loc>https:\/\/ashfox.io\/ko\/<\/loc>/);
