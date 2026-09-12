import { createHash } from 'node:crypto';
import { localeRegistry, defaultLocale, localizedRoute } from './locales.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { marked } from 'marked';

const toPosix = (value) => value.split(path.sep).join('/');

export const slugify = (value) =>
  value
    .normalize('NFC')
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';

const titleFromMarkdown = (markdown, fallback) => {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : fallback;
};

const descriptionFromMarkdown = (markdown) => {
  const paragraphs = markdown
    .replace(/```[\s\S]*?```/g, '')
    .split(/\n\s*\n/)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(
      (value) =>
        value.length > 30 &&
        !value.startsWith('#') &&
        !value.startsWith('- ') &&
        !value.startsWith('|')
    );
  return (paragraphs[0] ??
    'ashfox guides for creating, reviewing, saving, and exporting low-poly assets.')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '');
};

const rewriteMarkdownLinks = (markdown, relativePath, routes) =>
  markdown.replace(
    /\]\(([^)\s#]+)(#[^)]+)?\)/g,
    (_match, targetPath, hash = '') => {
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(targetPath)) return _match;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(toPosix(relativePath)), targetPath)
      );
      if (resolved.startsWith('../examples/') || resolved.startsWith('../assets/workspaces/')) {
        return `](/${resolved.slice(3)}${hash})`;
      }
      if (!/\.md$/i.test(targetPath)) return _match;
      const anchor = hash ? `#${slugify(decodeURIComponent(hash.slice(1)))}` : '';
      const route = routes.get(resolved);
      if (!route) throw new Error(`Public document ${relativePath} links to unpublished ${resolved}.`);
      return `](${route}${anchor})`;
    }
  );

const addHeadingIds = (html, originalHtml) => {
  const original = originalHtml ? [...originalHtml.matchAll(/<h([1-4])>([\s\S]*?)<\/h\1>/g)] : null;
  let heading = 0;
  const counts = new Map();
  const toc = [];
  const content = html.replace(
    /<h([1-4])>([\s\S]*?)<\/h\1>/g,
    (_match, levelValue, inner) => {
      const level = Number(levelValue);
      const text = inner.replace(/<[^>]*>/g, '').trim();
      const source = original?.[heading++];
      if (original && (!source || source[1] !== levelValue)) throw new Error('Translation heading structure differs from English');
      const base = slugify(source ? source[2].replace(/<[^>]*>/g, '').trim() : text);
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      const id = count === 1 ? base : `${base}-${count}`;
      if (level >= 2) toc.push({ id, level, text });
      return `<h${level} id="${id}">${inner}</h${level}>`;
    }
  );
  if (original && heading !== original.length) throw new Error('Translation heading count differs from English');
  return { html: content, toc };
};

export const loadDocumentation = async (docsRoot, locale = defaultLocale) => {
  const catalog = JSON.parse(await readFile(path.join(docsRoot, 'public.json'), 'utf8'));
  const pages = catalog.flatMap((section) => section.pages.map((page) => ({
    ...page, section: section.id, sectionLabel: section.label
  })));
  const routes = new Map();
  const publishedRoutes = new Set();
  for (const page of pages) {
    if (!/^[a-zA-Z0-9/-]+\.md$/.test(page.source) || page.source.includes('..') ||
        !/^\/docs\/(?:[a-z0-9-]+\/)*$/.test(page.route) ||
        routes.has(page.source) || publishedRoutes.has(page.route)) {
      throw new Error(`Invalid or duplicate public document: ${page.source}`);
    }
    routes.set(page.source, localizedRoute(page.route, locale));
    publishedRoutes.add(page.route);
  }
  const translationRoot = path.join(docsRoot, 'translations', locale.code);
  let revisions = {};
  if (locale.code !== defaultLocale.code) {
    try { revisions = JSON.parse(await readFile(path.join(translationRoot, 'revisions.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const key of Object.keys(revisions)) if (!routes.has(key) || !/^[a-f0-9]{64}$/.test(revisions[key])) {
      throw new Error(`Invalid translation revision: ${locale.code}/${key}`);
    }
  }
  return Promise.all(pages.map(async (page) => {
    const original = await readFile(path.join(docsRoot, page.source), 'utf8');
    let markdown = original, translated = false;
    const stale = Boolean(revisions[page.source] && revisions[page.source] !== createHash('sha256').update(original).digest('hex'));
    if (revisions[page.source] && !stale) {
      markdown = await readFile(path.join(translationRoot, page.source), 'utf8');
      const codeBlocks = original.match(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm) ?? [];
      markdown = markdown.replace(/\{\{source-code:(\d+)\}\}/g, (_match, index) => {
        if (!codeBlocks[Number(index)]) throw new Error(`Unknown source code block: ${page.source}:${index}`);
        return codeBlocks[Number(index)];
      });
      translated = true;
    }
    const fallback = locale.code !== defaultLocale.code && !translated;
    const rendered = addHeadingIds(marked.parse(
      rewriteMarkdownLinks(markdown, page.source, routes), { gfm: true }
    ), translated ? marked.parse(original, { gfm: true }) : null);
    return {
      relativePath: page.source,
      route: localizedRoute(page.route, locale),
      originalRoute: page.route,
      locale, fallback, stale,
      contentLanguage: fallback ? defaultLocale.code : locale.code,
      section: page.section,
      sectionLabel: locale.sections[page.section] ?? page.sectionLabel,
      title: titleFromMarkdown(markdown, path.basename(page.source, '.md')),
      description: descriptionFromMarkdown(markdown),
      html: rendered.html,
      toc: rendered.toc
    };
  }));
};

export const loadAllDocumentation = async (docsRoot) => {
  const documents = (await Promise.all(localeRegistry.locales.map(locale => loadDocumentation(docsRoot, locale)))).flat();
  return documents.map(document => ({ ...document, alternatives: documents
    .filter(page => page.relativePath === document.relativePath)
    .map(page => ({ code: page.locale.code, label: page.locale.label, route: page.route, translated: !page.fallback })) }));
};
