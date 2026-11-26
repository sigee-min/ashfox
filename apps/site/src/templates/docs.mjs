import { absoluteUrl, escapeHtml, pageShell } from './shell.mjs';
import { siteMessages } from '../messages.mjs';

const groupDocuments = (documents) =>
  [...new Set(documents.map((document) => document.section))].map((section) => ({
    label: documents.find((document) => document.section === section).sectionLabel,
    documents: documents.filter((document) => document.section === section),
  }));

const docsNavigation = (documents, currentRoute, t) => `
  <nav class="docs-nav" aria-label="${escapeHtml(t.documentation)}">
    ${groupDocuments(documents)
      .map(
        (group) => `
      <section>
        <h2>${escapeHtml(group.label)}</h2>
        ${group.documents
          .map(
            (doc) => `
          <a ${doc.route === currentRoute ? 'aria-current="page"' : ''} href="${doc.route}">${escapeHtml(doc.title)}</a>`,
          )
          .join('')}
      </section>`,
      )
      .join('')}
  </nav>
`;

const studioDomainForRoute = (route) => {
  if (route.includes('models') || route.includes('animation') || route.includes('precision')) {
    return 'model';
  }
  if (route.includes('sprites') || route.includes('textures')) return 'sprite';
  if (route.includes('sounds')) return 'sound';
  return null;
};

const renderPagination = (documents, currentRoute, t) => {
  const index = documents.findIndex((page) => page.route === currentRoute);
  const adjacent = [
    { page: documents[index - 1], label: t.previous },
    { page: documents[index + 1], label: t.next },
  ].filter(({ page }) => page);
  return `<nav class="doc-pagination" aria-label="${escapeHtml(t.continue)}">
    ${adjacent
      .map(
        ({ page, label }) => `<a href="${escapeHtml(page.route)}">
      <span>${escapeHtml(label)}</span><strong>${escapeHtml(page.title)}</strong>
    </a>`,
      )
      .join('')}
  </nav>`;
};

export const renderDocumentationPage = ({ assets, config, document, documents }) => {
  const { locale } = document;
  const t = locale.ui;
  const messages = siteMessages(locale);
  const home = `${locale.prefix}/docs/`;
  const navigation = docsNavigation(documents, document.route, t);
  const alternatives = document.alternatives ?? [];
  const studioDomain = studioDomainForRoute(document.route);
  const notice =
    document.fallback || document.stale
      ? `<aside class="translation-notice" role="note">${escapeHtml(document.stale ? t.stale : t.fallback)} <a href="${document.originalRoute}">${escapeHtml(t.original)}</a></aside>`
      : '';
  const headLinks =
    alternatives
      .filter((option) => option.translated)
      .map(
        (option) =>
          `<link rel="alternate" hreflang="${option.code}" href="${absoluteUrl(config.siteOrigin, option.route)}">`,
      )
      .join('') +
    `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(config.siteOrigin, document.originalRoute)}">`;
  const tocLinks = document.toc
    .map(
      (item) =>
        `<a class="toc-level-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>`,
    )
    .join('');
  const toc =
    document.toc.length > 0
      ? `<nav class="page-toc" aria-label="${escapeHtml(t.onThisPage)}"><p>${escapeHtml(t.onThisPage)}</p>${tocLinks}</nav>`
      : '';
  const studioCallout = studioDomain
    ? `<a class="linear-link" href="${locale.prefix}/assets/?domain=${studioDomain}">${escapeHtml(messages.studioBrowseDomain)} →</a>`
    : '';
  const searchSrc = assets.docsSearch?.[locale.code] || assets.docsSearch?.en || '';
  const body = `
    <main id="main" class="docs-shell" data-docs-search-url="${escapeHtml(searchSrc)}">
      <aside class="docs-sidebar">
        <button type="button" class="docs-search-trigger" data-docs-search-open>
          <span>${escapeHtml(messages.docsSearchLabel)}</span>
          <kbd>⌘K</kbd>
        </button>
        ${navigation}
      </aside>
      <details class="docs-mobile-nav">
        <summary>${escapeHtml(t.browse)} ⌄</summary>
        <div>${navigation}</div>
      </details>
      <article class="doc-article" data-doc-article>
        <div class="doc-breadcrumb">
          <a href="${home}">${escapeHtml(t.docs)}</a><span>/</span><span>${escapeHtml(document.sectionLabel)}</span>
          ${studioCallout}
        </div>
        ${
          document.toc.length > 0
            ? `<details class="doc-mobile-toc"><summary>${escapeHtml(t.onThisPage)}</summary><nav aria-label="${escapeHtml(t.sections)}">${tocLinks}</nav></details>`
            : ''
        }
        ${notice}
        <div lang="${document.contentLanguage}" data-copy-label="${escapeHtml(t.copy)}" data-copied-label="${escapeHtml(t.copied)}" data-copy-code-label="${escapeHtml(t.copyCode)}" data-copy-failed-label="${escapeHtml(t.copyFailed)}">${document.html}</div>
        ${renderPagination(documents, document.route, t)}
        <div class="doc-end">
          <span>${escapeHtml(t.ready)}</span>
          <a href="${locale.prefix}/#quick-start">${escapeHtml(t.instructions)} →</a>
        </div>
      </article>
      ${toc}
    </main>
    <dialog class="docs-search-dialog" data-docs-search-dialog aria-label="${escapeHtml(messages.docsSearchLabel)}">
      <input type="search" data-docs-search-input placeholder="${escapeHtml(messages.docsSearchPlaceholder)}" autofocus>
      <div class="docs-search-results" data-docs-search-results></div>
    </dialog>
  `;
  return pageShell({
    active: 'docs',
    locale,
    headLinks,
    alternatives,
    canonicalPath: document.fallback ? document.originalRoute : document.route,
    ...(document.fallback ? { robots: 'noindex,follow' } : {}),
    assets,
    body,
    config,
    description: document.description,
    path: document.route,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: document.title,
      inLanguage: document.contentLanguage,
      description: document.description,
      url: absoluteUrl(config.siteOrigin, document.route),
      isPartOf: {
        '@type': 'WebSite',
        name: 'ashfox Docs',
        url: absoluteUrl(config.siteOrigin, home),
      },
      publisher: {
        '@type': 'Organization',
        name: 'ashfox',
        url: absoluteUrl(config.siteOrigin, '/'),
      },
    },
    title: document.title,
  });
};
