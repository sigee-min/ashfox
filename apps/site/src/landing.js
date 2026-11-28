const HERO_COPY = JSON.parse(document.body.dataset.siteCopy || '{}');

const DIFF_ITEMS = {
  model: [
    {
      id: 'griffin',
      token: 'griffin_boss',
      label: { en: 'griffin_boss', ko: 'griffin_boss' },
      file: 'showcase/assets/models/griffin_boss.ashfox',
      sourceHref: '/showcase/assets/models/griffin_boss.ashfox',
      outputHref: '/media/catalog/griffin.glb',
      studioId: 'griffin',
      motions: ['idle', 'wing_display', 'wing_flap'],
      codeLine: 'model griffin_boss { import "std/model/rig/winged_quadruped" as wq; }',
    },
    {
      id: 'scifi_drone',
      token: 'scifi_drone',
      label: { en: 'scifi_drone', ko: 'scifi_drone' },
      file: 'showcase/assets/models/scifi_drone.ashfox',
      sourceHref: '/showcase/assets/models/scifi_drone.ashfox',
      outputHref: '/media/catalog/scifi-drone.glb',
      studioId: 'scifi_drone',
      motions: ['drone_hover'],
      codeLine: 'model scifi_drone { import "std/model/rig/drone" as drone_rig; }',
    },
    {
      id: 'zombie_walker',
      token: 'zombie_walker',
      label: { en: 'zombie_walker', ko: 'zombie_walker' },
      file: 'showcase/assets/models/zombie_walker.ashfox',
      sourceHref: '/showcase/assets/models/zombie_walker.ashfox',
      outputHref: '/media/catalog/zombie-walker.glb',
      studioId: 'zombie_walker',
      motions: ['shamble', 'bite_lunge'],
      codeLine: 'model zombie_walker { motions = [zmotion.shamble, zmotion.bite_lunge]; }',
    },
  ],
  structure: [
    {
      id: 'tavern',
      token: 'tavern',
      label: { en: 'tavern', ko: 'tavern' },
      file: 'showcase/assets/structures/tavern.ashfox',
      sourceHref: '/showcase/assets/structures/tavern.ashfox',
      outputHref: '/media/catalog/tavern.glb',
      studioId: 'tavern',
      motions: [],
      codeLine: 'structure tavern { import "std/structure/arch/medieval" as arch; }',
    },
    {
      id: 'scifi_airlock',
      token: 'scifi_airlock',
      label: { en: 'scifi_airlock', ko: 'scifi_airlock' },
      file: 'showcase/assets/structures/scifi_airlock.ashfox',
      sourceHref: '/showcase/assets/structures/scifi_airlock.ashfox',
      outputHref: '/media/catalog/scifi-airlock.glb',
      studioId: 'scifi_airlock',
      motions: [],
      codeLine: 'structure scifi_airlock { import "std/structure/arch/scifi" as scifi; }',
    },
    {
      id: 'dungeon_gate',
      token: 'dungeon_gate',
      label: { en: 'dungeon_gate', ko: 'dungeon_gate' },
      file: 'showcase/assets/structures/dungeon_gate.ashfox',
      sourceHref: '/showcase/assets/structures/dungeon_gate.ashfox',
      outputHref: '/media/catalog/dungeon-gate.glb',
      studioId: 'dungeon_gate',
      motions: [],
      codeLine: 'structure dungeon_gate { import "std/structure/dungeon/trap_gate" as trap; }',
    },
  ],
  vfx: [
    {
      id: 'flame_cleave',
      token: 'flame_cleave',
      label: { en: 'flame_cleave', ko: 'flame_cleave' },
      file: 'showcase/assets/vfx/flame_cleave.ashfox',
      sourceHref: '/showcase/assets/vfx/flame_cleave.ashfox',
      outputHref: '/media/catalog/flame-cleave.glb',
      studioId: 'flame_cleave',
      motions: ['flame_cleave'],
      codeLine: 'vfx flame_cleave { palette = fire.EmberSolar; blend = additive; }',
    },
    {
      id: 'plasma_bolt',
      token: 'plasma_bolt',
      label: { en: 'plasma_bolt', ko: 'plasma_bolt' },
      file: 'showcase/assets/vfx/plasma_bolt.ashfox',
      sourceHref: '/showcase/assets/vfx/plasma_bolt.ashfox',
      outputHref: '/media/catalog/plasma-bolt.glb',
      studioId: 'plasma_bolt',
      motions: ['plasma_bolt'],
      codeLine: 'vfx plasma_bolt { import "std/vfx/weapon/plasma_bolt" as plasma; }',
    },
    {
      id: 'arcane_shockwave',
      token: 'arcane_shockwave',
      label: { en: 'arcane_shockwave', ko: 'arcane_shockwave' },
      file: 'showcase/assets/vfx/arcane_shockwave.ashfox',
      sourceHref: '/showcase/assets/vfx/arcane_shockwave.ashfox',
      outputHref: '/media/catalog/arcane-shockwave.glb',
      studioId: 'arcane_shockwave',
      motions: ['arcane_shockwave'],
      codeLine: 'vfx arcane_shockwave { palette = arc.ArcaneViolet; blend = additive; }',
    },
  ],
  '2d': [
    {
      id: 'iron_sword',
      token: 'iron_sword',
      label: { en: 'iron_sword', ko: 'iron_sword' },
      file: 'showcase/assets/sprites/iron_sword.ashfox',
      sourceHref: '/showcase/assets/sprites/iron_sword.ashfox',
      outputHref: '/media/catalog/iron-sword.png',
      studioId: 'iron_sword',
      tile: false,
      meta: '32×32 PNG · material = weapon.steel',
      codeLine: '  material = weapon.steel;',
    },
    {
      id: 'ui_inventory_panel',
      token: 'ui_inventory_panel',
      label: { en: 'ui_inventory_panel', ko: 'ui_inventory_panel' },
      file: 'showcase/assets/sprites/ui_inventory_panel.ashfox',
      sourceHref: '/showcase/assets/sprites/ui_inventory_panel.ashfox',
      outputHref: '/media/catalog/ui-inventory-panel.png',
      studioId: 'ui_inventory_panel',
      tile: false,
      meta: '32×32 PNG · profile = ui_9slice · slice = 6px',
      codeLine: '  profile = ui_9slice; slice = (6px, 6px, 6px, 6px);',
    },
    {
      id: 'oak_planks',
      token: 'oak_planks',
      label: { en: 'oak_planks 3×3', ko: 'oak_planks 3×3' },
      file: 'showcase/assets/sprites/oak_planks.ashfox',
      sourceHref: '/showcase/assets/sprites/oak_planks.ashfox',
      outputHref: '/media/catalog/oak-planks.png',
      studioId: 'oak_planks',
      tile: true,
      meta: '3×3 Seamless Tile · oak_planks',
      codeLine: '  sprite oak_planks { profile = tile; }',
    },
  ],
  sfx: [
    {
      id: 'claw_hit',
      token: 'seed = 42',
      label: { en: 'seed = 42', ko: 'seed = 42' },
      file: 'showcase/assets/sounds/claw_hit.ashfox',
      sourceHref: '/showcase/assets/sounds/claw_hit.ashfox',
      outputHref: '/media/catalog/claw-hit.wav',
      waveHref: '/media/catalog/claw-hit.svg',
      studioId: 'claw_hit',
      meta: 'claw_hit · seed = 42',
      codeLine: '  seed = 42;',
    },
    {
      id: 'claw_alt',
      token: 'alternate',
      label: { en: 'variant = alternate', ko: 'variant = alternate' },
      file: 'showcase/assets/sounds/claw_hit.ashfox',
      sourceHref: '/showcase/assets/sounds/claw_hit.ashfox',
      outputHref: '/media/catalog/claw-alternate.wav',
      waveHref: '/media/catalog/claw-alternate.svg',
      studioId: 'claw_hit',
      meta: 'claw_hit · variant = alternate',
      codeLine: '  variants { base = 42; alternate = 43; }',
    },
    {
      id: 'energy',
      token: 'energy',
      label: { en: 'energy', ko: 'energy' },
      file: 'showcase/assets/sounds/energy.ashfox',
      sourceHref: '/showcase/assets/sounds/energy.ashfox',
      outputHref: '/media/catalog/energy.wav',
      waveHref: '/media/catalog/energy.svg',
      studioId: 'energy',
      meta: 'energy · sci-fi blaster',
      codeLine: '  sound energy { space { preset = stone_hall; } }',
    },
    {
      id: 'storm',
      token: 'storm',
      label: { en: 'storm', ko: 'storm' },
      file: 'showcase/assets/sounds/storm.ashfox',
      sourceHref: '/showcase/assets/sounds/storm.ashfox',
      outputHref: '/media/catalog/storm.wav',
      waveHref: '/media/catalog/storm.svg',
      studioId: 'storm',
      meta: 'storm · seamless stereo loop',
      codeLine: '  loop { at = 0.35s..2.75s; xfade = 80ms; }',
    },
  ],
};

const isThreeDomain = (domain) => domain === 'model' || domain === 'structure' || domain === 'vfx';

const escapeText = (value) =>
  String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const renderDiffPatch = (prevItem, nextItem, patchEl) => {
  const prevLine = prevItem ? prevItem.codeLine : nextItem.codeLine;
  patchEl.innerHTML = [
    '<span class="diff-ctx">  1  ashfox 1</span>',
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
  const show3d = isThreeDomain(domain);
  els.pane3d.hidden = !show3d;
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
    void viewer.mount(els.host3d, item.outputHref, {
      controlsRoot: els.controls3d,
      domain,
    });
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
  let activeDomain = 'model';
  let activeItem = DIFF_ITEMS.model[0];
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
    if (!DIFF_ITEMS[domain]) return;
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
  switchDomain('model', true);
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
