export const DOMAINS = ['all', 'model', 'structure', 'vfx', 'sprite', 'tile', 'sound'];

export const is3dDomain = (domain) =>
  domain === 'model' || domain === 'structure' || domain === 'vfx';

export const is2dDomain = (domain) => domain === 'sprite' || domain === 'tile';

export const formatCountLabel = (template, count) =>
  String(template || '').replace('{count}', String(count));

export const buildCatalogIndex = (catalog) => {
  const map = new Map();
  for (const entry of catalog) {
    const parts = [
      entry.id,
      entry.slug,
      entry.exportId,
      entry.domain,
      entry.genre,
      entry.category,
      entry.name?.en,
      entry.name?.ko,
      entry.summary?.en,
      entry.summary?.ko,
      ...(entry.tags || []),
    ];
    map.set(entry.id, {
      entry,
      hay: parts.filter(Boolean).join(' ').toLowerCase(),
    });
  }
  return map;
};

export const collectGenres = (catalog, domain) => {
  const seen = new Set();
  for (const entry of catalog) {
    if ((domain === 'all' || entry.domain === domain) && entry.genre) {
      seen.add(entry.genre);
    }
  }
  return [...seen];
};

export const filterCatalog = (catalog, index, state) => {
  const q = state.query.trim().toLowerCase();
  return catalog.filter((entry) => {
    if (state.domain !== 'all' && entry.domain !== state.domain) return false;
    if (state.genre !== 'all' && entry.genre !== state.genre) return false;
    if (!q) return true;
    return index.get(entry.id)?.hay.includes(q) ?? false;
  });
};

export const readInitialState = (catalog) => {
  const params = new URLSearchParams(window.location.search);
  const rawDomain = params.get('domain') || 'all';
  const domain = DOMAINS.includes(rawDomain) ? rawDomain : 'all';
  const genre = params.get('genre') || 'all';
  const query = params.get('q') || '';
  const requestedAsset = params.get('asset');
  const hasAsset = Boolean(requestedAsset);
  const validAsset = requestedAsset && catalog.some((item) => item.id === requestedAsset);
  return {
    mode: hasAsset ? 'workbench' : 'gallery',
    domain,
    genre,
    query,
    id: validAsset ? requestedAsset : catalog[0]?.id || '',
  };
};

export const syncUrl = (state, { push = false } = {}) => {
  const url = new URL(window.location.href);
  if (state.domain === 'all') url.searchParams.delete('domain');
  else url.searchParams.set('domain', state.domain);
  if (state.genre === 'all') url.searchParams.delete('genre');
  else url.searchParams.set('genre', state.genre);
  if (!state.query.trim()) url.searchParams.delete('q');
  else url.searchParams.set('q', state.query.trim());
  if (state.mode === 'workbench' && state.id) url.searchParams.set('asset', state.id);
  else url.searchParams.delete('asset');
  const next = url.toString();
  if (next === window.location.href) return;
  if (push) window.history.pushState(null, '', next);
  else window.history.replaceState(null, '', next);
};

export const copyText = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const el = document.createElement('textarea');
  el.value = text;
  el.setAttribute('readonly', '');
  el.style.position = 'fixed';
  el.style.opacity = '0';
  document.body.append(el);
  el.select();
  const ok = document.execCommand('copy');
  el.remove();
  if (!ok) throw new Error('Clipboard unavailable');
};

export const flashButtonLabel = (btn, label, fallback) => {
  if (!btn) return;
  const original = fallback || btn.dataset.defaultLabel || btn.textContent;
  btn.dataset.defaultLabel = original;
  btn.textContent = label;
  window.clearTimeout(Number(btn.dataset.flashTimer || 0));
  const timer = window.setTimeout(() => {
    btn.textContent = original;
  }, 1400);
  btn.dataset.flashTimer = String(timer);
};
