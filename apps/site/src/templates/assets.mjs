import { defaultLocale, localeRegistry } from '../locales.mjs';
import { siteMessages } from '../messages.mjs';
import { absoluteUrl, escapeHtml, pageShell } from './shell.mjs';

const DOMAIN_ORDER = ['all', 'model', 'structure', 'vfx', 'sprite', 'tile', 'sound'];

const domainCounts = (catalog) => {
  const counts = {
    all: catalog.length,
    model: 0,
    structure: 0,
    vfx: 0,
    sprite: 0,
    tile: 0,
    sound: 0,
  };
  for (const item of catalog) counts[item.domain] = (counts[item.domain] || 0) + 1;
  return counts;
};

const domainLabel = (t, domain) => {
  const map = {
    all: t('studioAll'),
    model: t('studioModels'),
    structure: t('studioStructures'),
    vfx: t('studioVfx'),
    sprite: t('studioSprites'),
    tile: t('studioTiles'),
    sound: t('studioSounds'),
  };
  return map[domain] || escapeHtml(domain);
};

const thumbSource = (entry) => {
  if (entry.domain === 'sound') return entry.previewHref || entry.thumbHref || entry.outputHref;
  if (entry.domain === 'sprite' || entry.domain === 'tile') {
    return entry.thumbHref || entry.outputHref;
  }
  return entry.thumbHref || entry.previewHref || '';
};

const thumbClass = (domain) => {
  if (domain === 'sprite' || domain === 'tile') return 'thumb-pixel';
  if (domain === 'sound') return 'thumb-wave';
  return 'thumb-3d';
};

const renderThumbImg = (entry, lang, eager = false) => {
  const src = thumbSource(entry);
  if (!src) return `<span class="thumb-fallback">${escapeHtml(entry.domain)}</span>`;
  const loadingAttr = eager ? '' : ' loading="lazy"';
  const alt = escapeHtml(entry.name?.[lang] || entry.name?.en || entry.id);
  return `<img class="${thumbClass(entry.domain)}" src="${escapeHtml(src)}" alt="${alt}"${loadingAttr}>`;
};

const renderDomainTabs = (t, counts) =>
  DOMAIN_ORDER.map(
    (id, index) =>
      `<button type="button" data-domain-tab="${id}" aria-pressed="${String(index === 0)}">${domainLabel(t, id)} <span class="tab-count">${counts[id] || 0}</span></button>`,
  ).join('');

const renderGalleryCards = (catalog, t, lang) =>
  catalog
    .map((entry) => {
      const title = escapeHtml(entry.name?.[lang] || entry.name?.en || entry.id);
      const specs = escapeHtml(entry.specs?.[lang] || entry.specs?.en || '');
      const badge = domainLabel(t, entry.domain);
      return `
      <button type="button" class="studio-card" data-gallery-card="${escapeHtml(entry.id)}" data-domain="${escapeHtml(entry.domain)}" data-genre="${escapeHtml(entry.genre || '')}">
        <div class="card-thumb" data-thumb-kind="${escapeHtml(entry.domain)}">
          ${renderThumbImg(entry, lang, false)}
          <span class="card-badge">${badge}</span>
        </div>
        <div class="card-body">
          <h3>${title}</h3>
          <p class="card-meta">${specs}</p>
        </div>
      </button>`;
    })
    .join('');

const renderCatalogRows = (catalog, locale, initialId) =>
  catalog
    .map((entry) => {
      const title = escapeHtml(entry.name?.[locale.code] || entry.name?.en || entry.id);
      return `
      <button type="button" class="studio-row" role="option" data-catalog-row="${escapeHtml(entry.id)}" data-domain="${escapeHtml(entry.domain)}" aria-selected="${String(entry.id === initialId)}">
        <span class="studio-thumb" aria-hidden="true">${renderThumbImg(entry, locale.code, false)}</span>
        <span class="studio-row-meta">
          <strong>${title}</strong>
          <span>${escapeHtml(entry.genre || entry.category || entry.domain)}</span>
        </span>
      </button>`;
    })
    .join('');

const render3dStage = (t) => `
      <div class="stage-3d" data-stage-3d hidden>
        <div class="inspector-3d-host" data-inspector-3d></div>
        <div class="stage-loading" data-stage-loading hidden>
          <div class="stage-loading-track"><div class="stage-loading-fill" data-stage-progress></div></div>
          <span>${t('stageLoading')}</span>
        </div>
        <div class="hud-3d" data-hud-3d>
          <div class="hud-group">
            <button type="button" class="hud-btn" data-hud-wireframe aria-pressed="false" title="W">${t('hudWireframe')} <kbd>W</kbd></button>
            <button type="button" class="hud-btn" data-hud-grid aria-pressed="true" title="G">${t('hudGrid')} <kbd>G</kbd></button>
            <button type="button" class="hud-btn" data-hud-rotate aria-pressed="false">${t('hudRotate')}</button>
          </div>
          <div class="hud-group segmented-strip" aria-label="${t('hudBackdrop')}">
            <button type="button" data-hud-backdrop="obsidian" aria-pressed="true">${t('backdropObsidian')}</button>
            <button type="button" data-hud-backdrop="slate" aria-pressed="false">${t('backdropSlate')}</button>
            <button type="button" data-hud-backdrop="light" aria-pressed="false">${t('backdropLight')}</button>
          </div>
          <div class="hud-group segmented-strip" aria-label="${t('hudCamera')}">
            <button type="button" data-hud-cam="iso">${t('camIso')}</button>
            <button type="button" data-hud-cam="front">${t('camFront')}</button>
            <button type="button" data-hud-cam="side">${t('camSide')}</button>
            <button type="button" data-hud-cam="top">${t('camTop')}</button>
            <button type="button" data-hud-cam="reset" title="R">${t('camReset')}</button>
          </div>
          <div class="hud-group">
            <div class="segmented-strip" data-hud-lod-wrap hidden aria-label="${t('hudLod')}">
              <button type="button" data-hud-lod="auto" aria-pressed="true">${t('lodAuto')}</button>
              <button type="button" data-hud-lod="LOD0" aria-pressed="false">0</button>
              <button type="button" data-hud-lod="LOD1" aria-pressed="false">1</button>
              <button type="button" data-hud-lod="LOD2" aria-pressed="false">2</button>
            </div>
            <span class="hud-tris" data-hud-tris hidden></span>
            <button type="button" class="hud-btn" data-hud-fullscreen title="F">${t('hudFullscreen')} <kbd>F</kbd></button>
          </div>
        </div>
        <div class="motion-bar" data-motion-bar hidden>
          <div class="segmented-strip motion-clips" data-motion-clips></div>
          <button type="button" class="hud-btn" data-motion-play aria-pressed="true">⏸ ${t('motionPause')}</button>
          <div class="segmented-strip">
            <button type="button" data-motion-speed="0.5" aria-pressed="false">0.5x</button>
            <button type="button" data-motion-speed="1" aria-pressed="true">1x</button>
            <button type="button" data-motion-speed="2" aria-pressed="false">2x</button>
          </div>
          <input class="motion-scrub" type="range" min="0" max="1000" value="0" data-motion-scrub aria-label="Animation timeline">
          <button type="button" class="hud-btn" data-vfx-replay hidden>${t('motionReplay')}</button>
        </div>
      </div>`;

const render2dStage = (t) => `
      <div class="stage-2d" data-stage-2d data-backdrop="checker" hidden>
        <div class="hud-2d">
          <div class="segmented-strip" aria-label="${t('hudBackdrop')}">
            <button type="button" data-2d-backdrop="checker" aria-pressed="true">${t('backdropChecker')}</button>
            <button type="button" data-2d-backdrop="obsidian" aria-pressed="false">${t('backdropObsidian')}</button>
            <button type="button" data-2d-backdrop="light" aria-pressed="false">${t('backdropLight')}</button>
          </div>
          <div class="segmented-strip" aria-label="Zoom">
            <button type="button" data-2d-zoom="1" aria-pressed="false">1x</button>
            <button type="button" data-2d-zoom="4" aria-pressed="true">4x</button>
            <button type="button" data-2d-zoom="8" aria-pressed="false">8x</button>
          </div>
          <button type="button" class="hud-btn" data-2d-grid aria-pressed="false">${t('pixelGrid')}</button>
          <button type="button" class="hud-btn" data-2d-tile-toggle aria-pressed="true" hidden>${t('studioToggleTile')}</button>
        </div>
        <div class="stage-2d-viewport">
          <div class="stage-2d-canvas" data-2d-canvas-wrap>
            <img class="inspector-sprite-preview" data-inspector-sprite hidden alt="">
            <div class="inspector-tile-grid" data-inspector-tile hidden></div>
          </div>
          <div class="nineslice-stage" data-nineslice-stage hidden>
            <div class="nineslice-toolbar">
              <label>${t('nineSliceWidth')} <input type="range" min="80" max="400" value="224" data-nineslice-width></label>
              <label>${t('nineSliceHeight')} <input type="range" min="64" max="260" value="144" data-nineslice-height></label>
              <span class="nineslice-meta" data-nineslice-size>224 × 144px</span>
              <span class="nineslice-meta">${t('nineSliceInsets')}: <strong data-nineslice-insets>6px / 6px / 6px / 6px</strong></span>
            </div>
            <div class="nineslice-viewport">
              <div class="nineslice-box" data-nineslice-box>
                <span class="nineslice-caption">${t('nineSliceLabel')}</span>
                <button type="button" class="nineslice-handle" data-nineslice-handle aria-label="${t('nineSliceLabel')}"></button>
              </div>
            </div>
          </div>
          <div class="crosshair-stage" data-crosshair-stage hidden>
            <div class="segmented-strip">
              <button type="button" data-crosshair-bg="dark" aria-pressed="false">${t('crosshairDark')}</button>
              <button type="button" data-crosshair-bg="light" aria-pressed="false">${t('crosshairLight')}</button>
              <button type="button" data-crosshair-bg="hud" aria-pressed="true">${t('crosshairHud')}</button>
            </div>
            <div class="crosshair-preview" data-crosshair-preview data-crosshair-theme="hud">
              <img data-crosshair-img alt="">
            </div>
          </div>
        </div>
      </div>`;

const renderAudioStage = (t) => `
      <div class="stage-audio" data-stage-audio hidden>
        <div class="audio-stage-card">
          <canvas class="audio-wave-canvas" data-audio-canvas width="560" height="160" aria-label="${t('waveAlt')}"></canvas>
          <audio data-studio-audio preload="none" hidden></audio>
          <div class="audio-controls">
            <button type="button" class="button button-primary" data-audio-play aria-pressed="false">▶ ${t('motionPlay')}</button>
            <button type="button" class="button button-ghost" data-audio-loop aria-pressed="false">${t('audioLoop')}</button>
            <div class="segmented-strip" data-audio-variants hidden>
              <button type="button" data-audio-variant="base" aria-pressed="true">${t('audioBase')}</button>
              <button type="button" data-audio-variant="alternate" aria-pressed="false">${t('audioAlt')}</button>
            </div>
            <span class="audio-time" data-audio-time>0:00 / 0:00</span>
          </div>
        </div>
      </div>`;

const renderInspector = (t, initial, locale) => `
      <aside class="wb-inspector" aria-live="polite" data-studio-inspector>
        <div class="inspector-head">
          <div class="inspector-title-row">
            <div>
              <h2 data-inspector-title>${escapeHtml(initial.name?.[locale.code] || initial.name?.en || '')}</h2>
              <p data-inspector-specs>${escapeHtml(initial.specs?.[locale.code] || initial.specs?.en || '')}</p>
            </div>
            <button type="button" class="wb-icon-btn" data-inspector-toggle aria-expanded="true" title="${t('studioToggleInspector')}">⇥</button>
          </div>
          <p class="inspector-summary" data-inspector-summary>${escapeHtml(initial.summary?.[locale.code] || initial.summary?.en || '')}</p>
          <div class="inspector-actions">
            <a class="button button-primary" data-inspector-download href="${escapeHtml(initial.outputHref)}" download>${t('studioDownload')} ↓</a>
            <button type="button" class="button button-ghost" data-copy-asset-prompt>${t('studioCopyPrompt')}</button>
          </div>
        </div>
        <div class="inspector-tabs" role="tablist">
          <button type="button" role="tab" data-inspector-tab="source" aria-selected="true">${t('tabSource')}</button>
          <button type="button" role="tab" data-inspector-tab="specs" aria-selected="false">${t('tabSpecs')}</button>
          <button type="button" role="tab" data-inspector-tab="use" aria-selected="false">${t('tabUse')}</button>
        </div>
        <div class="inspector-body">
          <div class="inspector-panel" data-panel-source>
            <div class="inspector-source-bar">
              <code data-inspector-source-path>${escapeHtml(initial.sourcePath)}</code>
              <div class="source-bar-actions">
                <button type="button" class="button button-ghost" data-source-raw aria-pressed="false">${t('sourceRaw')}</button>
                <button type="button" class="button button-ghost" data-copy-asset-source>${t('copy')}</button>
                <a class="linear-link" data-inspector-source-link href="${escapeHtml(initial.sourceHref)}">${t('fullSource')}</a>
              </div>
            </div>
            <pre class="studio-code-pre" tabindex="0"><code data-inspector-code>${t('loadingSource')}</code></pre>
          </div>
          <div class="inspector-panel" data-panel-specs hidden>
            <dl class="specs-table" data-specs-table></dl>
            <div class="specs-tags-wrap">
              <h4>${t('specTags')}</h4>
              <div class="specs-tags" data-specs-tags></div>
            </div>
          </div>
          <div class="inspector-panel" data-panel-use hidden>
            <div class="use-snippets" data-use-snippets></div>
          </div>
        </div>
      </aside>`;

export const renderAssetsPage = ({ assets, catalog, config, locale = defaultLocale }) => {
  const messages = siteMessages(locale);
  const t = (key) => escapeHtml(messages[key]);
  const counts = domainCounts(catalog);
  const initial = catalog[0] || {
    id: '',
    name: { en: '', ko: '' },
    specs: { en: '', ko: '' },
    summary: { en: '', ko: '' },
    outputHref: '',
    sourcePath: '',
    sourceHref: '',
  };
  const alternatives = localeRegistry.locales.map((option) => ({
    ...option,
    route: `${option.prefix}/assets/`,
  }));
  const body = `
    <main id="main" class="studio-shell" data-asset-studio data-studio-app data-studio-mode="gallery" data-locale="${locale.code}">
      <div class="studio-topbar" data-studio-topbar>
        <div class="topbar-main">
          <div class="topbar-title">
            <h1>${t('studioTitle')}</h1>
            <span class="studio-count-badge" data-catalog-count>${counts.all} ${t('studioCountLabel')}</span>
          </div>
          <div class="segmented-strip domain-strip" role="tablist" aria-label="${t('studioFilterLabel')}">
            ${renderDomainTabs(t, counts)}
          </div>
          <div class="topbar-controls">
            <input class="studio-search" type="search" data-studio-search placeholder="${t('studioSearchPlaceholder')}" aria-label="${t('studioSearchPlaceholder')}">
            <div class="segmented-strip mode-strip" role="group" aria-label="View mode">
              <button type="button" data-studio-mode-btn="gallery" aria-pressed="true">${t('studioModeGallery')}</button>
              <button type="button" data-studio-mode-btn="workbench" aria-pressed="false">${t('studioModeWorkbench')}</button>
            </div>
          </div>
        </div>
        <div class="genre-bar" data-genre-bar hidden></div>
      </div>

      <section class="studio-gallery" data-studio-gallery>
        <div class="gallery-grid" data-studio-gallery-grid>
          ${renderGalleryCards(catalog, t, locale.code)}
        </div>
        <div class="studio-empty" data-gallery-empty hidden>
          <h2>${t('studioEmptyTitle')}</h2>
          <p>${t('studioEmptyBody')}</p>
          <button type="button" class="button button-primary" data-gallery-reset>${t('studioResetFilters')}</button>
        </div>
      </section>

      <section class="studio-workbench" data-studio-workbench hidden>
        <aside class="wb-rail" data-wb-rail>
          <div class="wb-rail-head">
            <span>${t('studioListLabel')}</span>
            <button type="button" class="wb-icon-btn" data-rail-toggle aria-expanded="true" title="${t('studioToggleRail')}">⇤</button>
          </div>
          <div class="wb-list" role="listbox" aria-label="${t('studioListLabel')}" data-studio-list>
            ${renderCatalogRows(catalog, locale, initial.id)}
          </div>
          <div class="studio-empty wb-rail-empty" data-rail-empty hidden>
            <p>${t('studioEmptyTitle')}</p>
            <button type="button" class="button button-ghost" data-reset-filters>${t('studioResetFilters')}</button>
          </div>
        </aside>
        <div class="wb-stage" data-wb-stage>
          ${render3dStage(t)}
          ${render2dStage(t)}
          ${renderAudioStage(t)}
        </div>
        ${renderInspector(t, initial, locale)}
      </section>

      <script type="application/json" id="asset-catalog-data">${JSON.stringify(catalog).replaceAll('<', '\\u003c')}</script>
    </main>
    <script defer src="${assets.viewerJs}"></script>
    ${assets.studioJs ? `<script defer src="${assets.studioJs}"></script>` : ''}`;

  return pageShell({
    active: 'assets',
    assets,
    body,
    config,
    description: String(messages.studioSubtitle || '').replace('{count}', String(counts.all)),
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
