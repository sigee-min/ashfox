import { defaultLocale, localeRegistry } from '../locales.mjs';
import { siteMessages } from '../messages.mjs';
import { absoluteUrl, escapeHtml, githubUrl, pageShell } from './shell.mjs';

export const renderLandingPage = ({ assets, config, showcase, locale = defaultLocale }) => {
  const messages = siteMessages(locale);
  const t = key => escapeHtml(messages[key]);
  const alternatives = localeRegistry.locales.map(option => ({ ...option, route: `${option.prefix}/` }));
  const griffin = showcase.entries[0];
  const body = `
  <main id="main" class="world-landing">
    <section class="world-hero" id="examples" aria-label="${t('exploreGriffin')}">
      <div class="hero-copy">
        <div class="world-heading">
          <p class="eyebrow">${t('eyebrow')}</p>
          <h1>Assets<br>as Code.</h1>
          <p class="hero-subtitle">${t('heroSubtitle')}</p>
        </div>
        <div class="world-intro">
          <p>${t('heroIntro')} ${t('heroPromise')}</p>
          <div class="hero-start" id="quick-start"><div class="world-actions"><button class="button button-primary" data-copy-agent-instruction data-instruction="${t('instruction')}"><span data-copy-state data-default-state="${t('copyInstruction')}" data-copied-state="${t('copied')}">${t('copyInstruction')}</span></button></div><p data-copy-feedback data-default-feedback="${t('pasteInstruction')}" role="status">${t('pasteInstruction')}</p><noscript><p>${t('javascriptRequired')}</p></noscript></div>
          <a class="world-link hero-examples" href="#collection">${t('exploreExamples')}</a>
        </div>
      </div>
      <div class="hero-preview">
        <div class="preview-heading"><span>${t('griffin')}</span><a href="/examples/griffin/workbench/main.ashfox">${t('exploreSource')}</a></div>
        <div class="world-stage" data-live-model><img src="${griffin.posterSrc}" width="640" height="360" fetchpriority="high" alt="${t('heroAlt')}"></div>
        <div class="world-note"><span class="live-dot" aria-hidden="true"></span><span data-model-status role="status">${t('modelStatus')}</span></div>
        <div class="world-controls" aria-label="${t('modelControls')}">
          <div>${[['look_around',t('lookAround')],['wing_display',t('spreadWings')],['greeting',t('greet')]].map(([id,label]) => `<button data-model-motion="${id}" aria-pressed="false" disabled>${label}</button>`).join('')}<button data-model-pause disabled>${t('pause')}</button></div>
          <details class="view-options"><summary>${t('cameraViews')}</summary><div class="view-controls"><button data-model-view="3.14159" disabled>${t('front')}</button><button data-model-view="4.71239" disabled>${t('side')}</button><button data-model-view="3.79159" disabled>${t('reset')}</button></div></details>
        </div>
        <div class="world-index"><span>.ashfox <span aria-hidden="true">→</span> GLB</span><a href="/media/landing/griffin.glb" download>${t('downloadModel')}</a></div>
      </div>
    </section>
    <section class="aac-workflow" id="workflow" aria-labelledby="workflow-title">
      <div><h2 id="workflow-title">${t('workflowTitle')}</h2></div>
      <ol class="workflow-steps">
        <li><span>01</span><h3>${t('define')}</h3><p>${t('defineBefore')}<code>.ashfox</code>${t('defineAfter')}</p></li>
        <li><span>02</span><h3>${t('inspect')}</h3><p>${t('inspectBody')}</p></li>
        <li><span>03</span><h3>${t('review')}</h3><p>${t('reviewBody')}</p></li>
        <li><span>04</span><h3>${t('build')}</h3><p>${t('buildBody')}</p></li>
      </ol>
      <a class="world-link" href="${locale.prefix}/docs/guides/assets-as-code/">${t('adopt')}</a>
    </section>
    <section class="world-items" id="collection">
      <div class="world-section-copy"><h2>${t('texturesTitle')}</h2><p>${t('texturesBody')}<br>${t('texturesDetail')}</p><a class="world-link" href="/downloads/items.zip" download>${t('itemSources')}</a></div>
      <div class="item-showcase"><div class="item-art"><img data-item-image src="/media/landing/sword.png" alt="${t('swordAlt')}" width="192" height="192"></div><div class="item-options"><button data-item="sword" aria-pressed="true">${t('sword')}</button><button data-item="amethyst" aria-pressed="false">${t('amethyst')}</button><button data-native-size aria-pressed="false">${t('nativeSize')}</button><a data-item-download href="/media/landing/sword.png" download>${t('downloadImage')}</a></div></div>
    </section>
    <section class="world-sound" id="sound"><div><h2>${t('soundTitle')}</h2><p>${t('soundBody')}<br>${t('soundDetail')}</p><a class="world-link" href="/examples/sounds/src/claw_hit.ashfox" download>${t('soundSource')}</a></div><div class="sound-player"><span class="sound-caption">${t('claw')}</span><img data-sound-wave src="/media/landing/claw-base.svg" width="480" height="160" alt="${t('waveAlt')}"><div class="sound-progress"><span data-sound-progress></span></div><div class="sound-actions"><button class="sound-play" data-sound-play aria-label="${t('playSound')}">▶</button><button class="sound-another" data-sound-another>${t('another')}</button><a data-sound-download href="/media/landing/claw-base.wav" download>${t('downloadSound')}</a></div><p data-sound-status role="status">${t('pressPlay')}</p><audio data-landing-audio preload="none" src="/media/landing/claw-base.wav"></audio></div></section>
    <section class="world-source" id="source"><div class="world-section-copy"><h2>${t('sourceTitle')}</h2><p>${t('sourceBody')}<br>${t('sourceDetail')}</p><a class="world-link" href="${githubUrl}/tree/main/examples">${t('browseSources')}</a></div><div class="source-window"><div class="source-tabs"><button data-source="model" aria-pressed="true">${t('model')}</button><button data-source="item" aria-pressed="false">${t('item')}</button><button data-source="sound" aria-pressed="false">${t('sound')}</button><span>.ashfox</span></div><details class="source-code"><summary>${t('sourceExcerpt')}</summary><pre><code data-source-code>${t('loadingSource')}</code></pre></details><div class="source-result"><img data-source-preview src="${griffin.posterSrc}" width="160" height="90" alt="${t('modelAlt')}"></div><div class="source-footer"><a data-source-link href="/examples/griffin/workbench/main.ashfox">${t('fullSource')}</a></div></div></section>
    <section class="aac-frontier" id="frontier" aria-labelledby="frontier-title">
      <h2 id="frontier-title">${t('creaturesTitle')}</h2>
      <p class="section-lead">${t('creaturesBody')}</p>
      <div class="frontier-grid">${showcase.entries.map(entry => {
        const labels = { griffin: [t('griffin'), t('griffinBody'), 'griffin/workbench/main.ashfox'], fox: [t('fox'), t('foxBody'), 'fox/creatures/fox.ashfox'], goblin: [t('goblin'), t('goblinBody'), 'goblin/creatures/goblin.ashfox'] };
        const [name, description, source] = labels[entry.entryName];
        return `<article><img src="${entry.posterSrc}" alt="${name}" width="640" height="360" loading="lazy"><div><h3>${name}</h3><p>${description}</p><a href="${githubUrl}/blob/main/examples/${source}">${t('exploreSource')}</a><a href="${entry.glbHref}" download>${t('downloadGlb')}</a><details><summary>${t('watchReplay')}</summary><video controls preload="none" aria-label="${name} ${t('buildReplay')}" poster="${entry.posterSrc}" width="640" height="360"><source src="${entry.replayVideoSrc}" type="video/mp4"></video></details></div></article>`;
      }).join('')}</div>
      <p class="evidence-note">${t('provenance')}</p>
      <a class="world-link" href="${githubUrl}/tree/main/examples/shared-creatures">${t('sharedSource')}</a>
    </section>
    <section class="world-delivery" id="outputs"><h2>${t('deliveryTitle')}</h2><div class="delivery-pair"><a href="${locale.prefix}/docs/guides/web-game/"><h3>${t('gameBundles')}</h3><p>${t('gameBody')}</p><strong>${t('runExample')}</strong></a><a href="${locale.prefix}/docs/guides/minecraft-packs/"><h3>${t('minecraft')}</h3><p>${t('minecraftBody')}</p><strong>${t('buildPack')}</strong></a></div><a class="world-link" href="${locale.prefix}/docs/guides/choose-a-format/">${t('formats')}</a></section>

  </main><script defer src="/media/landing/hero.js"></script>`;
  return pageShell({ active: 'product', assets, body, config, description: messages.summary, path: `${locale.prefix}/`, title: messages.pageTitle, locale, alternatives, headLinks: alternatives.map(option => `<link rel="alternate" hreflang="${option.code}" href="${absoluteUrl(config.siteOrigin, option.route)}">`).join('') + `<link rel="alternate" hreflang="x-default" href="${absoluteUrl(config.siteOrigin, '/')}">`, structuredData: {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'ashfox', url: absoluteUrl(config.siteOrigin, `${locale.prefix}/`), inLanguage: locale.code, applicationCategory: 'DeveloperApplication', operatingSystem: 'Windows, macOS, Linux', description: messages.summary, license: `${githubUrl}/blob/main/LICENSE`, isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, featureList: [messages.pageTitle, messages.heroIntro, messages.heroPromise, messages.inspectBody, messages.gameBody]
  }});
};
