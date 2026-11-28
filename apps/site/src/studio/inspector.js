import { highlightAshfox } from './highlight.js';
import { buildAgentPrompt, buildUseSnippets } from './snippets.js';
import { copyText, flashButtonLabel, is2dDomain, is3dDomain } from './state.js';

const formatBytes = (byteLength) => {
  if (!Number.isFinite(byteLength) || byteLength <= 0) return '—';
  if (byteLength < 1024) return `${byteLength} B`;
  return `${(byteLength / 1024).toFixed(1)} KB`;
};

const specRowsForEntry = (entry, copy) => {
  const m = entry.meta || {};
  const rows = [
    [copy.specDomain || 'Domain', entry.domain],
    [copy.specGenre || 'Genre', entry.genre || '—'],
    [copy.specCategory || 'Category', entry.category || '—'],
  ];
  if (is3dDomain(entry.domain)) {
    if (Number.isFinite(m.triangles))
      rows.push([copy.specTriangles || 'Triangles', String(m.triangles)]);
    if (Number.isFinite(m.vertices))
      rows.push([copy.specVertices || 'Vertices', String(m.vertices)]);
    if (Array.isArray(m.lods) && m.lods.length) {
      rows.push([copy.specLods || 'LOD Levels', m.lods.join(', ')]);
    }
    const clips = m.clips?.length ? m.clips : entry.motions || [];
    if (clips.length) rows.push([copy.specMotions || 'Animations', clips.join(', ')]);
  } else if (is2dDomain(entry.domain)) {
    if (m.width && m.height)
      rows.push([copy.specResolution || 'Resolution', `${m.width} × ${m.height}`]);
    if (m.spriteProfile) rows.push([copy.specProfile || 'Profile', m.spriteProfile]);
    if (m.nineSlice) {
      const ns = Array.isArray(m.nineSlice)
        ? m.nineSlice.join(' / ')
        : `${m.nineSlice.top ?? 6} / ${m.nineSlice.right ?? 6} / ${m.nineSlice.bottom ?? 6} / ${m.nineSlice.left ?? 6}`;
      rows.push([copy.specNineSlice || '9-Slice Insets', `${ns} px`]);
    }
  } else if (entry.domain === 'sound') {
    if (Number.isFinite(m.durationSec)) {
      rows.push([copy.specDuration || 'Duration', `${m.durationSec.toFixed(2)}s`]);
    }
    if (m.sampleRate) rows.push([copy.specSampleRate || 'Sample Rate', `${m.sampleRate} Hz`]);
    if (m.channels) rows.push([copy.specChannels || 'Channels', String(m.channels)]);
    rows.push([copy.specLoop || 'Loop', m.loop ? 'true' : 'false']);
  }
  if (Number.isFinite(m.byteLength)) {
    rows.push([copy.specSize || 'Output Size', formatBytes(m.byteLength)]);
  }
  rows.push([copy.specSourcePath || 'Source Path', entry.sourcePath]);
  return rows;
};

export const initInspector = (root, { lang, copy, onFilterTag }) => {
  const dock = root.querySelector('[data-studio-inspector]');
  const titleEl = root.querySelector('[data-inspector-title]');
  const specsEl = root.querySelector('[data-inspector-specs]');
  const summaryEl = root.querySelector('[data-inspector-summary]');
  const downloadEl = root.querySelector('[data-inspector-download]');
  const copyPromptBtn = root.querySelector('[data-copy-asset-prompt]');
  const srcPathEl = root.querySelector('[data-inspector-source-path]');
  const srcLinkEl = root.querySelector('[data-inspector-source-link]');
  const codeEl = root.querySelector('[data-inspector-code]');
  const copySourceBtn = root.querySelector('[data-copy-asset-source]');
  const rawToggleBtn = root.querySelector('[data-source-raw]');
  const specsTable = root.querySelector('[data-specs-table]');
  const specsTags = root.querySelector('[data-specs-tags]');
  const useList = root.querySelector('[data-use-snippets]');
  const tabBtns = [...root.querySelectorAll('[data-inspector-tab]')];
  const panels = {
    source: root.querySelector('[data-panel-source]'),
    specs: root.querySelector('[data-panel-specs]'),
    use: root.querySelector('[data-panel-use]'),
  };

  const sourceCache = new Map();
  let activeEntry = null;
  let activeSourceText = '';
  let rawMode = false;
  let fetchToken = 0;

  const setTab = (tabName) => {
    for (const btn of tabBtns) {
      btn.setAttribute('aria-selected', String(btn.dataset.inspectorTab === tabName));
    }
    for (const [key, panel] of Object.entries(panels)) {
      if (panel) panel.hidden = key !== tabName;
    }
  };

  const renderSourceCode = () => {
    if (!codeEl) return;
    if (rawMode) {
      codeEl.textContent = activeSourceText;
    } else {
      codeEl.innerHTML = highlightAshfox(activeSourceText);
    }
    if (rawToggleBtn) {
      rawToggleBtn.setAttribute('aria-pressed', String(rawMode));
      rawToggleBtn.textContent = rawMode
        ? copy.sourceHighlighted || 'Highlight'
        : copy.sourceRaw || 'Raw';
    }
  };

  const renderSpecsPanel = (entry) => {
    if (specsTable) {
      specsTable.innerHTML = '';
      for (const [label, value] of specRowsForEntry(entry, copy)) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = value;
        specsTable.append(dt, dd);
      }
    }
    if (specsTags) {
      specsTags.innerHTML = '';
      for (const tag of entry.tags || []) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tag-chip';
        btn.dataset.specTag = tag;
        btn.textContent = `#${tag}`;
        btn.addEventListener('click', () => onFilterTag(tag));
        specsTags.append(btn);
      }
    }
  };

  const renderUsePanel = (entry) => {
    if (!useList) return;
    useList.innerHTML = '';
    for (const snippet of buildUseSnippets(entry, lang, copy)) {
      const card = document.createElement('div');
      card.className = 'use-card';
      const head = document.createElement('div');
      head.className = 'use-card-head';
      const title = document.createElement('strong');
      title.textContent = snippet.label;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'button button-ghost use-copy-btn';
      btn.dataset.copySnippet = snippet.id;
      btn.textContent = copy.copy || 'Copy';
      btn.addEventListener('click', async () => {
        try {
          await copyText(snippet.code);
          flashButtonLabel(btn, copy.copied || 'Copied', copy.copy || 'Copy');
        } catch {}
      });
      head.append(title, btn);
      const pre = document.createElement('pre');
      pre.tabIndex = 0;
      const code = document.createElement('code');
      code.textContent = snippet.code;
      pre.append(code);
      card.append(head, pre);
      useList.append(card);
    }
  };

  for (const btn of tabBtns) {
    btn.addEventListener('click', () => setTab(btn.dataset.inspectorTab));
  }

  rawToggleBtn?.addEventListener('click', () => {
    rawMode = !rawMode;
    renderSourceCode();
  });

  copyPromptBtn?.addEventListener('click', async () => {
    if (!activeEntry) return;
    try {
      await copyText(buildAgentPrompt(activeEntry, lang));
      flashButtonLabel(
        copyPromptBtn,
        copy.copied || 'Copied',
        copy.studioCopyPrompt || 'Copy Prompt',
      );
    } catch {}
  });

  copySourceBtn?.addEventListener('click', async () => {
    if (!activeSourceText) return;
    try {
      await copyText(activeSourceText);
      flashButtonLabel(copySourceBtn, copy.copied || 'Copied', copy.copy || 'Copy');
    } catch {}
  });

  const render = async (entry) => {
    activeEntry = entry;
    if (!dock || !entry) return;
    if (titleEl) titleEl.textContent = entry.name?.[lang] || entry.name?.en || entry.id;
    if (specsEl) specsEl.textContent = entry.specs?.[lang] || entry.specs?.en || '';
    if (summaryEl) summaryEl.textContent = entry.summary?.[lang] || entry.summary?.en || '';
    if (downloadEl) downloadEl.href = entry.outputHref;
    if (srcPathEl) srcPathEl.textContent = entry.sourcePath;
    if (srcLinkEl) srcLinkEl.href = entry.sourceHref;

    renderSpecsPanel(entry);
    renderUsePanel(entry);

    const token = ++fetchToken;
    if (sourceCache.has(entry.sourceHref)) {
      activeSourceText = sourceCache.get(entry.sourceHref);
      renderSourceCode();
      return;
    }

    activeSourceText = copy.loadingSource || 'Loading…';
    if (codeEl) codeEl.textContent = activeSourceText;
    try {
      const resp = await fetch(entry.sourceHref);
      const text = resp.ok ? (await resp.text()).trim() : entry.sourcePath;
      sourceCache.set(entry.sourceHref, text);
      if (token === fetchToken) {
        activeSourceText = text;
        renderSourceCode();
      }
    } catch {
      if (token === fetchToken) {
        activeSourceText = entry.sourcePath;
        renderSourceCode();
      }
    }
  };

  setTab('source');

  return { render, setTab };
};
