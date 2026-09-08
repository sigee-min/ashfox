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

const docsNavigation = (documents, currentRoute) => `
  <nav class="docs-nav" aria-label="Documentation">
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
  const navigation = docsNavigation(documents, document.route);
  const index = documents.findIndex((page) => page.route === document.route);
  const adjacent = [
    { page: documents[index - 1], label: 'Previous' },
    { page: documents[index + 1], label: 'Next' }
  ].filter(({ page }) => page);
  const pagination = `<nav class="doc-pagination" aria-label="Continue reading">
    ${adjacent.map(({ page, label }) => `<a href="${escapeHtml(page.route)}">
      <span>${label}</span><strong>${escapeHtml(page.title)}</strong>
    </a>`).join('')}
  </nav>`;
  const tocLinks = document.toc.map((item) => `
    <a class="toc-level-${item.level}" href="#${item.id}">${escapeHtml(item.text)}</a>
  `).join('');
  const toc = document.toc.length > 0
    ? `<nav class="page-toc" aria-label="On this page">
        <p>On this page</p>
        ${tocLinks}
      </nav>`
    : '';
  const body = `
    <main id="main" class="docs-shell">
      <aside class="docs-sidebar">
        <a class="docs-home" href="/docs/">
          <span>ashfox Docs</span>
          <b>Build your first asset</b>
        </a>
        ${navigation}
      </aside>
      <details class="docs-mobile-nav">
        <summary>Browse documentation <span>⌄</span></summary>
        <div>${navigation}</div>
      </details>
      <article class="doc-article" data-doc-article>
        <div class="doc-breadcrumb">
          <a href="/docs/">Docs</a><span>/</span><span>${escapeHtml(document.sectionLabel)}</span>
        </div>
        ${document.toc.length > 0 ? `<details class="doc-mobile-toc">
          <summary>On this page</summary>
          <nav aria-label="Page sections">${tocLinks}</nav>
        </details>` : ''}
        ${document.html}
        ${pagination}
        <div class="doc-end">
          <span>Ready to make something?</span>
          <a href="/#quick-start">Get agent instructions →</a>
        </div>
      </article>
      ${toc}
    </main>
  `;
  return pageShell({
    active: 'docs',
    assets,
    body,
    config,
    description: document.description,
    path: document.route,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'TechArticle',
      headline: document.title,
      description: document.description,
      url: absoluteUrl(config.siteOrigin, document.route),
      isPartOf: {
        '@type': 'WebSite',
        name: 'ashfox Docs',
        url: absoluteUrl(config.siteOrigin, '/docs/')
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
