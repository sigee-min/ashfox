import { defaultLocale, localeRegistry } from '../locales.mjs';
import { siteMessages } from '../messages.mjs';
import { absoluteUrl, escapeHtml, githubUrl, pageShell } from './shell.mjs';

const HANDOFF_MOSAIC = [
  { src: '/media/catalog/thumbs/griffin.png', kind: 'thumb' },
  { src: '/media/catalog/thumbs/tavern.png', kind: 'thumb' },
  { src: '/media/catalog/thumbs/scifi-drone.png', kind: 'thumb' },
  { src: '/media/catalog/thumbs/flame-cleave.png', kind: 'thumb' },
  { src: '/media/catalog/iron-sword.png', kind: 'pixel' },
  { src: '/media/catalog/ui-inventory-panel.png', kind: 'pixel' },
];

const computeCatalogCounts = (catalog = []) => {
  const counts = {
    all: catalog.length,
    model: 0,
    structure: 0,
    vfx: 0,
    sprite: 0,
    tile: 0,
    sound: 0,
  };
  for (const item of catalog) {
    if (item?.domain) counts[item.domain] = (counts[item.domain] || 0) + 1;
  }
  return {
    ...counts,
    twod: counts.sprite + counts.tile,
  };
};

const CATALOG_HREF_KEYS = [
  'outputHref',
  'thumbHref',
  'previewHref',
  'alternateHref',
  'alternateWaveHref',
];

const buildCatalogVersionMap = (catalog = []) => {
  const versions = {};
  for (const item of catalog) {
    if (!item) continue;
    for (const key of CATALOG_HREF_KEYS) {
      const href = item[key];
      if (typeof href !== 'string' || !href.startsWith('/media/catalog/')) continue;
      versions[href.split('?')[0]] = href;
    }
  }
  return versions;
};

const formatCount = (template, count) =>
  escapeHtml(String(template || '').replace('{count}', String(count)));

const renderPromptInstall = (t) => `
  <div class="hero-start" id="quick-start">
    <div class="prompt-bar">
      <span class="prompt-chevron" aria-hidden="true">›</span>
      <pre class="prompt-code" tabindex="0"><code>${t('instruction')}</code></pre>
      <button class="button button-primary prompt-copy-btn" data-copy-agent-instruction data-instruction="${t('instruction')}">
        <span data-copy-state data-default-state="${t('copyInstruction')}" data-copied-state="${t('copied')}">${t('copyInstruction')}</span>
      </button>
    </div>
    <p data-copy-feedback data-default-feedback="${t('pasteInstruction')}" role="status">${t('pasteInstruction')}</p>
    <noscript><p>${t('javascriptRequired')}</p></noscript>
  </div>`;

const renderHero = (t) => `
  <section class="world-hero" id="examples" aria-label="${t('pageTitle')}">
    <div class="hero-copy">
      <div class="hero-glow" aria-hidden="true"></div>
      <div class="hero-title-group">
        <h1>Assets<br><span>as Code.</span></h1>
        <p class="hero-subtitle">${t('heroSubtitle')}</p>
      </div>
      ${renderPromptInstall(t)}
    </div>
    <a class="hero-scroll-cue" href="#stage" aria-label="${t('exploreGriffin')}">
      <span class="scroll-line" aria-hidden="true"></span>
    </a>
  </section>`;

const renderDiffEditor = (t) => `        <div class="diff-editor source-window" id="source">
          <div class="diff-token-bar">
            <span class="diff-token-label">${t('diffClickHint')}</span>
            <div class="diff-tokens" data-diff-tokens></div>
          </div>
          <div class="diff-patch" aria-label="git diff">
            <pre><code data-diff-patch><span class="diff-ctx">  1  ashfox 1</span>
<span class="diff-del">-    model scifi_drone { import "std/model/rig/drone" as drone_rig; }</span>
<span class="diff-add">+    model griffin_boss { import "std/model/rig/winged_quadruped" as wq; }</span></code></pre>
          </div>
          <div class="source-code">
            <pre tabindex="0" aria-label="${t('sourceExcerpt')}"><code data-source-code>${t('loadingSource')}</code></pre>
          </div>
        </div>`;

const renderDiffOutput = (t, assets, griffin, catalogHref) => `        <div class="diff-output">
          <div class="diff-stage-3d" data-diff-pane="3d">
            <div class="world-stage-wrap">
              <div class="world-stage" data-live-model data-model-src="${assets.heroModel}"><img src="${griffin.posterSrc}" width="640" height="360" fetchpriority="high" alt="${t('heroAlt')}"></div>
              <div class="drag-cue" data-drag-cue aria-hidden="true">↔ ${t('dragCue')}</div>
            </div>
            <div class="diff-stage-controls" data-diff-3d-controls>
              <div class="segmented-strip" role="group" aria-label="${t('modelControls')}">${[
                ['idle', t('lookAround')],
                ['wing_display', t('spreadWings')],
                ['wing_flap', t('greet')],
              ]
                .map(
                  ([id, label]) =>
                    `<button data-model-motion="${id}" aria-pressed="false" disabled>${label}</button>`,
                )
                .join('')}</div>
              <details class="view-options"><summary>${t('cameraViews')}</summary><div class="view-controls"><button data-model-view="3.14159" disabled>${t('front')}</button><button data-model-view="4.71239" disabled>${t('side')}</button><button data-model-view="3.79159" disabled>${t('reset')}</button></div></details>
            </div>
          </div>
          <div class="diff-stage-2d" data-diff-pane="2d" hidden>
            <div class="diff-2d-canvas">
              <img class="diff-2d-sprite" data-diff-image src="${escapeHtml(catalogHref('/media/catalog/iron-sword.png'))}" width="256" height="256" alt="${t('swordAlt')}">
              <div class="diff-2d-tile" data-diff-tile hidden></div>
            </div>
            <div class="diff-2d-meta">
              <img class="diff-2d-native" data-diff-native src="${escapeHtml(catalogHref('/media/catalog/iron-sword.png'))}" width="32" height="32" alt="">
              <span data-diff-2d-label>32×32 PNG · material = weapon.steel</span>
            </div>
          </div>
          <div class="diff-stage-sfx" data-diff-pane="sfx" hidden>
            <img class="diff-sfx-wave" data-diff-wave src="${escapeHtml(catalogHref('/media/catalog/claw-hit.svg'))}" width="480" height="160" alt="${t('waveAlt')}">
            <div class="diff-sfx-controls">
              <button type="button" class="button button-primary" data-diff-play>▶ ${t('playSound')}</button>
              <span class="workbench-path" data-diff-sfx-label>claw_hit · seed = 42</span>
            </div>
            <audio data-diff-audio preload="none" src="${escapeHtml(catalogHref('/media/catalog/claw-hit.wav'))}" hidden></audio>
          </div>
        </div>`;

const renderDiffStatusBar = (t, locale, catalogHref) => `      <div class="workbench-statusbar">
        <span data-model-status role="status">${t('modelStatus')}</span>
        <div class="world-index">
          <a data-diff-studio-link href="${locale.prefix}/assets/?asset=griffin">${t('openInStudio')} →</a>
          <a data-diff-source-link href="/showcase/assets/models/griffin_boss.ashfox">${t('exploreSource')}</a>
          <a data-diff-download-link href="${escapeHtml(catalogHref('/media/catalog/griffin.glb'))}" download>${t('downloadModel')}</a>
        </div>
      </div>`;

const renderLiveDiffStage = (t, locale, assets, griffin, catalogVersionMap, catalogHref) => `
  <section class="landing-section stage-section" id="stage" aria-labelledby="diff-stage-title">
    <div class="linear-head linear-head-compact" data-reveal>
      <h2 id="diff-stage-title">${t('diffStageTitle')}</h2>
    </div>
    <div class="diff-workbench" data-live-diff data-locale="${locale.code}" data-catalog-versions="${escapeHtml(JSON.stringify(catalogVersionMap))}" data-reveal>
      <div class="diff-topbar">
        <div class="segmented-strip" role="tablist" aria-label="${t('diffStageTitle')}">
          <button type="button" data-diff-domain="model" aria-pressed="true">${t('diffTabModel')}</button>
          <button type="button" data-diff-domain="structure" aria-pressed="false">${t('diffTabStructure')}</button>
          <button type="button" data-diff-domain="vfx" aria-pressed="false">${t('diffTabVfx')}</button>
          <button type="button" data-diff-domain="2d" aria-pressed="false">${t('diffTab2d')}</button>
          <button type="button" data-diff-domain="sfx" aria-pressed="false">${t('diffTabSfx')}</button>
        </div>
        <span class="workbench-path" data-diff-filepath>showcase/assets/models/griffin_boss.ashfox</span>
      </div>
      <div class="diff-split">
${renderDiffEditor(t)}
${renderDiffOutput(t, assets, griffin, catalogHref)}
      </div>
${renderDiffStatusBar(t, locale, catalogHref)}
    </div>
  </section>`;

const renderFrontierShowcase = (t, messages, counts, locale, showcase, catalogHref) => {
  const griffin =
    showcase.entries.find((entry) => entry.entryName === 'griffin_boss') || showcase.entries[0];

  const proofCards = [
    `<article class="creature-card" data-reveal style="--reveal-delay:0ms">
        <div class="creature-stage"><img class="specimen-poster" src="${griffin.posterSrc}" alt="${t('griffin')}" width="640" height="360" loading="lazy"></div>
        <div class="creature-foot">
          <h3>${t('griffin')}</h3>
          <div class="col-footer">
            <a href="${githubUrl}/blob/main/showcase/assets/models/griffin_boss.ashfox">${t('exploreSource')}</a>
            <a href="${griffin.glbHref}" download>${t('downloadGlb')}</a>
            <a href="${griffin.replayVideoSrc}" data-replay data-replay-name="${t('griffin')}" data-replay-poster="${griffin.posterSrc}" aria-haspopup="dialog">▶ ${t('watchReplay')}</a>
          </div>
        </div>
      </article>`,
    `<article class="creature-card" data-reveal style="--reveal-delay:70ms">
        <div class="creature-stage"><img src="${escapeHtml(catalogHref('/media/catalog/thumbs/scifi-airlock.png'))}" alt="${t('scifiAirlock')}" width="640" height="480" loading="lazy"></div>
        <div class="creature-foot">
          <h3>${t('scifiAirlock')}</h3>
          <div class="col-footer">
            <a href="${githubUrl}/blob/main/showcase/assets/structures/scifi_airlock.ashfox">${t('exploreSource')}</a>
            <a href="${escapeHtml(catalogHref('/media/catalog/scifi-airlock.glb'))}" download>${t('downloadGlb')}</a>
            <a href="${locale.prefix}/assets/?asset=scifi_airlock">${t('openInStudio')} →</a>
          </div>
        </div>
      </article>`,
    `<article class="creature-card" data-reveal style="--reveal-delay:140ms">
        <div class="creature-stage"><img src="${escapeHtml(catalogHref('/media/catalog/thumbs/flame-cleave.png'))}" alt="${t('flameCleave')}" width="640" height="480" loading="lazy"></div>
        <div class="creature-foot">
          <h3>${t('flameCleave')}</h3>
          <div class="col-footer">
            <a href="${githubUrl}/blob/main/showcase/assets/vfx/flame_cleave.ashfox">${t('exploreSource')}</a>
            <a href="${escapeHtml(catalogHref('/media/catalog/flame-cleave.glb'))}" download>${t('downloadGlb')}</a>
            <a href="${locale.prefix}/assets/?asset=flame_cleave">${t('openInStudio')} →</a>
          </div>
        </div>
      </article>`,
  ].join('');

  const mosaicCells = HANDOFF_MOSAIC.map(
    ({ src, kind }) =>
      `<span class="mosaic-cell mosaic-cell-${kind}"><img src="${escapeHtml(catalogHref(src))}" width="${kind === 'pixel' ? 32 : 256}" height="${kind === 'pixel' ? 32 : 256}" loading="lazy" alt=""></span>`,
  ).join('');

  return `
  <section class="landing-section" id="frontier" aria-labelledby="frontier-title">
    <div class="linear-head linear-head-compact" data-reveal>
      <h2 id="frontier-title">${t('builtShowcaseTitle')}</h2>
    </div>
    <div class="frontier-grid">
      ${proofCards}
      <a class="studio-handoff-card" href="${locale.prefix}/assets/" data-reveal style="--reveal-delay:210ms">
        <div class="handoff-mosaic" aria-hidden="true">
          <div class="mosaic-grid">${mosaicCells}</div>
          <img class="mosaic-wave" src="${escapeHtml(catalogHref('/media/catalog/claw-hit.svg'))}" width="480" height="160" loading="lazy" alt="">
        </div>
        <div class="handoff-body">
          <div>
            <h3>${t('studioHandoffTitle')}</h3>
            <div class="handoff-pills">
              <span>${formatCount(messages.studioHandoffModels, counts.model)}</span>
              <span>${formatCount(messages.studioHandoffStructures, counts.structure)}</span>
              <span>${formatCount(messages.studioHandoffVfx, counts.vfx)}</span>
              <span>${formatCount(messages.studioHandoffSprites, counts.twod)}</span>
              <span>${formatCount(messages.studioHandoffSounds, counts.sound)}</span>
            </div>
          </div>
          <span class="button button-primary">${formatCount(messages.studioHandoffCta, counts.all)} →</span>
        </div>
      </a>
    </div>
    <p class="evidence-note">${t('provenance')}</p>
  </section>
  <dialog class="replay-dialog" data-replay-dialog aria-labelledby="replay-title" aria-describedby="replay-description">
    <div class="replay-header"><div><p>${t('watchReplay')}</p><h2 id="replay-title" data-replay-title></h2></div><button type="button" class="replay-close" data-replay-close aria-label="${t('closeReplay')}" autofocus>×</button></div>
    <video data-replay-video controls playsinline preload="none" width="960" height="540" aria-labelledby="replay-title"></video>
    <p class="replay-error" data-replay-error role="status" hidden>${t('replayFailed')}</p>
    <div class="replay-footer"><p id="replay-description">${t('provenance')}</p><a data-replay-file>${t('openReplayFile')}</a></div>
  </dialog>`;
};

const renderWorkflowSection = (t, locale) => `
  <section class="landing-section" id="workflow" aria-labelledby="workflow-title">
    <div class="linear-head linear-head-compact" data-reveal>
      <h2 id="workflow-title">${t('workflowShortTitle')}</h2>
      <a class="linear-link" href="${locale.prefix}/docs/">${escapeHtml(locale.ui.docs)} →</a>
    </div>
    <div class="brand-pillars">
      <a class="brand-pillar" href="${locale.prefix}/docs/language/reference/" data-reveal style="--reveal-delay:0ms">
        <div class="brand-pillar-art">
          <div class="pillar-spec pillar-spec-code" aria-hidden="true">
            <div class="pillar-spec-head"><span>ashfox 1 · stdlib</span><span class="pillar-badge">121 std/</span></div>
            <div class="pillar-code-lines">
              <span><i>import</i> "std/model/rig/biped";</span>
              <span><i>param</i> scale = 1.2x;</span>
              <span><i>for</i> i in 0..3 { <i>use</i> kit.Arm; }</span>
            </div>
          </div>
        </div>
        <div class="brand-pillar-meta"><strong>${t('pillarStdTitle')}</strong><span>${t('pillarStdMeta')}</span></div>
      </a>
      <a class="brand-pillar" href="${locale.prefix}/docs/guides/observe/" data-reveal style="--reveal-delay:70ms">
        <div class="brand-pillar-art">
          <div class="pillar-spec pillar-spec-gate" aria-hidden="true">
            <div class="pillar-spec-head"><span>$ ashfox check --all</span><span class="pillar-badge pillar-badge-pass">PASS</span></div>
            <div class="pillar-gate-rows">
              <div><span>Scharr PBR</span><strong>OKLCH · R/M</strong></div>
              <div><span>LOD0–2</span><strong>budget ok</strong></div>
              <div><span>Diagnostics</span><strong>0 errors</strong></div>
            </div>
          </div>
        </div>
        <div class="brand-pillar-meta"><strong>${t('pillarGateTitle')}</strong><span>${t('pillarGateMeta')}</span></div>
      </a>
      <a class="brand-pillar" href="${locale.prefix}/docs/guides/sdk/" data-reveal style="--reveal-delay:140ms">
        <div class="brand-pillar-art">
          <div class="pillar-spec pillar-spec-sdk" aria-hidden="true">
            <div class="pillar-spec-head"><span>cue hit_arc · hooks</span><span class="pillar-badge">4 targets</span></div>
            <div class="pillar-target-grid">
              <span>Three.js<i>.glb · .d.ts</i></span>
              <span>Unity<i>.cs bindings</i></span>
              <span>Godot<i>.gd script</i></span>
              <span>Minecraft<i>pack.mcmeta</i></span>
            </div>
          </div>
        </div>
        <div class="brand-pillar-meta"><strong>${t('pillarSdkTitle')}</strong><span>${t('pillarSdkMeta')}</span></div>
      </a>
    </div>
  </section>
  <section class="landing-finale" aria-labelledby="finale-title" data-reveal>
    <h2 id="finale-title">${t('finaleShortTitle')}</h2>
    <div class="finale-actions">
      <a class="button button-primary" href="#quick-start">${t('getStarted')}</a>
      <a class="linear-link" href="${locale.prefix}/docs/">${escapeHtml(locale.ui.documentation)} →</a>
    </div>
  </section>`;

export const renderLandingPage = ({
  assets,
  catalog = [],
  config,
  showcase,
  locale = defaultLocale,
}) => {
  const messages = siteMessages(locale);
  const t = (key) => escapeHtml(messages[key]);
  const counts = computeCatalogCounts(catalog);
  const catalogVersionMap = buildCatalogVersionMap(catalog);
  const catalogHref = (pathname) => catalogVersionMap[pathname] || pathname;
  const alternatives = localeRegistry.locales.map((option) => ({
    ...option,
    route: `${option.prefix}/`,
  }));
  const griffin =
    showcase.entries.find((entry) => entry.entryName === 'griffin_boss') || showcase.entries[0];
  const body = `
  <main id="main" class="world-landing">
    ${renderHero(t)}
    ${renderLiveDiffStage(t, locale, assets, griffin, catalogVersionMap, catalogHref)}
    ${renderFrontierShowcase(t, messages, counts, locale, showcase, catalogHref)}
    ${renderWorkflowSection(t, locale)}
  </main><script defer src="${assets.viewerJs}"></script>`;
  return pageShell({
    active: 'product',
    assets,
    body,
    config,
    description: messages.summary,
    path: `${locale.prefix}/`,
    title: messages.pageTitle,
    locale,
    alternatives,
    headLinks:
      alternatives
        .map(
          (option) =>
            `<link rel="alternate" hreflang="${option.code}" href="${absoluteUrl(config.siteOrigin, option.route)}">`,
        )
        .join('') +
      `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(config.siteOrigin, '/')}">`,
    structuredData: {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'ashfox',
      url: absoluteUrl(config.siteOrigin, `${locale.prefix}/`),
      inLanguage: locale.code,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Windows, macOS, Linux',
      description: messages.summary,
      license: `${githubUrl}/blob/main/LICENSE`,
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      featureList: [
        messages.pageTitle,
        messages.heroSubtitle,
        messages.diffStageTitle,
        messages.builtShowcaseTitle,
        messages.workflowShortTitle,
      ],
    },
  });
};
