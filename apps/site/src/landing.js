const HERO_COPY = JSON.parse(document.body.dataset.siteCopy || '{}');

const DIFF_ITEMS = {
  '3d': [
    {
      id: 'griffin',
      token: 'griffin',
      label: { en: 'griffin', ko: 'griffin' },
      file: 'examples/griffin/workbench/main.ashfox',
      sourceHref: '/examples/griffin/workbench/main.ashfox',
      outputHref: '/media/catalog/griffin.glb',
      studioId: 'griffin',
      motions: ['look_around', 'wing_display', 'greeting'],
      codeLine: 'asset griffin { import "./animation.ashfox" as animation; }',
    },
    {
      id: 'fox',
      token: 'fox',
      label: { en: 'fox', ko: 'fox' },
      file: 'examples/fox/creatures/fox.ashfox',
      sourceHref: '/examples/fox/creatures/fox.ashfox',
      outputHref: '/media/catalog/fox.glb',
      studioId: 'fox',
      motions: ['idle', 'curious', 'tail_wag'],
      codeLine: 'asset fox { import "../../shared/creatures/quadruped.ashfox"; }',
    },
    {
      id: 'goblin',
      token: 'goblin',
      label: { en: 'goblin', ko: 'goblin' },
      file: 'examples/goblin/creatures/goblin.ashfox',
      sourceHref: '/examples/goblin/creatures/goblin.ashfox',
      outputHref: '/media/catalog/goblin.glb',
      studioId: 'goblin',
      motions: ['idle', 'alert', 'attack'],
      codeLine: 'asset goblin { import "../../shared/creatures/biped.ashfox"; }',
    },
    {
      id: 'lantern',
      token: 'lantern',
      label: { en: 'lantern', ko: 'lantern' },
      file: 'examples/prop/lantern.ashfox',
      sourceHref: '/examples/prop/lantern.ashfox',
      outputHref: '/media/catalog/lantern.glb',
      studioId: 'lantern',
      motions: [],
      codeLine: 'asset lantern { profile = prop; emissive = #ffbe55; }',
    },
  ],
  '2d': [
    {
      id: 'iron_sword',
      token: 'shared.steel',
      label: { en: 'shared.steel', ko: 'shared.steel' },
      file: 'examples/items/assets/sprites/iron_sword.ashfox',
      sourceHref: '/examples/items/assets/sprites/iron_sword.ashfox',
      outputHref: '/media/catalog/iron-sword.png',
      studioId: 'iron_sword',
      tile: false,
      meta: '32×32 PNG · material = shared.steel',
      codeLine: '  material = shared.steel;',
    },
    {
      id: 'copper_sword',
      token: 'shared.copper',
      label: { en: 'shared.copper', ko: 'shared.copper' },
      file: 'examples/items/assets/sprites/copper_sword.ashfox',
      sourceHref: '/examples/items/assets/sprites/copper_sword.ashfox',
      outputHref: '/media/catalog/copper-sword.png',
      studioId: 'copper_sword',
      tile: false,
      meta: '32×32 PNG · material = shared.copper',
      codeLine: '  material = shared.copper;',
    },
    {
      id: 'crystal_sword',
      token: 'shared.crystal',
      label: { en: 'shared.crystal', ko: 'shared.crystal' },
      file: 'examples/items/assets/sprites/crystal_sword.ashfox',
      sourceHref: '/examples/items/assets/sprites/crystal_sword.ashfox',
      outputHref: '/media/catalog/crystal-sword.png',
      studioId: 'crystal_sword',
      tile: false,
      meta: '32×32 PNG · material = shared.crystal',
      codeLine: '  material = shared.crystal;',
    },
    {
      id: 'ruby_potion',
      token: 'ruby_liquid',
      label: { en: 'ruby_liquid', ko: 'ruby_liquid' },
      file: 'examples/items/assets/sprites/ruby_potion.ashfox',
      sourceHref: '/examples/items/assets/sprites/ruby_potion.ashfox',
      outputHref: '/media/catalog/ruby-potion.png',
      studioId: 'ruby_potion',
      tile: false,
      meta: '32×32 PNG · material = shared.ruby_liquid',
      codeLine: '  material = shared.ruby_liquid;',
    },
    {
      id: 'blue_potion',
      token: 'blue_liquid',
      label: { en: 'blue_liquid', ko: 'blue_liquid' },
      file: 'examples/items/assets/sprites/blue_potion.ashfox',
      sourceHref: '/examples/items/assets/sprites/blue_potion.ashfox',
      outputHref: '/media/catalog/blue-potion.png',
      studioId: 'blue_potion',
      tile: false,
      meta: '32×32 PNG · material = shared.blue_liquid',
      codeLine: '  material = shared.blue_liquid;',
    },
    {
      id: 'amber_potion',
      token: 'amber_liquid',
      label: { en: 'amber_liquid', ko: 'amber_liquid' },
      file: 'examples/items/assets/sprites/amber_potion.ashfox',
      sourceHref: '/examples/items/assets/sprites/amber_potion.ashfox',
      outputHref: '/media/catalog/amber-potion.png',
      studioId: 'amber_potion',
      tile: false,
      meta: '32×32 PNG · material = shared.amber_liquid',
      codeLine: '  material = shared.amber_liquid;',
    },
    {
      id: 'mossy_stone',
      token: 'mossy_stone',
      label: { en: 'mossy_stone 3×3', ko: 'mossy_stone 3×3' },
      file: 'examples/items/assets/sprites/mossy_stone.ashfox',
      sourceHref: '/examples/items/assets/sprites/mossy_stone.ashfox',
      outputHref: '/media/catalog/mossy-stone.png',
      studioId: 'mossy_stone',
      tile: true,
      meta: '3×3 Seamless Tile · mossy_stone',
      codeLine: '  sprite mossy_stone { tile = seamless; }',
    },
    {
      id: 'oak_planks',
      token: 'oak_planks',
      label: { en: 'oak_planks 3×3', ko: 'oak_planks 3×3' },
      file: 'examples/items/assets/sprites/oak_planks.ashfox',
      sourceHref: '/examples/items/assets/sprites/oak_planks.ashfox',
      outputHref: '/media/catalog/oak-planks.png',
      studioId: 'oak_planks',
      tile: true,
      meta: '3×3 Seamless Tile · oak_planks',
      codeLine: '  sprite oak_planks { tile = seamless; }',
    },
  ],
  sfx: [
    {
      id: 'bird_base',
      token: 'seed = 7349',
      label: { en: 'seed = 7349', ko: 'seed = 7349' },
      file: 'examples/sounds/assets/sounds/bird_call.ashfox',
      sourceHref: '/examples/sounds/assets/sounds/bird_call.ashfox',
      outputHref: '/media/catalog/bird-call.wav',
      waveHref: '/media/catalog/bird-call.svg',
      studioId: 'bird_call',
      meta: 'bird_call · seed = 7349',
      codeLine: '  seed = 7349;',
    },
    {
      id: 'bird_alt',
      token: 'seed = 7350',
      label: { en: 'seed = 7350', ko: 'seed = 7350' },
      file: 'examples/sounds/assets/sounds/bird_call.ashfox',
      sourceHref: '/examples/sounds/assets/sounds/bird_call.ashfox',
      outputHref: '/media/catalog/bird-alternate.wav',
      waveHref: '/media/catalog/bird-alternate.svg',
      studioId: 'bird_call',
      meta: 'bird_call · seed = 7350',
      codeLine: '  seed = 7350;',
    },
    {
      id: 'claw_hit',
      token: 'claw_hit',
      label: { en: 'claw_hit', ko: 'claw_hit' },
      file: 'examples/sounds/assets/sounds/claw_hit.ashfox',
      sourceHref: '/examples/sounds/assets/sounds/claw_hit.ashfox',
      outputHref: '/media/catalog/claw-hit.wav',
      waveHref: '/media/catalog/claw-hit.svg',
      studioId: 'claw_hit',
      meta: 'claw_hit · profile = "impact"',
      codeLine: '  sound claw_hit { profile = "impact"; }',
    },
    {
      id: 'metal_strike',
      token: 'metal_strike',
      label: { en: 'metal_strike', ko: 'metal_strike' },
      file: 'examples/sounds/assets/sounds/metal_strike.ashfox',
      sourceHref: '/examples/sounds/assets/sounds/metal_strike.ashfox',
      outputHref: '/media/catalog/metal-strike.wav',
      waveHref: '/media/catalog/metal-strike.svg',
      studioId: 'metal_strike',
      meta: 'metal_strike · modal resonator',
      codeLine: '  sound metal_strike { kind = "modal"; }',
    },
    {
      id: 'charging_spell',
      token: 'charging_spell',
      label: { en: 'charging_spell', ko: 'charging_spell' },
      file: 'examples/sounds/assets/sounds/charging_spell.ashfox',
      sourceHref: '/examples/sounds/assets/sounds/charging_spell.ashfox',
      outputHref: '/media/catalog/charging-spell.wav',
      waveHref: '/media/catalog/charging-spell.svg',
      studioId: 'charging_spell',
      meta: 'charging_spell · stereo sweep',
      codeLine: '  sound charging_spell { channels = 2; }',
    },
  ],
};

const escapeText = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const renderDiffPatch = (prevItem, nextItem, patchEl) => {
  const prevLine = prevItem ? prevItem.codeLine : nextItem.codeLine;
  patchEl.innerHTML = [
    '<span class="diff-ctx">  1  ashfox-model 1</span>',
    `<span class="diff-del">-    ${escapeText(prevLine)}</span>`,
    `<span class="diff-add">+    ${escapeText(nextItem.codeLine)}</span>`,
  ].join('\n');
  patchEl.classList.remove('is-flashing');
  void patchEl.offsetWidth;
  patchEl.classList.add('is-flashing');
};

const waitForLiveViewer = async () => {
  for (let i = 0; i < 60; i += 1) {
    if (window.ashfoxViewer) return window.ashfoxViewer;
    await new Promise((r) => window.setTimeout(r, 50));
  }
  return null;
};

const rebuild3dControls = (controlsRoot, motions) => {
  const strip = controlsRoot.querySelector('.segmented-strip');
  if (!strip) return;
  strip.innerHTML = '';
  for (const clip of motions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.modelMotion = clip;
    btn.setAttribute('aria-pressed', 'false');
    btn.textContent = clip.replaceAll('_', ' ');
    strip.append(btn);
  }
  strip.hidden = motions.length === 0;
};

const queryDiffElements = (root) => ({
  filepath: root.querySelector('[data-diff-filepath]'),
  tokens: root.querySelector('[data-diff-tokens]'),
  patch: root.querySelector('[data-diff-patch]'),
  code: root.querySelector('[data-source-code]'),
  pane3d: root.querySelector('[data-diff-pane="3d"]'),
  pane2d: root.querySelector('[data-diff-pane="2d"]'),
  paneSfx: root.querySelector('[data-diff-pane="sfx"]'),
  host3d: root.querySelector('[data-live-model]'),
  controls3d: root.querySelector('[data-diff-3d-controls]'),
  img2d: root.querySelector('[data-diff-image]'),
  tile2d: root.querySelector('[data-diff-tile]'),
  native2d: root.querySelector('[data-diff-native]'),
  label2d: root.querySelector('[data-diff-2d-label]'),
  waveSfx: root.querySelector('[data-diff-wave]'),
  playSfx: root.querySelector('[data-diff-play]'),
  labelSfx: root.querySelector('[data-diff-sfx-label]'),
  audioSfx: root.querySelector('[data-diff-audio]'),
  studioLink: root.querySelector('[data-diff-studio-link]'),
  sourceLink: root.querySelector('[data-diff-source-link]'),
  downloadLink: root.querySelector('[data-diff-download-link]'),
});

const renderOutputPane = (domain, item, els, skipInitial3d) => {
  els.audioSfx.pause();
  els.pane3d.hidden = domain !== '3d';
  els.pane2d.hidden = domain !== '2d';
  els.paneSfx.hidden = domain !== 'sfx';
  if (domain === '2d') {
    els.img2d.hidden = item.tile;
    els.tile2d.hidden = !item.tile;
    els.img2d.src = item.outputHref;
    els.native2d.src = item.outputHref;
    els.tile2d.style.backgroundImage = item.tile ? `url(${item.outputHref})` : '';
    els.label2d.textContent = item.meta;
    return;
  }
  if (domain === 'sfx') {
    els.waveSfx.src = item.waveHref;
    els.audioSfx.src = item.outputHref;
    els.labelSfx.textContent = item.meta;
    return;
  }
  if (skipInitial3d) return;
  rebuild3dControls(els.controls3d, item.motions);
  void waitForLiveViewer().then((viewer) => {
    if (!viewer) return;
    void viewer.mount(els.host3d, item.outputHref, { controlsRoot: els.controls3d });
  });
};

const bindSfxPlayer = (els) => {
  els.playSfx.addEventListener('click', () => {
    if (els.audioSfx.paused) void els.audioSfx.play().catch(() => {});
    else els.audioSfx.pause();
  });
  els.audioSfx.addEventListener('play', () => {
    els.playSfx.textContent = `⏸ ${HERO_COPY.pauseSound || 'Pause'}`;
  });
  els.audioSfx.addEventListener('pause', () => {
    els.playSfx.textContent = `▶ ${HERO_COPY.playSound || 'Play'}`;
  });
};

const initLiveDiffPlayground = () => {
  const root = document.querySelector('[data-live-diff]');
  if (!root) return;
  const els = queryDiffElements(root);
  const lang = root.dataset.locale || 'en';
  const prefix = lang === 'ko' ? '/ko' : '';
  let activeDomain = '3d';
  let activeItem = DIFF_ITEMS['3d'][0];
  let fetchSeq = 0;

  const selectItem = async (domain, item, initial) => {
    const prev = activeDomain === domain && activeItem.id !== item.id ? activeItem : null;
    activeDomain = domain;
    activeItem = item;
    for (const btn of root.querySelectorAll('[data-diff-token]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.diffToken === item.id));
    }
    els.filepath.textContent = item.file;
    els.studioLink.href = `${prefix}/assets/?asset=${item.studioId}`;
    els.sourceLink.href = item.sourceHref;
    els.downloadLink.href = item.outputHref;
    renderDiffPatch(prev || DIFF_ITEMS[domain][1] || item, item, els.patch);
    renderOutputPane(domain, item, els, initial);
    const token = ++fetchSeq;
    try {
      const response = await fetch(item.sourceHref);
      const text = response.ok
        ? (await response.text()).trim().split('\n').slice(0, 14).join('\n')
        : HERO_COPY.sourceFailed || '';
      if (token === fetchSeq) els.code.textContent = text;
    } catch {
      if (token === fetchSeq) els.code.textContent = HERO_COPY.sourceFailed || '';
    }
  };

  const switchDomain = (domain, initial) => {
    for (const btn of root.querySelectorAll('[data-diff-domain]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.diffDomain === domain));
    }
    els.tokens.innerHTML = '';
    for (const item of DIFF_ITEMS[domain]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'diff-token-btn';
      btn.dataset.diffToken = item.id;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent = item.label[lang] || item.label.en;
      btn.addEventListener('click', () => void selectItem(domain, item, false));
      els.tokens.append(btn);
    }
    void selectItem(domain, DIFF_ITEMS[domain][0], initial);
  };

  for (const btn of root.querySelectorAll('[data-diff-domain]')) {
    btn.addEventListener('click', () => switchDomain(btn.dataset.diffDomain, false));
  }
  bindSfxPlayer(els);
  switchDomain('3d', true);
};

const initDragCue = () => {
  const stage = document.querySelector('[data-live-model]');
  const cue = document.querySelector('[data-drag-cue]');
  if (!stage || !cue) return;
  stage.addEventListener('pointerdown', () => cue.classList.add('is-dismissed'), { once: true });
};

const initScrollReveal = () => {
  const nodes = [...document.querySelectorAll('[data-reveal]')];
  if (!nodes.length) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || typeof IntersectionObserver === 'undefined') {
    for (const el of nodes) el.dataset.revealed = 'true';
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.dataset.revealed = 'true';
        io.unobserve(entry.target);
      }
    },
    { threshold: 0.08 },
  );
  for (const el of nodes) io.observe(el);
};

const initReplayModal = () => {
  const dialog = document.querySelector('[data-replay-dialog]');
  const video = document.querySelector('[data-replay-video]');
  const title = document.querySelector('[data-replay-title]');
  const fileLink = document.querySelector('[data-replay-file]');
  const errEl = document.querySelector('[data-replay-error]');
  const closeBtn = document.querySelector('[data-replay-close]');
  if (!dialog || !video) return;

  let opener = null;
  const closeModal = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    document.body.classList.remove('replay-open');
    if (dialog.open) dialog.close();
    opener?.focus();
  };
  for (const trigger of document.querySelectorAll('[data-replay]')) {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      opener = trigger;
      if (errEl) errEl.hidden = true;
      if (title) title.textContent = trigger.dataset.replayName || '';
      if (fileLink) fileLink.href = trigger.href;
      video.poster = trigger.dataset.replayPoster || '';
      video.src = trigger.href;
      document.body.classList.add('replay-open');
      dialog.showModal();
    });
  }
  video.addEventListener('error', () => {
    if (errEl) errEl.hidden = false;
  });
  closeBtn?.addEventListener('click', closeModal);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeModal();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeModal();
  });
};

initLiveDiffPlayground();
initDragCue();
initScrollReveal();
initReplayModal();
