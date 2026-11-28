import { initInspector } from './inspector.js';
import { initStage2d } from './stage2d.js';
import { initStageAudio } from './stageAudio.js';
import { is2dDomain, is3dDomain } from './state.js';

const waitForViewer = async () => {
  for (let i = 0; i < 60; i += 1) {
    if (window.ashfoxViewer) return window.ashfoxViewer;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return null;
};

export const initWorkbench = (root, { lang, copy, onSelectAsset, onResetFilters, onFilterTag }) => {
  const workbenchEl = root.querySelector('[data-studio-workbench]');
  const listEl = root.querySelector('[data-studio-list]');
  const railRows = [...root.querySelectorAll('[data-catalog-row]')];
  const railEmptyEl = root.querySelector('[data-rail-empty]');
  const railResetBtn = root.querySelector('[data-reset-filters]');
  const railToggleBtn = root.querySelector('[data-rail-toggle]');
  const inspectorToggleBtn = root.querySelector('[data-inspector-toggle]');

  const stage3d = root.querySelector('[data-stage-3d]');
  const host3d = root.querySelector('[data-inspector-3d]');
  const loadingEl = root.querySelector('[data-stage-loading]');
  const progressBarEl = root.querySelector('[data-stage-progress]');
  const wireframeBtn = root.querySelector('[data-hud-wireframe]');
  const gridBtn = root.querySelector('[data-hud-grid]');
  const rotateBtn = root.querySelector('[data-hud-rotate]');
  const backdropBtns = [...root.querySelectorAll('[data-hud-backdrop]')];
  const camBtns = [...root.querySelectorAll('[data-hud-cam]')];
  const lodWrap = root.querySelector('[data-hud-lod-wrap]');
  const lodBtns = [...root.querySelectorAll('[data-hud-lod]')];
  const trisBadge = root.querySelector('[data-hud-tris]');
  const fullscreenBtn = root.querySelector('[data-hud-fullscreen]');
  const motionBar = root.querySelector('[data-motion-bar]');
  const motionClipsEl = root.querySelector('[data-motion-clips]');
  const motionPlayBtn = root.querySelector('[data-motion-play]');
  const speedBtns = [...root.querySelectorAll('[data-motion-speed]')];
  const scrubInput = root.querySelector('[data-motion-scrub]');
  const vfxReplayBtn = root.querySelector('[data-vfx-replay]');

  const stage2d = initStage2d(root);
  const stageAudio = initStageAudio(root, copy);
  const inspector = initInspector(root, { lang, copy, onFilterTag });

  let controller = null;
  let activeEntry = null;
  let loadSeq = 0;
  let wireframe = false;
  let grid = true;
  let autoRotate = false;
  let backdrop = 'obsidian';
  let playing = true;
  let speed = 1;
  let activeLod = 'auto';
  let activeClip = '';

  const setLoading = (visible, progress = 0) => {
    if (loadingEl) loadingEl.hidden = !visible;
    if (progressBarEl)
      progressBarEl.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  };

  const syncHudControls = (state = {}) => {
    if (typeof state.wireframe === 'boolean') wireframe = state.wireframe;
    if (typeof state.grid === 'boolean') grid = state.grid;
    if (typeof state.autoRotate === 'boolean') autoRotate = state.autoRotate;
    if (state.backdrop) backdrop = state.backdrop;
    if (typeof state.playing === 'boolean') playing = state.playing;
    if (typeof state.speed === 'number') speed = state.speed;
    if (state.lod || state.activeLod) activeLod = state.lod || state.activeLod;
    if (state.clip || state.activeClip) activeClip = state.clip || state.activeClip;

    wireframeBtn?.setAttribute('aria-pressed', String(wireframe));
    gridBtn?.setAttribute('aria-pressed', String(grid));
    rotateBtn?.setAttribute('aria-pressed', String(autoRotate));

    for (const btn of backdropBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.hudBackdrop === backdrop));
    }
    if (stage3d) stage3d.dataset.viewerBackdrop = backdrop;

    const lods = state.lods?.length ? state.lods : activeEntry?.meta?.lods || [];
    if (lodWrap) lodWrap.hidden = lods.length === 0;
    for (const btn of lodBtns) {
      const mode = btn.dataset.hudLod;
      const available = mode === 'auto' || lods.includes(mode);
      btn.hidden = !available;
      btn.setAttribute('aria-pressed', String(mode === activeLod));
    }

    const tris = Number.isFinite(state.triangles) ? state.triangles : activeEntry?.meta?.triangles;
    if (trisBadge) {
      trisBadge.hidden = !Number.isFinite(tris) || tris <= 0;
      if (Number.isFinite(tris) && tris > 0) {
        trisBadge.textContent = `${tris.toLocaleString()} ${copy.hudTris || 'tris'}`;
      }
    }

    if (motionPlayBtn) {
      motionPlayBtn.setAttribute('aria-pressed', String(playing));
      motionPlayBtn.textContent = playing
        ? `⏸ ${copy.motionPause || 'Pause'}`
        : `▶ ${copy.motionPlay || 'Play'}`;
    }

    for (const btn of speedBtns) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset.motionSpeed) === speed));
    }

    for (const btn of motionClipsEl?.querySelectorAll('[data-clip-btn]') || []) {
      btn.setAttribute('aria-pressed', String(btn.dataset.clipBtn === activeClip));
    }

    if (scrubInput && document.activeElement !== scrubInput) {
      const norm =
        typeof state.progress === 'number'
          ? state.progress
          : state.duration > 0
            ? (state.time || 0) / state.duration
            : 0;
      scrubInput.value = String(Math.round(Math.max(0, Math.min(1, norm)) * 1000));
    }
  };

  const rebuildMotionClips = (clips) => {
    if (!motionClipsEl) return;
    motionClipsEl.innerHTML = '';
    for (const clip of clips) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.clipBtn = clip;
      btn.textContent = clip.replaceAll('_', ' ');
      btn.setAttribute('aria-pressed', String(clip === activeClip));
      btn.addEventListener('click', () => {
        activeClip = clip;
        controller?.setClip?.(clip);
        syncHudControls();
      });
      motionClipsEl.append(btn);
    }
    const isVfx = activeEntry?.domain === 'vfx';
    if (vfxReplayBtn) vfxReplayBtn.hidden = !isVfx;
    if (motionBar) motionBar.hidden = clips.length === 0 && !isVfx;
  };

  const render3dStage = async (entry) => {
    if (!stage3d || !host3d) return;
    stage3d.hidden = false;
    const seq = ++loadSeq;
    const clips = entry.meta?.clips?.length ? entry.meta.clips : entry.motions || [];
    activeClip = clips[0] || '';
    activeLod = 'auto';
    rebuildMotionClips(clips);
    syncHudControls({ lods: entry.meta?.lods || [], triangles: entry.meta?.triangles });
    setLoading(true, 0.15);

    const viewer = await waitForViewer();
    if (seq !== loadSeq || !viewer) {
      setLoading(false);
      return;
    }

    let applyingLoad = true;
    const onProgress = (ratio) => {
      if (seq === loadSeq) setLoading(true, ratio);
    };
    const onState = (nextState) => {
      if (seq !== loadSeq || !nextState) return;
      if (
        Array.isArray(nextState.clips) &&
        nextState.clips.length &&
        !motionClipsEl?.children.length
      ) {
        rebuildMotionClips(nextState.clips);
      }
      if (applyingLoad) {
        syncHudControls({
          ...nextState,
          wireframe,
          grid,
          autoRotate,
          backdrop,
          speed,
        });
        return;
      }
      syncHudControls(nextState);
    };

    try {
      const mountOpts = {
        domain: entry.domain,
        enableZoom: true,
        wireframe,
        grid,
        autoRotate,
        backdrop,
        onProgress,
        onState,
      };
      if (!controller) {
        controller = await viewer.mount(host3d, entry.outputHref, mountOpts);
      } else if (typeof controller.load === 'function') {
        await controller.load(entry.outputHref, mountOpts);
      } else {
        controller = await viewer.mount(host3d, entry.outputHref, mountOpts);
      }
    } finally {
      applyingLoad = false;
      if (seq === loadSeq) setLoading(false);
    }

    if (seq !== loadSeq || !controller) return;
    controller.setWireframe?.(wireframe);
    controller.setGrid?.(grid);
    controller.setAutoRotate?.(autoRotate);
    controller.setBackdrop?.(backdrop);
    controller.setSpeed?.(speed);
    if (controller.getState) syncHudControls(controller.getState());
  };

  for (const row of railRows) {
    row.addEventListener('click', () => onSelectAsset(row.dataset.catalogRow));
  }
  railResetBtn?.addEventListener('click', onResetFilters);
  railToggleBtn?.addEventListener('click', () => {
    const collapsed = workbenchEl?.classList.toggle('is-rail-collapsed');
    railToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });
  inspectorToggleBtn?.addEventListener('click', () => {
    const collapsed = workbenchEl?.classList.toggle('is-inspector-collapsed');
    inspectorToggleBtn.setAttribute('aria-expanded', String(!collapsed));
  });

  wireframeBtn?.addEventListener('click', () => {
    wireframe = !wireframe;
    controller?.setWireframe?.(wireframe);
    syncHudControls();
  });
  gridBtn?.addEventListener('click', () => {
    grid = !grid;
    controller?.setGrid?.(grid);
    syncHudControls();
  });
  rotateBtn?.addEventListener('click', () => {
    autoRotate = !autoRotate;
    controller?.setAutoRotate?.(autoRotate);
    syncHudControls();
  });
  for (const btn of backdropBtns) {
    btn.addEventListener('click', () => {
      backdrop = btn.dataset.hudBackdrop;
      controller?.setBackdrop?.(backdrop);
      syncHudControls();
    });
  }
  for (const btn of camBtns) {
    btn.addEventListener('click', () => {
      controller?.setCameraPreset?.(btn.dataset.hudCam);
    });
  }
  for (const btn of lodBtns) {
    btn.addEventListener('click', () => {
      activeLod = btn.dataset.hudLod;
      controller?.setLod?.(activeLod);
      syncHudControls(controller?.getState?.() || {});
    });
  }
  fullscreenBtn?.addEventListener('click', () => {
    if (typeof controller?.toggleFullscreen === 'function') {
      controller.toggleFullscreen();
      return;
    }
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void stage3d?.requestFullscreen?.().catch(() => {});
  });
  motionPlayBtn?.addEventListener('click', () => {
    playing = !playing;
    controller?.setPlaying?.(playing);
    syncHudControls();
  });
  for (const btn of speedBtns) {
    btn.addEventListener('click', () => {
      speed = Number(btn.dataset.motionSpeed);
      controller?.setSpeed?.(speed);
      syncHudControls();
    });
  }
  scrubInput?.addEventListener('input', (e) => {
    controller?.seek?.(Number(e.target.value) / 1000);
  });
  vfxReplayBtn?.addEventListener('click', () => {
    playing = true;
    controller?.replay?.();
    syncHudControls();
  });

  const updateList = (visibleIds, isActiveMode) => {
    if (workbenchEl) workbenchEl.hidden = !isActiveMode;
    let visibleCount = 0;
    for (const row of railRows) {
      const show = visibleIds.has(row.dataset.catalogRow);
      row.hidden = !show;
      if (show) visibleCount += 1;
    }
    if (railEmptyEl) railEmptyEl.hidden = visibleCount > 0;
    if (!isActiveMode) {
      loadSeq += 1;
      controller?.setPlaying?.(false);
      stageAudio.hide();
    }
  };

  const showAsset = (entry) => {
    activeEntry = entry;
    if (!entry) return;
    for (const row of railRows) {
      const selected = row.dataset.catalogRow === entry.id;
      row.setAttribute('aria-selected', String(selected));
      if (selected && !row.hidden && listEl) {
        const rowTop = row.offsetTop - listEl.offsetTop;
        const rowBottom = rowTop + row.offsetHeight;
        if (rowTop < listEl.scrollTop) {
          listEl.scrollTop = Math.max(0, rowTop - 6);
        } else if (rowBottom > listEl.scrollTop + listEl.clientHeight) {
          listEl.scrollTop = rowBottom - listEl.clientHeight + 6;
        }
      }
    }

    if (is3dDomain(entry.domain)) {
      stage2d.hide();
      stageAudio.hide();
      void render3dStage(entry);
    } else if (is2dDomain(entry.domain)) {
      loadSeq += 1;
      controller?.setPlaying?.(false);
      if (stage3d) stage3d.hidden = true;
      stageAudio.hide();
      stage2d.show(entry, lang);
    } else {
      loadSeq += 1;
      controller?.setPlaying?.(false);
      if (stage3d) stage3d.hidden = true;
      stage2d.hide();
      stageAudio.show(entry);
    }

    void inspector.render(entry);
  };

  const handleShortcut = (e) => {
    if (!activeEntry) return;
    const key = e.key.toLowerCase();
    if (is3dDomain(activeEntry.domain)) {
      if (key === 'w') wireframeBtn?.click();
      else if (key === 'g') gridBtn?.click();
      else if (key === 'r') controller?.setCameraPreset?.('reset');
      else if (key === 'f') fullscreenBtn?.click();
      else if (e.key === ' ') {
        e.preventDefault();
        motionPlayBtn?.click();
      }
    } else if (activeEntry.domain === 'sound' && e.key === ' ') {
      e.preventDefault();
      stageAudio.togglePlay();
    }
  };

  return {
    updateList,
    showAsset,
    handleShortcut,
  };
};
