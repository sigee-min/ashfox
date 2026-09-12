# Translating Ashfox documentation

For contributors translating and maintaining Ashfox documentation. This guide
explains the documentation publishing system; asset authors should start with the
[user guides](../README.md).


English is the source language. Existing `/docs/` URLs remain stable. Locale
routes are derived from a registered prefix, for example `/ko/docs/`. The landing
page remains English. There is no browser-language redirect, so shared links and
crawler responses do not depend on cookies, JavaScript or request headers.

## One page identity, many languages

`docs/public.json` owns page identity, ordering and English routes. Its `source`
path is the stable document ID. Never duplicate that catalog for a language.
`docs/locales.json` registers locale codes, native names, URL prefixes, Open Graph
locales, section labels and UI strings. The loader validates codes, unique
prefixes and complete UI keys. Adding a locale does not require renderer changes.

English Markdown stays in its existing location. Translated Markdown lives in
`docs/translations/<locale>/<source>`. Each locale's `revisions.json` maps the
source path to the SHA-256 of the English bytes reviewed for that translation.
A Markdown file without a revision entry, an unknown page or a missing translated
file is an error. Keep repository contributor documents outside the public catalog.

## Translate a page

1. Add the locale registration if needed; translate every UI and section label.
2. Copy the page's structure into the matching translation path. Translate prose,
   tables, image alt text and explanatory prompts. Keep language tokens, IDs,
   configuration keys and executable commands unchanged.
3. Preserve the English heading levels, count and order. The renderer assigns the
   original heading IDs to translated headings; cross-page links and language
   switches therefore retain the same section identities.
4. Keep relative links relative to the original source ID, not the deeper physical
   translation directory. They automatically resolve within the chosen locale.
5. Use `{{source-code:0}}`, `{{source-code:1}}`, etc. to reuse zero-based fenced code
   blocks from English. Do not translate executable code or duplicate release URLs.
   The build rejects nonexistent references. Fully localized prose prompts can be
   regular fenced text blocks instead.
6. After reviewing the translation against the English source, acknowledge exactly
   that page:

```sh
node scripts/docs/translations.mjs --acknowledge ko guides/workspace.md
node scripts/docs/translations.mjs --check
npm run test:site
```

Never bulk-refresh hashes without reviewing the changed text. `--check` reports
coverage, missing translations and stale source revisions. The site build runs
this report automatically. A stale translation falls back to the current English original with a visible
update notice. Missing translations display English with a language notice.
Thus changing English headings or removing code examples never requires blocking
English publication on every language. Reviewing and acknowledging restores the translation.

## Navigation and search indexing

Each locale gets a complete navigation tree. Previous/next pages and relative
Markdown links stay in that locale. Language links target the same page, not the
Docs home. Controls, code-copy labels, accessibility labels and section names
come from the locale registry. No locale-specific client bundle is necessary.

Actual translations have self-canonical URLs and reciprocal `hreflang` links,
plus English `x-default`. Fallback pages keep localized navigation but label the
article `lang="en"`, use the English canonical and `noindex,follow`, and are
excluded from the sitemap and translated `hreflang` alternatives. They are not
presented to search engines as translated copies. Structured data records the
article's actual content language.

The current site has no client-side documentation search. Any future index should
use the loader's locale/contentLanguage fields and avoid indexing fallback copies
as translated results. Native source examples and downloadable artifacts remain
shared, language-neutral resources.

## Tests and publication

`apps/site/scripts/locales.test.mjs` checks same-page switching, rewritten links,
stable section anchors, shared source code, stale/missing translations and SEO.
The existing site validator checks every generated locale route and local link.
CLI example tests remain tied to the English source blocks reused by translations.
Do not edit `apps/site/dist`; publish through the normal site build.

All 31 current public English documents have Korean translations, including the
complete DSL reference. Future pages can be published in English first: until a
reviewed translation is added, that locale displays the explicit English fallback.
Adding Markdown and a revision entry is enough; no routing or template work is needed.
