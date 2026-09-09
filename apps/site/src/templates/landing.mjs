import { landingContent } from '../content.mjs';
import { absoluteUrl, escapeHtml, githubUrl, pageShell } from './shell.mjs';

export const renderLandingPage = ({ assets, config, showcase }) => {
  const content = landingContent;
  const griffin = showcase.entries[0];
  const body = `
  <main id="main" class="world-landing">
    <section class="world-hero" id="examples" aria-label="Explore the Griffin">
      <div class="world-heading"><p class="eyebrow">ASHFOX / OPEN-SOURCE TOOLKIT</p><h1>Assets<br>as Code.<span class="hero-subtitle">Built for voxel games.</span></h1></div>
      <div class="world-stage" data-live-model><img src="${griffin.posterSrc}" width="640" height="360" fetchpriority="high" alt="Griffin guardian with golden armor and wide wings"></div>
      <div class="world-intro"><p>Define models, textures, and sounds in code.<br><strong>Version them in Git. Build them with Ashfox.</strong></p><div class="world-actions"><a class="button button-primary" href="#quick-start">Get started ↗</a><a class="world-link" href="#collection">Explore examples ↓</a></div></div>
      <div class="world-note"><span class="live-dot"></span><span data-model-status role="status">Griffin / animated model</span></div>
      <div class="world-controls" aria-label="Model controls">
        <div>${[['look_around','Look around'],['wing_display','Spread wings'],['greeting','Greet']].map(([id,label]) => `<button data-model-motion="${id}" aria-pressed="false" disabled>${label}</button>`).join('')}<button data-model-pause disabled>Pause</button></div>
        <div class="view-controls"><button data-model-view="3.14159" disabled>Front</button><button data-model-view="4.71239" disabled>Side</button><button data-model-view="3.79159" disabled>Reset</button></div>
      </div>
      <div class="world-index"><span>Griffin guardian</span><a href="/media/landing/griffin.glb" download>Download model ↗</a></div>
    </section>
    <section class="aac-workflow" id="workflow" aria-labelledby="workflow-title">
      <div><h2 id="workflow-title">From source to game.</h2></div>
      <ol class="workflow-steps">
        <li><span>01</span><h3>Define</h3><p>Describe models, textures and sounds in native <code>.ashfox</code> files.</p></li>
        <li><span>02</span><h3>Inspect</h3><p>Check the source. Look at the model and pixels. Listen to the sound.</p></li>
        <li><span>03</span><h3>Review</h3><p>Commit the source. Review its diff alongside captures and build evidence.</p></li>
        <li><span>04</span><h3>Build</h3><p>Compile with a pinned toolchain. Deliver the verified outputs to your game.</p></li>
      </ol>
      <a class="world-link" href="/docs/guides/assets-as-code/">Adopt Assets as Code →</a>
    </section>
    <section class="world-items" id="collection">
      <div class="world-section-copy"><h2>Pixel textures.</h2><p>A sword and a gem, compiled from native source.<br>Inspect the pixels at their actual size, then export a PNG.</p><a class="world-link" href="/downloads/items.zip" download>Get the complete item sources ↗</a></div>
      <div class="item-showcase"><div class="item-art"><img data-item-image src="/media/landing/sword.png" alt="Iron sword pixel item" width="192" height="192"></div><div class="item-options"><button data-item="sword" aria-pressed="true">Iron sword</button><button data-item="amethyst" aria-pressed="false">Amethyst</button><button data-native-size aria-pressed="false">See real size</button><a data-item-download href="/media/landing/sword.png" download>Download image ↓</a></div></div>
    </section>
    <section class="world-sound" id="sound"><div><h2>Procedural sound.</h2><p>A claw strike synthesized from source.<br>Listen to two variations and take the WAV into your game.</p><a class="world-link" href="/examples/sounds/src/claw_hit.ashfox" download>Get the sound source ↗</a></div><div class="sound-player"><span class="sound-caption">CLAW STRIKE</span><img data-sound-wave src="/media/landing/claw-base.svg" width="480" height="160" alt="Waveform of the claw hit sound"><div class="sound-progress"><span data-sound-progress></span></div><div class="sound-actions"><button class="sound-play" data-sound-play aria-label="Play claw hit">▶</button><button class="sound-another" data-sound-another>Hear another</button><a data-sound-download href="/media/landing/claw-base.wav" download>Download sound ↓</a></div><p data-sound-status role="status">Press play to hear it.</p><audio data-landing-audio preload="none" src="/media/landing/claw-base.wav"></audio></div></section>
    <section class="world-source" id="source"><div class="world-section-copy"><h2>The source is yours.</h2><p>Keep the asset definition alongside your game code.<br>Use your coding agent to change it, inspect the result, and commit the source.</p><a class="world-link" href="${githubUrl}/tree/main/examples">Browse example sources ↗</a></div><div class="source-window"><div class="source-tabs"><button data-source="model" aria-pressed="true">Model</button><button data-source="item" aria-pressed="false">Item</button><button data-source="sound" aria-pressed="false">Sound</button><span>.ashfox</span></div><details class="source-code"><summary>Inspect a source excerpt</summary><pre><code data-source-code>Loading source…</code></pre></details><div class="source-result"><img data-source-preview src="${griffin.posterSrc}" width="160" height="90" alt="Generated Griffin model"></div><div class="source-footer"><a data-source-link href="/examples/griffin/workbench/main.ashfox">Read full source ↗</a></div></div></section>
    <section class="aac-frontier" id="frontier" aria-labelledby="frontier-title">
      <h2 id="frontier-title">Complete creatures.</h2>
      <p class="section-lead">Follow complete creatures from source to animated output. Explore shared components, texture surfaces and authored motions.</p>
      <div class="frontier-grid">${showcase.entries.map(entry => {
        const labels = { griffin: ['Griffin guardian', 'An articulated creature with wings, plumage and six motions.', 'griffin/workbench/main.ashfox'], fox: ['Red fox', 'A compact creature with three motions.', 'fox/creatures/fox.ashfox'], goblin: ['Goblin raider', 'A character with three motions and expressive proportions.', 'goblin/creatures/goblin.ashfox'] };
        const [name, description, source] = labels[entry.entryName];
        return `<article><img src="${entry.posterSrc}" alt="${name}" width="640" height="360" loading="lazy"><div><h3>${name}</h3><p>${description}</p><a href="${githubUrl}/blob/main/examples/${source}">Explore source ↗</a><a href="${entry.glbHref}" download>Download GLB ↓</a><details><summary>Watch the build replay</summary><video controls preload="none" aria-label="${name} build replay" poster="${entry.posterSrc}" width="640" height="360"><source src="${entry.replayVideoSrc}" type="video/mp4"></video></details></div></article>`;
      }).join('')}</div>
      <p class="evidence-note">${content.showcase.provenance}</p>
      <a class="world-link" href="${githubUrl}/tree/main/examples/shared-creatures">Explore the shared source project ↗</a>
    </section>
    <section class="world-delivery" id="outputs"><h2>Build for your game.</h2><div class="delivery-pair"><a href="/docs/guides/web-game/"><h3>Game bundles</h3><p>Animated models, pixel items and sound. Run the complete web-game example.</p><strong>Run the example ↗</strong></a><a href="/docs/guides/minecraft-packs/"><h3>Minecraft packs</h3><p>Bring your items, models and sounds into Minecraft with a resource pack.</p><strong>Build a resource pack ↗</strong></a></div><a class="world-link" href="/docs/guides/choose-a-format/">Explore formats and compatibility ↗</a></section>
    <section class="world-start" id="quick-start"><h2>Make your first asset.</h2><div class="world-actions"><a class="button button-primary" href="/docs/guides/install/">Install Ashfox ↗</a><a class="button button-secondary" href="${escapeHtml(config.stable.starter)}" download>Get starter sources ↓</a></div><details><summary>Or start with your agent</summary><p>${escapeHtml(content.quickStart.instruction)}</p><button class="button button-secondary" data-copy-agent-instruction data-instruction="${escapeHtml(content.quickStart.instruction)}"><span data-copy-state data-default-state="Copy instruction" data-copied-state="Copied">Copy instruction</span></button><p data-copy-feedback data-default-feedback="Paste this instruction into your agent." role="status">Paste this instruction into your agent.</p></details><p class="start-footnote">Node.js 20+ · macOS, Linux, Windows · MIT licensed</p></section>
  </main><script defer src="/media/landing/hero.js"></script>`;
  return pageShell({ active: 'product', assets, body, config, description: content.summary, path: '/', title: 'ashfox', structuredData: {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: 'ashfox', url: absoluteUrl(config.siteOrigin, '/'), applicationCategory: 'DeveloperApplication', operatingSystem: 'Windows, macOS, Linux', description: content.summary, license: `${githubUrl}/blob/main/LICENSE`, isAccessibleForFree: true, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, featureList: ['Assets as Code for voxel games', 'Native model, texture and sound sources', 'Git-based source workflows', 'CLI inspection, capture and builds', 'Game bundles and Minecraft resource packs']
  }});
};
