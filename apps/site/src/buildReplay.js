const createBuildReplay = (root, onOpen) => {
  const dialog = root.querySelector('[data-build-dialog]');
  const player = dialog.querySelector('[data-build-player]');
  const opener = root.querySelector('[data-build-open]');
  const status = dialog.querySelector('[data-build-status]');
  let selected;
  let generation = 0;
  const release = () => {
    ++generation;
    player.pause();
    player.removeAttribute('src');
    player.load();
    document.documentElement.classList.remove('build-viewer-open');
  };
  opener.addEventListener('click', async () => {
    onOpen();
    const request = ++generation;
    status.hidden = true;
    player.poster = selected.posterSrc;
    player.src = selected.replayVideoSrc;
    player.setAttribute('aria-label', `${selected.label} construction preview`);
    dialog.showModal();
    document.documentElement.classList.add('build-viewer-open');
    try { await player.play(); } catch {
      if (request !== generation || !dialog.open) return;
      status.textContent = 'Press play to start the preview.';
      status.hidden = false;
    }
  });
  dialog.querySelector('[data-build-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  dialog.addEventListener('close', () => { release(); opener.focus({ preventScroll: true }); });
  player.addEventListener('playing', () => { status.hidden = true; });
  player.addEventListener('error', () => {
    if (!dialog.open) return;
    status.textContent = 'The preview could not load. Close it and try again.';
    status.hidden = false;
  });
  return {
    pause: () => player.pause(),
    select: (entry) => {
      if (dialog.open) dialog.close();
      selected = entry;
      root.querySelector('[data-build-thumbnail]').src = entry.posterSrc;
      dialog.querySelector('[data-build-title]').textContent = entry.label;
      opener.setAttribute('aria-label', `Watch ${entry.label} take shape`);
    }
  };
};
