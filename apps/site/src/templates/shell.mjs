import { defaultLocale } from '../locales.mjs';
import { brand } from '../content.mjs';

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


const siteHeader = ({ active, locale }) => `
  <header class="site-header">
    <a class="brand" href="/" aria-label="ashfox home">
      ${brandMark}
      <span>ashfox</span>
    </a>
    <nav class="primary-nav" aria-label="${escapeHtml(locale.ui.navigation)}">
      <a href="/#examples">${escapeHtml(locale.ui.examples)}</a>
      <a ${active === 'docs' ? 'aria-current="page"' : ''} href="${locale.prefix}/docs/">${escapeHtml(locale.ui.docs)}</a>
    </nav>
    <div class="header-actions">
      <a class="header-setup" href="${locale.prefix}/docs/guides/install/">${escapeHtml(locale.ui.getStarted)} ↗</a>
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
  locale = defaultLocale,
  canonicalPath,
  path,
  robots = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1',
  structuredData,
  title
}) => {
  const pageTitle = title === 'ashfox'
    ? `ashfox — ${brand.title}`
    : `${title} — ashfox`;
  const canonical = absoluteUrl(config.siteOrigin, canonicalPath ?? path);
  const socialImage = absoluteUrl(config.siteOrigin, assets.social[active === 'docs' ? 'docs' : 'landing']);
  const socialAlt = active === 'docs'
    ? 'Ashfox documentation — DSL reference, guides and game integration.'
    : 'Ashfox — Assets as Code. Built for voxel games. Griffin model compiled from native source.';
  return `<!doctype html>
<html lang="${locale.code}">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="theme-color" content="#111417">
    <meta name="robots" content="${escapeHtml(robots)}">
    <meta property="og:type" content="website">
    <meta property="og:locale" content="${locale.ogLocale}">
    <meta property="og:site_name" content="ashfox">
    <meta property="og:title" content="${escapeHtml(pageTitle)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${escapeHtml(canonical)}">
    <meta property="og:image" content="${escapeHtml(socialImage)}">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="${escapeHtml(socialAlt)}">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(socialImage)}">
    <meta name="twitter:image:alt" content="${escapeHtml(socialAlt)}">
    ${config.siteOrigin ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : ''}
    ${headLinks}
    <link rel="icon" href="/brand/ashfox-mark.svg" type="image/svg+xml">
    <link rel="stylesheet" href="${assets.css}">
    <script type="module" src="${assets.js}"></script>
    ${structuredDataScript(structuredData)}
    <title>${escapeHtml(pageTitle)}</title>
  </head>
  <body>
    <a class="skip-link" href="#main">${escapeHtml(locale.ui.skip)}</a>
    ${siteHeader({ active, locale })}
    ${body}
    <footer class="site-footer">
      <a class="brand footer-brand" href="/">
        ${brandMark}
        <span>ashfox</span>
      </a>
      <p>Assets as Code. Built for voxel games.</p>
      <div class="footer-links">
        <a href="${locale.prefix}/docs/">${escapeHtml(locale.ui.documentation)}</a>
        <a href="${githubUrl}">GitHub</a>
        <span>© <span data-current-year></span> ashfox</span>
      </div>
    </footer>
  </body>
</html>`;
};
