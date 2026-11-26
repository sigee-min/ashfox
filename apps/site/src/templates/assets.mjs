import { defaultLocale, localeRegistry } from '../locales.mjs';
import { siteMessages } from '../messages.mjs';
import { absoluteUrl, escapeHtml, pageShell } from './shell.mjs';

const domainCounts = (catalog) => {
  const counts = { all: catalog.length, model: 0, sprite: 0, tile: 0, sound: 0 };
  for (const item of catalog) counts[item.domain] = (counts[item.domain] || 0) + 1;
  return counts;
};

const renderThumb = (entry, lang) => {
  if (entry.domain === 'sprite' || entry.domain === 'tile') {
    return `<img src="${escapeHtml(entry.outputHref)}" width="32" height="32" alt="">`;
  }
  return entry.domain === 'model' ? '3D' : lang === 'ko' ? '음' : '♪';
};

const renderCatalogRows = (catalog, locale, initialId) =>
  catalog
    .map(
      (entry) => `
    <button
      type="button"
      class="studio-row"
      role="option"
      data-catalog-row="${escapeHtml(entry.id)}"
      data-domain="${escapeHtml(entry.domain)}"
      aria-selected="${String(entry.id === initialId)}"
    >
      <span class="studio-thumb" aria-hidden="true">${renderThumb(entry, locale.code)}</span>
      <strong>${escapeHtml(entry.name[locale.code] || entry.name.en)}</strong>
      <span>${escapeHtml(entry.category)}</span>
    </button>`,
    )
    .join('');

export const renderAssetsPage = ({ assets, catalog, config, locale = defaultLocale }) => {
  const messages = siteMessages(locale);
  const t = (key) => escapeHtml(messages[key]);
  const counts = domainCounts(catalog);
  const initial = catalog[0];
  const alternatives = localeRegistry.locales.map((option) => ({
    ...option,
    route: `${option.prefix}/assets/`,
  }));
  const body = `
    <main id="main" class="studio-shell" data-asset-studio data-locale="${locale.code}">
      <div class="studio-head">
        <div>
          <h1>${t('studioTitle')}</h1>
          <p>${t('studioSubtitle')}</p>
        </div>
        <span class="workbench-path" data-catalog-count>${counts.all} ${t('studioCountLabel')}</span>
      </div>
      <div class="studio-toolbar">
        <div class="segmented-strip" role="tablist" aria-label="${t('studioFilterLabel')}">
          ${[
            ['all', `${t('studioAll')} (${counts.all})`, true],
            ['model', `${t('studioModels')} (${counts.model})`, false],
            ['sprite', `${t('studioSprites')} (${counts.sprite})`, false],
            ['tile', `${t('studioTiles')} (${counts.tile})`, false],
            ['sound', `${t('studioSounds')} (${counts.sound})`, false],
          ]
            .map(
              ([id, label, active]) =>
                `<button type="button" data-domain-tab="${id}" aria-pressed="${String(active)}">${label}</button>`,
            )
            .join('')}
        </div>
        <input class="studio-search" type="search" data-studio-search placeholder="${t('studioSearchPlaceholder')}" aria-label="${t('studioSearchPlaceholder')}">
      </div>
      <div class="studio-grid">
        <div class="studio-list" role="listbox" aria-label="${t('studioListLabel')}" data-studio-list>
          ${renderCatalogRows(catalog, locale, initial.id)}
        </div>
        <section class="studio-inspector" aria-live="polite" data-studio-inspector>
          <div class="inspector-head">
            <div>
              <h2 data-inspector-title>${escapeHtml(initial.name[locale.code])}</h2>
              <p data-inspector-specs>${escapeHtml(initial.specs[locale.code])}</p>
            </div>
            <div class="inspector-actions">
              <button type="button" class="button button-primary" data-copy-asset-prompt>${t('studioCopyPrompt')}</button>
              <a class="button button-ghost" data-inspector-download href="${escapeHtml(initial.outputHref)}" download>${t('studioDownload')} ↓</a>
            </div>
          </div>
          <div class="inspector-stage" data-inspector-stage>
            <div class="inspector-3d-host" data-inspector-3d></div>
            <img class="inspector-sprite-preview" data-inspector-sprite hidden alt="">
            <div class="inspector-tile-grid" data-inspector-tile hidden></div>
            <img class="inspector-wave" data-inspector-wave hidden alt="${t('waveAlt')}">
            <audio data-studio-audio preload="none" hidden></audio>
            <div class="inspector-controls" data-inspector-controls></div>
          </div>
          <div class="inspector-source">
            <div class="inspector-source-bar">
              <code data-inspector-source-path>${escapeHtml(initial.sourcePath)}</code>
              <div>
                <button type="button" class="button button-ghost" data-copy-asset-source>${t('copy')}</button>
                <a class="linear-link" data-inspector-source-link href="${escapeHtml(initial.sourceHref)}">${t('fullSource')}</a>
              </div>
            </div>
            <p class="hero-lead" data-inspector-summary>${escapeHtml(initial.summary[locale.code])}</p>
            <pre tabindex="0"><code data-inspector-code>${t('loadingSource')}</code></pre>
          </div>
        </section>
      </div>
      <script type="application/json" id="asset-catalog-data">${JSON.stringify(catalog).replaceAll('<', '\\u003c')}</script>
    </main>
    <script defer src="${assets.viewerJs}"></script>`;

  return pageShell({
    active: 'assets',
    assets,
    body,
    config,
    description: messages.studioSubtitle,
    path: `${locale.prefix}/assets/`,
    title: messages.studioTitle,
    locale,
    alternatives,
    headLinks:
      alternatives
        .map(
          (option) =>
            `<link rel="alternate" hreflang="${option.code}" href="${absoluteUrl(config.siteOrigin, option.route)}">`,
        )
        .join('') +
      `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(config.siteOrigin, '/assets/')}">`,
  });
};
