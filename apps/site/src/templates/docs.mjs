import {
  absoluteUrl,
  escapeHtml,
  pageShell
} from './shell.mjs';

const groupDocuments = (documents) =>
  [...new Set(documents.map((document) => document.section))].map((section) => ({
    label: documents.find((document) => document.section === section).sectionLabel,
    documents: documents.filter((document) => document.section === section)
  }));

const docsNavigation = (documents, currentRoute, t) => `
  <nav class="docs-nav" aria-label="${escapeHtml(t.documentation)}">
    ${groupDocuments(documents).map((group) => `
      <section>
        <h2>${escapeHtml(group.label)}</h2>
        ${group.documents.map((document) => `
          <a
            ${document.route === currentRoute ? 'aria-current="page"' : ''}
            href="${document.route}"
          >${escapeHtml(document.title)}</a>
        `).join('')}
      </section>
    `).join('')}
  </nav>
`;

export const renderDocumentationPage = ({
  assets,
  config,
  document,
  documents
}) => {
  const { locale } = document;
  const t = locale.ui;
  const home = `${locale.prefix}/docs/`;
  const navigation = docsNavigation(documents, document.route, t);
  const alternatives = document.alternatives ?? [];
  const languagePicker = `<nav class="docs-languages" aria-label="${escapeHtml(t.language)}">
    ${alternatives.map(option => `<a href="${option.route}" lang="${option.code}" ${option.code === locale.code ? 'aria-current="true"' : ''}>${escapeHtml(option.label)}</a>`).join('')}
  </nav>`;
  const notice = document.fallback || document.stale ? `<aside class="translation-notice" role="note">
    ${escapeHtml(document.stale ? t.stale : t.fallback)} <a href="${document.originalRoute}">${escapeHtml(t.original)}</a>
  </aside>` : '';
  const headLinks = alternatives.filter(option => option.translated).map(option =>
    `<link rel="alternate" hreflang="${option.code}" href="${absoluteUrl(config.siteOrigin, option.route)}">`).join('') +
    `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(config.siteOrigin, document.originalRoute)}">`;
  const index = documents.findIndex((page) => page.route === document.route);
  const adjacent = [
    { page: documents[index - 1], label: t.previous },
    { page: documents[index + 1], label: t.next }
  ].filter(({ page }) => page);
  const pagination = `<nav class="doc-pagination" aria-label="${escapeHtml(t.continue)}">
    ${adjacent.map(({ page, label }) => `<a href="${escapeHtml(page.route)}">
      <span>${label}</span><strong>${escapeHtml(page.title)}</strong>
    </a>`).join('')}
  </nav>`;
  const tocLinks = document.toc.map((item) => `
    <a class="toc-level-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>
  `).join('');
  const toc = document.toc.length > 0
    ? `<nav class="page-toc" aria-label="${escapeHtml(t.onThisPage)}">
        <p>${escapeHtml(t.onThisPage)}</p>
        ${tocLinks}
      </nav>`
    : '';
  const body = `
    <main id="main" class="docs-shell">
      <aside class="docs-sidebar">
        <a class="docs-home" href="${home}">
          <span>ashfox Docs</span>
          <b>${escapeHtml(t.firstAsset)}</b>
        </a>
        ${navigation}
      </aside>
      <details class="docs-mobile-nav">
        <summary>${escapeHtml(t.browse)} <span>⌄</span></summary>
        <div>${navigation}</div>
      </details>
      <article class="doc-article" data-doc-article>
        <div class="doc-breadcrumb">
          <a href="${home}">${escapeHtml(t.docs)}</a><span>/</span><span>${escapeHtml(document.sectionLabel)}</span>
        </div>
        ${document.toc.length > 0 ? `<details class="doc-mobile-toc">
          <summary>${escapeHtml(t.onThisPage)}</summary>
          <nav aria-label="${escapeHtml(t.sections)}">${tocLinks}</nav>
        </details>` : ''}
        ${languagePicker}
        ${notice}
        <div lang="${document.contentLanguage}" data-copy-label="${escapeHtml(t.copy)}" data-copied-label="${escapeHtml(t.copied)}" data-copy-code-label="${escapeHtml(t.copyCode)}" data-copy-failed-label="${escapeHtml(t.copyFailed)}">${document.html}</div>
        ${pagination}
        <div class="doc-end">
          <span>${escapeHtml(t.ready)}</span>
          <a href="/#quick-start">${escapeHtml(t.instructions)} →</a>
        </div>
      </article>
      ${toc}
    </main>
  `;
  return pageShell({
    active: 'docs',
    locale, headLinks,
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
        url: absoluteUrl(config.siteOrigin, home)
      },
      publisher: {
        '@type': 'Organization',
        name: 'ashfox',
        url: absoluteUrl(config.siteOrigin, '/')
      }
    },
    title: document.title
  });
};
