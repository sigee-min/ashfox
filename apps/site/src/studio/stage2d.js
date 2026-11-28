const normalizeNineSlice = (ns) => {
  if (!ns) return { top: 6, right: 6, bottom: 6, left: 6 };
  if (Array.isArray(ns)) {
    const [top = 6, right = top, bottom = top, left = right] = ns;
    return { top, right, bottom, left };
  }
  return {
    top: ns.top ?? 6,
    right: ns.right ?? 6,
    bottom: ns.bottom ?? 6,
    left: ns.left ?? 6,
  };
};

export const initStage2d = (root) => {
  const stage = root.querySelector('[data-stage-2d]');
  const canvasWrap = root.querySelector('[data-2d-canvas-wrap]');
  const spriteImg = root.querySelector('[data-inspector-sprite]');
  const tileGrid = root.querySelector('[data-inspector-tile]');
  const tileToggle = root.querySelector('[data-2d-tile-toggle]');
  const gridToggle = root.querySelector('[data-2d-grid]');
  const nineSliceStage = root.querySelector('[data-nineslice-stage]');
  const nineSliceBox = root.querySelector('[data-nineslice-box]');
  const nineSliceWidth = root.querySelector('[data-nineslice-width]');
  const nineSliceHeight = root.querySelector('[data-nineslice-height]');
  const nineSliceSize = root.querySelector('[data-nineslice-size]');
  const nineSliceInsets = root.querySelector('[data-nineslice-insets]');
  const nineSliceHandle = root.querySelector('[data-nineslice-handle]');
  const crosshairStage = root.querySelector('[data-crosshair-stage]');
  const crosshairPreview = root.querySelector('[data-crosshair-preview]');
  const crosshairImg = root.querySelector('[data-crosshair-img]');
  const backdropBtns = [...root.querySelectorAll('[data-2d-backdrop]')];
  const zoomBtns = [...root.querySelectorAll('[data-2d-zoom]')];
  const crosshairBtns = [...root.querySelectorAll('[data-crosshair-bg]')];

  let activeEntry = null;
  let zoom = 4;
  let showGrid = false;
  let showTile3x3 = true;
  let nsW = 224;
  let nsH = 144;

  const applyBackdrop = (preset) => {
    if (stage) stage.dataset.backdrop = preset;
    for (const btn of backdropBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset['2dBackdrop'] === preset));
    }
  };

  const applyZoom = (factor) => {
    zoom = factor;
    const baseW = activeEntry?.meta?.width || 32;
    const baseH = activeEntry?.meta?.height || 32;
    const pxW = baseW * zoom;
    const pxH = baseH * zoom;
    if (spriteImg) {
      spriteImg.style.width = `${pxW}px`;
      spriteImg.style.height = `${pxH}px`;
    }
    if (tileGrid) {
      tileGrid.style.width = `${Math.min(360, pxW * 3)}px`;
      tileGrid.style.height = `${Math.min(360, pxH * 3)}px`;
      const cell = Math.floor(Math.min(360, pxW * 3) / 3);
      tileGrid.style.backgroundSize = `${cell}px ${cell}px`;
    }
    if (canvasWrap) canvasWrap.style.setProperty('--pixel-size', `${zoom}px`);
    for (const btn of zoomBtns) {
      btn.setAttribute('aria-pressed', String(Number(btn.dataset['2dZoom']) === zoom));
    }
  };

  const applyNineSlice = () => {
    if (!nineSliceBox || !activeEntry) return;
    const ns = normalizeNineSlice(activeEntry.meta?.nineSlice);
    nineSliceBox.style.width = `${nsW}px`;
    nineSliceBox.style.height = `${nsH}px`;
    nineSliceBox.style.borderStyle = 'solid';
    nineSliceBox.style.borderColor = 'transparent';
    nineSliceBox.style.borderImageSource = `url("${activeEntry.outputHref}")`;
    nineSliceBox.style.borderImageSlice = `${ns.top} ${ns.right} ${ns.bottom} ${ns.left} fill`;
    nineSliceBox.style.borderImageWidth = `${ns.top * 2}px ${ns.right * 2}px ${ns.bottom * 2}px ${ns.left * 2}px`;
    nineSliceBox.style.borderImageRepeat = 'stretch';
    if (nineSliceWidth) nineSliceWidth.value = String(nsW);
    if (nineSliceHeight) nineSliceHeight.value = String(nsH);
    if (nineSliceSize) nineSliceSize.textContent = `${nsW} × ${nsH}px`;
    if (nineSliceInsets) {
      nineSliceInsets.textContent = `${ns.top}px / ${ns.right}px / ${ns.bottom}px / ${ns.left}px`;
    }
  };

  const applyCrosshairBg = (bg) => {
    if (crosshairPreview) crosshairPreview.dataset.crosshairTheme = bg;
    for (const btn of crosshairBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.crosshairBg === bg));
    }
  };

  for (const btn of backdropBtns) {
    btn.addEventListener('click', () => applyBackdrop(btn.dataset['2dBackdrop']));
  }
  for (const btn of zoomBtns) {
    btn.addEventListener('click', () => applyZoom(Number(btn.dataset['2dZoom'])));
  }
  for (const btn of crosshairBtns) {
    btn.addEventListener('click', () => applyCrosshairBg(btn.dataset.crosshairBg));
  }
  gridToggle?.addEventListener('click', () => {
    showGrid = !showGrid;
    gridToggle.setAttribute('aria-pressed', String(showGrid));
    canvasWrap?.classList.toggle('has-pixel-grid', showGrid);
  });
  tileToggle?.addEventListener('click', () => {
    showTile3x3 = !showTile3x3;
    tileToggle.setAttribute('aria-pressed', String(showTile3x3));
    if (spriteImg) spriteImg.hidden = showTile3x3;
    if (tileGrid) tileGrid.hidden = !showTile3x3;
  });
  nineSliceWidth?.addEventListener('input', (e) => {
    nsW = Number(e.target.value);
    applyNineSlice();
  });
  nineSliceHeight?.addEventListener('input', (e) => {
    nsH = Number(e.target.value);
    applyNineSlice();
  });

  if (nineSliceHandle) {
    nineSliceHandle.addEventListener('pointerdown', (startEvent) => {
      startEvent.preventDefault();
      const startX = startEvent.clientX;
      const startY = startEvent.clientY;
      const origW = nsW;
      const origH = nsH;
      const onMove = (moveEvent) => {
        nsW = Math.max(80, Math.min(400, Math.round(origW + (moveEvent.clientX - startX) * 2)));
        nsH = Math.max(64, Math.min(260, Math.round(origH + (moveEvent.clientY - startY) * 2)));
        applyNineSlice();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  applyBackdrop('checker');
  applyCrosshairBg('hud');

  const show = (entry, lang) => {
    activeEntry = entry;
    if (!stage) return;
    stage.hidden = false;
    const isTile = entry.domain === 'tile';
    const isNineSlice = entry.meta?.spriteProfile === 'ui_9slice';
    const isCrosshair = entry.meta?.spriteProfile === 'crosshair';
    const label = entry.name?.[lang] || entry.name?.en || entry.id;

    if (spriteImg) {
      spriteImg.src = entry.outputHref;
      spriteImg.alt = label;
    }
    if (tileGrid) {
      tileGrid.style.backgroundImage = `url("${entry.outputHref}")`;
    }
    if (crosshairImg) {
      crosshairImg.src = entry.outputHref;
      crosshairImg.alt = label;
    }

    if (tileToggle) {
      tileToggle.hidden = !isTile;
      showTile3x3 = isTile;
      tileToggle.setAttribute('aria-pressed', String(showTile3x3));
    }
    if (canvasWrap) canvasWrap.hidden = isNineSlice || isCrosshair;
    if (spriteImg) spriteImg.hidden = isTile || isNineSlice || isCrosshair;
    if (tileGrid) tileGrid.hidden = !isTile;
    if (nineSliceStage) nineSliceStage.hidden = !isNineSlice;
    if (crosshairStage) crosshairStage.hidden = !isCrosshair;

    if (isNineSlice) applyNineSlice();
    applyZoom(zoom);
  };

  const hide = () => {
    if (stage) stage.hidden = true;
  };

  return { show, hide };
};
