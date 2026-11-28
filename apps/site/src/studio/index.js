import { initGallery } from './gallery.js';
import {
  buildCatalogIndex,
  collectGenres,
  filterCatalog,
  formatCountLabel,
  readInitialState,
  syncUrl,
} from './state.js';
import { initWorkbench } from './workbench.js';

const GENRE_LABELS = {
  fantasy: 'genreFantasy',
  scifi: 'genreScifi',
  dungeon: 'genreDungeon',
  horror: 'genreHorror',
  modern: 'genreModern',
  postapoc: 'genrePostapoc',
  nature: 'genreNature',
  ui: 'genreUi',
};

const isInputTarget = (target) =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable);

const initStudio = () => {
  const root = document.querySelector('[data-studio-app]');
  const jsonEl = document.getElementById('asset-catalog-data');
  if (!root || !jsonEl) return;

  const lang = root.dataset.locale || 'en';
  const copy = JSON.parse(document.body.dataset.siteCopy || '{}');
  const catalog = JSON.parse(jsonEl.textContent || '[]');
  const catalogIndex = buildCatalogIndex(catalog);
  const state = readInitialState(catalog);

  const countBadge = root.querySelector('[data-catalog-count]');
  const searchInput = root.querySelector('[data-studio-search]');
  const domainBtns = [...root.querySelectorAll('[data-domain-tab]')];
  const modeBtns = [...root.querySelectorAll('[data-studio-mode-btn]')];
  const genreBar = root.querySelector('[data-genre-bar]');

  let visibleEntries = catalog;
  let galleryApi;
  let workbenchApi;

  const renderGenres = () => {
    if (!genreBar) return;
    const genres = collectGenres(catalog, state.domain);
    genreBar.hidden = genres.length <= 1;
    genreBar.innerHTML = '';
    if (genres.length <= 1) return;

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'genre-chip';
    allBtn.dataset.genreChip = 'all';
    allBtn.setAttribute('aria-pressed', String(state.genre === 'all'));
    allBtn.textContent = copy.genreAll || 'All';
    allBtn.addEventListener('click', () => {
      state.genre = 'all';
      applyState();
    });
    genreBar.append(allBtn);

    for (const genre of genres) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'genre-chip';
      btn.dataset.genreChip = genre;
      btn.setAttribute('aria-pressed', String(state.genre === genre));
      btn.textContent = copy[GENRE_LABELS[genre]] || genre;
      btn.addEventListener('click', () => {
        state.genre = state.genre === genre ? 'all' : genre;
        applyState();
      });
      genreBar.append(btn);
    }
  };

  const applyState = ({ push = false, reloadAsset = false } = {}) => {
    const validGenres = new Set(collectGenres(catalog, state.domain));
    if (state.genre !== 'all' && !validGenres.has(state.genre)) state.genre = 'all';

    visibleEntries = filterCatalog(catalog, catalogIndex, state);
    const visibleIds = new Set(visibleEntries.map((item) => item.id));

    root.dataset.studioMode = state.mode;
    if (countBadge) {
      countBadge.textContent = formatCountLabel(
        `${visibleEntries.length} ${copy.studioCountLabel || 'assets'}`,
        visibleEntries.length,
      );
    }
    if (searchInput && searchInput.value !== state.query) searchInput.value = state.query;

    for (const btn of domainBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.domainTab === state.domain));
    }
    for (const btn of modeBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.studioModeBtn === state.mode));
    }

    renderGenres();
    galleryApi.update(visibleIds, state.mode === 'gallery');
    workbenchApi.updateList(visibleIds, state.mode === 'workbench');

    if (state.mode === 'workbench') {
      if (!visibleIds.has(state.id) && visibleEntries.length) {
        state.id = visibleEntries[0].id;
        reloadAsset = true;
      }
      if (reloadAsset) {
        const entry = catalogIndex.get(state.id)?.entry;
        if (entry) workbenchApi.showAsset(entry);
      }
    }

    syncUrl(state, { push });
  };

  const openAsset = (id, { push = true } = {}) => {
    if (!catalogIndex.has(id)) return;
    state.mode = 'workbench';
    state.id = id;
    applyState({ push, reloadAsset: true });
  };

  const resetFilters = () => {
    state.domain = 'all';
    state.genre = 'all';
    state.query = '';
    applyState({ reloadAsset: state.mode === 'workbench' });
  };

  galleryApi = initGallery(root, {
    onOpenAsset: (id) => openAsset(id, { push: true }),
    onResetFilters: resetFilters,
  });

  workbenchApi = initWorkbench(root, {
    lang,
    copy,
    onSelectAsset: (id) => openAsset(id, { push: false }),
    onResetFilters: resetFilters,
    onFilterTag: (tag) => {
      state.query = tag;
      applyState({ reloadAsset: state.mode === 'workbench' });
    },
  });

  for (const btn of domainBtns) {
    btn.addEventListener('click', () => {
      state.domain = btn.dataset.domainTab;
      applyState({ reloadAsset: state.mode === 'workbench' });
    });
  }

  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      const nextMode = btn.dataset.studioModeBtn;
      if (nextMode === state.mode) return;
      state.mode = nextMode;
      applyState({ push: true, reloadAsset: nextMode === 'workbench' });
    });
  }

  searchInput?.addEventListener('input', (e) => {
    state.query = e.target.value;
    applyState({ reloadAsset: state.mode === 'workbench' });
  });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/' && !isInputTarget(e.target)) {
      e.preventDefault();
      searchInput?.focus();
      searchInput?.select();
      return;
    }
    if (e.key === 'Escape') {
      if (document.activeElement === searchInput) {
        searchInput.blur();
      } else if (state.mode === 'workbench' && !document.fullscreenElement) {
        state.mode = 'gallery';
        applyState({ push: true });
      }
      return;
    }
    if (isInputTarget(e.target)) return;
    if (state.mode !== 'workbench') return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!visibleEntries.length) return;
      const idx = visibleEntries.findIndex((item) => item.id === state.id);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const nextIdx = idx < 0 ? 0 : (idx + step + visibleEntries.length) % visibleEntries.length;
      openAsset(visibleEntries[nextIdx].id, { push: false });
      return;
    }

    if (
      e.key === ' ' &&
      (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)
    ) {
      return;
    }
    workbenchApi.handleShortcut(e);
  });

  window.addEventListener('popstate', () => {
    const next = readInitialState(catalog);
    Object.assign(state, next);
    applyState({ push: false, reloadAsset: state.mode === 'workbench' });
  });

  applyState({ push: false, reloadAsset: state.mode === 'workbench' });
};

initStudio();
