import {
  landingContent
} from '../content.mjs';

export const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

export const absoluteUrl = (origin, pathname) =>
  origin ? new URL(pathname, origin).toString() : pathname;

const structuredDataScript = (value) =>
  value
    ? `<script type="application/ld+json">${JSON.stringify(value).replaceAll('<', '\\u003c')}</script>`
    : '';

export const githubUrl = 'https://github.com/sigee-min/ashfox';
export const contributeUrl = `${githubUrl}/blob/main/CONTRIBUTING.md`;

const brandMark = `
  <span class="brand-mark" aria-hidden="true">
    <img src="/brand/ashfox-mark.svg" alt="" width="30" height="30">
  </span>
`;

export const githubMark = `
  <img src="/icons/github.svg" alt="" width="20" height="20">
`;

export const githubIconButton = (className = '') => `
  <a
    class="icon-button ${className}"
    href="${githubUrl}"
    aria-label="ashfox on GitHub"
  >${githubMark}</a>
`;

const headerSetupButton = () => `
  <button
    class="header-setup"
    type="button"
    data-copy-agent-instruction
    data-instruction="${escapeHtml(landingContent.quickStart.instruction)}"
    aria-label="Copy setup instruction for your AI agent"
  >
    <span class="header-copy-glyph" aria-hidden="true"></span>
    <span
      data-copy-state
      data-default-state="Copy for agent"
      data-copied-state="Copied"
    >Copy for agent</span>
  </button>
`;

const siteHeader = ({ active }) => `
  <header class="site-header">
    <a class="brand" href="/" aria-label="ashfox home">
      ${brandMark}
      <span>ashfox</span>
    </a>
    <nav class="primary-nav" aria-label="Primary navigation">
      <a href="/#quick-start">Get started</a>
      <a ${active === 'docs' ? 'aria-current="page"' : ''} href="/docs/">Docs</a>
    </nav>
    <div class="header-actions">
      ${headerSetupButton()}
    </div>
  </header>
`;

export const pageShell = ({
  active,
  assets,
  body,
  config,
  description,
  headLinks = '',
  path,
  robots = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
  structuredData,
  title
}) => {
  const pageTitle = title === 'ashfox'
    ? 'ashfox — AI-native low-poly workbench'
    : `${title} — ashfox`;
  const canonical = absoluteUrl(config.siteOrigin, path);
  const socialImage = absoluteUrl(config.siteOrigin, '/og.png');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="theme-color" content="#111417">
    <meta name="robots" content="${escapeHtml(robots)}">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="en_US">
    <meta property="og:site_name" content="ashfox">
    <meta property="og:title" content="${escapeHtml(pageTitle)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:image" content="${escapeHtml(socialImage)}">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="ashfox — Build. Watch. Export.">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(socialImage)}">
    <meta name="twitter:image:alt" content="ashfox — Build. Watch. Export.">
    ${config.siteOrigin ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
    ${headLinks}
    <link rel="icon" href="/brand/ashfox-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="${assets.css}">
    <script type="module" src="${assets.js}"></script>
    ${structuredDataScript(structuredData)}
    <title>${escapeHtml(pageTitle)}</title>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    ${siteHeader({ active })}
    ${body}
    <footer class="site-footer">
      <a class="brand footer-brand" href="/">
        ${brandMark}
        <span>ashfox</span>
      </a>
      <p>AI-native low-poly workbench.</p>
      <div class="footer-links">
        <a href="/docs/">Documentation</a>
        <a href="${githubUrl}">GitHub</a>
        <span>© <span data-current-year></span> ashfox</span>
      </div>
    </footer>
  </body>
</html>`;
};
