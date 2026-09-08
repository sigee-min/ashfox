import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { marked } from 'marked';

const toPosix = (value) => value.split(path.sep).join('/');

export const slugify = (value) =>
  value
    .normalize('NFKD')
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
      if (resolved.startsWith('../examples/')) {
        return `](/${resolved.slice(3)}${hash})`;
      }
      if (!/\.md$/i.test(targetPath)) return _match;
      const anchor = hash ? `#${slugify(decodeURIComponent(hash.slice(1)))}` : '';
      const route = routes.get(resolved);
      if (!route) throw new Error(`Public document ${relativePath} links to unpublished ${resolved}.`);
      return `](${route}${anchor})`;
    }
  );

const addHeadingIds = (html) => {
  const counts = new Map();
  const toc = [];
  const content = html.replace(
    /<h([1-4])>([\s\S]*?)<\/h\1>/g,
    (_match, levelValue, inner) => {
      const level = Number(levelValue);
      const text = inner.replace(/<[^>]*>/g, '').trim();
      const base = slugify(text);
      const count = (counts.get(base) ?? 0) + 1;
      counts.set(base, count);
      const id = count === 1 ? base : `${base}-${count}`;
      if (level >= 2) toc.push({ id, level, text });
      return `<h${level} id="${id}">${inner}</h${level}>`;
    }
  );
  return { html: content, toc };
};

export const loadDocumentation = async (docsRoot) => {
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
    routes.set(page.source, page.route);
    publishedRoutes.add(page.route);
  }
  return Promise.all(pages.map(async (page) => {
    const markdown = await readFile(path.join(docsRoot, page.source), 'utf8');
    const rendered = addHeadingIds(marked.parse(
      rewriteMarkdownLinks(markdown, page.source, routes), { gfm: true }
    ));
    return {
      relativePath: page.source,
      route: page.route,
      section: page.section,
      sectionLabel: page.sectionLabel,
      title: titleFromMarkdown(markdown, path.basename(page.source, '.md')),
      description: descriptionFromMarkdown(markdown),
      html: rendered.html,
      toc: rendered.toc
    };
  }));
};
