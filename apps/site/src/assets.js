const studioCopy = JSON.parse(document.body.dataset.siteCopy || '{}');
let activeMountToken = 0;

const waitForViewer = async () => {
  for (let i = 0; i < 60; i += 1) {
    if (window.ashfoxViewer) return window.ashfoxViewer;
    await new Promise((r) => window.setTimeout(r, 50));
  }
  return null;
};

const renderSpriteStage = (entry, stageEls) => {
  stageEls.sprite.hidden = entry.domain === 'tile';
  stageEls.tile.hidden = entry.domain !== 'tile';
  stageEls.sprite.src = entry.outputHref;
  stageEls.sprite.alt = entry.name.en;
  stageEls.tile.style.backgroundImage = `url(${entry.outputHref})`;
  if (entry.domain !== 'tile') return;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'button button-ghost';
  toggle.textContent = studioCopy.studioToggleTile || '1x / 3x3';
  toggle.addEventListener('click', () => {
    const showGrid = stageEls.tile.hidden;
    stageEls.tile.hidden = !showGrid;
    stageEls.sprite.hidden = showGrid;
  });
  stageEls.controls.append(toggle);
};

const renderSoundStage = (entry, stageEls) => {
  stageEls.wave.hidden = false;
  stageEls.wave.src = entry.previewHref;
  stageEls.audio.src = entry.outputHref;
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'button button-primary';
  playBtn.textContent = studioCopy.playSound || '▶ Play';
  playBtn.addEventListener('click', () => {
    if (stageEls.audio.paused) void stageEls.audio.play().catch(() => {});
    else stageEls.audio.pause();
  });
  stageEls.audio.onplay = () => {
    playBtn.textContent = studioCopy.pauseSound || '⏸ Pause';
  };
  stageEls.audio.onpause = () => {
    playBtn.textContent = studioCopy.playSound || '▶ Play';
  };
  stageEls.controls.append(playBtn);
  if (!entry.alternateHref) return;
  const altBtn = document.createElement('button');
  altBtn.type = 'button';
  altBtn.className = 'button button-ghost';
  altBtn.textContent = studioCopy.another || 'Alternate seed';
  let alt = false;
  altBtn.addEventListener('click', () => {
    alt = !alt;
    stageEls.audio.src = alt ? entry.alternateHref : entry.outputHref;
    stageEls.wave.src = alt ? entry.alternateWaveHref : entry.previewHref;
    void stageEls.audio.play().catch(() => {});
  });
  stageEls.controls.append(altBtn);
};

const renderModelStage = async (entry, stageEls, lang, token) => {
  stageEls.host3d.hidden = false;
  delete stageEls.host3d.dataset.ready;
  const viewer = await waitForViewer();
  if (token !== activeMountToken) return;
  const clipBar = document.createElement('div');
  clipBar.className = 'segmented-strip';
  for (const clip of entry.motions || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.modelMotion = clip;
    btn.textContent = clip.replaceAll('_', ' ');
    clipBar.append(btn);
  }
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'button button-ghost';
  resetBtn.dataset.modelView = '3.79159';
  resetBtn.textContent = lang === 'ko' ? '시점 초기화' : 'Reset view';
  if (entry.motions?.length) stageEls.controls.append(clipBar);
  stageEls.controls.append(resetBtn);
  if (viewer && token === activeMountToken) {
    await viewer.mount(stageEls.host3d, entry.outputHref, {
      controlsRoot: stageEls.controls,
      enableZoom: true,
    });
  }
};

const queryStudioElements = (root) => ({
  stageEls: {
    host3d: root.querySelector('[data-inspector-3d]'),
    sprite: root.querySelector('[data-inspector-sprite]'),
    tile: root.querySelector('[data-inspector-tile]'),
    wave: root.querySelector('[data-inspector-wave]'),
    audio: root.querySelector('[data-studio-audio]'),
    controls: root.querySelector('[data-inspector-controls]'),
  },
  info: {
    title: root.querySelector('[data-inspector-title]'),
    specs: root.querySelector('[data-inspector-specs]'),
    summary: root.querySelector('[data-inspector-summary]'),
    download: root.querySelector('[data-inspector-download]'),
    srcPath: root.querySelector('[data-inspector-source-path]'),
    srcLink: root.querySelector('[data-inspector-source-link]'),
    code: root.querySelector('[data-inspector-code]'),
    count: root.querySelector('[data-catalog-count]'),
    copyPrompt: root.querySelector('[data-copy-asset-prompt]'),
    copySource: root.querySelector('[data-copy-asset-source]'),
    search: root.querySelector('[data-studio-search]'),
  },
});

const buildCatalogMap = (catalog) => {
  const map = new Map();
  for (const entry of catalog) {
    const hay =
      `${entry.id} ${entry.name.en} ${entry.name.ko} ${entry.category} ${entry.tags.join(' ')}`.toLowerCase();
    map.set(entry.id, { entry, hay });
  }
  return map;
};

const filterCatalogRows = (rows, catalogMap, domain, query) => {
  const q = query.trim().toLowerCase();
  let visible = 0;
  let firstVisibleId = null;
  for (const row of rows) {
    const record = catalogMap.get(row.dataset.catalogRow);
    const match =
      record !== undefined &&
      (domain === 'all' || record.entry.domain === domain) &&
      (!q || record.hay.includes(q));
    row.hidden = !match;
    if (match) {
      visible += 1;
      if (!firstVisibleId) firstVisibleId = record.entry.id;
    }
  }
  return { visible, firstVisibleId };
};

const renderInspectorEntry = async (entry, rows, stageEls, info, lang) => {
  for (const row of rows)
    row.setAttribute('aria-selected', String(row.dataset.catalogRow === entry.id));
  info.title.textContent = entry.name[lang] || entry.name.en;
  info.specs.textContent = entry.specs[lang] || entry.specs.en;
  info.summary.textContent = entry.summary[lang] || entry.summary.en;
  info.download.href = entry.outputHref;
  info.srcPath.textContent = entry.sourcePath;
  info.srcLink.href = entry.sourceHref;

  activeMountToken += 1;
  const token = activeMountToken;
  stageEls.audio.pause();
  stageEls.host3d.hidden = true;
  delete stageEls.host3d.dataset.ready;
  stageEls.sprite.hidden = true;
  stageEls.tile.hidden = true;
  stageEls.wave.hidden = true;
  stageEls.controls.innerHTML = '';

  if (entry.domain === 'model') void renderModelStage(entry, stageEls, lang, token);
  else if (entry.domain === 'sound') renderSoundStage(entry, stageEls);
  else renderSpriteStage(entry, stageEls);

  info.code.textContent = studioCopy.loadingSource || 'Loading…';
  try {
    const resp = await fetch(entry.sourceHref);
    const bodyText = resp.ok ? (await resp.text()).trim() : entry.sourcePath;
    if (token === activeMountToken) info.code.textContent = bodyText;
  } catch {
    if (token === activeMountToken) info.code.textContent = entry.sourcePath;
  }
};

const flashCopyLabel = (btn, fallbackLabel) => {
  const prev = btn.textContent;
  btn.textContent = studioCopy.copied || 'Copied';
  window.setTimeout(() => {
    btn.textContent = fallbackLabel || prev;
  }, 1500);
};

const bindStudioActions = (root, info, lang, getActiveEntry) => {
  info.copyPrompt?.addEventListener('click', async () => {
    const entry = getActiveEntry();
    if (!entry) return;
    const text =
      lang === 'ko'
        ? `https://ashfox.io/agent.md 를 읽고 https://ashfox.io${entry.sourceHref} 예제를 참고해 비슷한 에셋을 만들어 줘.`
        : `Read https://ashfox.io/agent.md and use https://ashfox.io${entry.sourceHref} as reference to build a matching asset.`;
    try {
      await navigator.clipboard?.writeText(text);
      flashCopyLabel(info.copyPrompt, studioCopy.studioCopyPrompt);
    } catch {}
  });
  info.copySource?.addEventListener('click', async () => {
    try {
      await navigator.clipboard?.writeText(info.code.textContent || '');
      flashCopyLabel(info.copySource, studioCopy.copy);
    } catch {}
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== info.search) {
      e.preventDefault();
      info.search?.focus();
    }
  });
};

const syncStudioUrl = (state) => {
  const url = new URL(window.location.href);
  if (state.domain === 'all') url.searchParams.delete('domain');
  else url.searchParams.set('domain', state.domain);
  if (state.id) url.searchParams.set('asset', state.id);
  window.history.replaceState(null, '', url.toString());
};

const bindStudioControls = ({ root, rows, info, state, refresh, selectAsset }) => {
  for (const btn of root.querySelectorAll('[data-domain-tab]')) {
    btn.addEventListener('click', () => {
      state.domain = btn.dataset.domainTab;
      refresh();
    });
  }
  for (const r of rows) r.addEventListener('click', () => selectAsset(r.dataset.catalogRow));
  info.search?.addEventListener('input', (e) => {
    state.query = e.target.value;
    refresh();
  });
};

const initAssetStudio = () => {
  const root = document.querySelector('[data-asset-studio]');
  const jsonEl = document.getElementById('asset-catalog-data');
  if (!root || !jsonEl) return;

  const lang = root.dataset.locale || 'en';
  const catalog = JSON.parse(jsonEl.textContent || '[]');
  const catalogMap = buildCatalogMap(catalog);
  const rows = [...root.querySelectorAll('[data-catalog-row]')];
  const { stageEls, info } = queryStudioElements(root);
  const state = { domain: 'all', id: catalog[0]?.id, query: '' };

  const selectAsset = (id) => {
    const entry = catalogMap.get(id)?.entry || catalog[0];
    if (!entry) return;
    state.id = entry.id;
    syncStudioUrl(state);
    void renderInspectorEntry(entry, rows, stageEls, info, lang);
  };

  const refresh = () => {
    const { visible, firstVisibleId } = filterCatalogRows(
      rows,
      catalogMap,
      state.domain,
      state.query,
    );
    info.count.textContent = `${visible} ${studioCopy.studioCountLabel || 'assets'}`;
    for (const btn of root.querySelectorAll('[data-domain-tab]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.domainTab === state.domain));
    }
    const stillVisible = rows.some((r) => r.dataset.catalogRow === state.id && !r.hidden);
    if (!stillVisible && firstVisibleId) selectAsset(firstVisibleId);
    else syncStudioUrl(state);
  };

  bindStudioControls({ root, rows, info, state, refresh, selectAsset });
  bindStudioActions(root, info, lang, () => catalogMap.get(state.id)?.entry);

  const params = new URLSearchParams(window.location.search);
  state.domain = params.get('domain') || 'all';
  state.id = params.get('asset') || state.id;
  refresh();
  selectAsset(state.id);
};

initAssetStudio();
