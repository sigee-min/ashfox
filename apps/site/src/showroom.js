const showroom = document.querySelector('[data-showroom]');
if (showroom) {
  const entries = JSON.parse(showroom.querySelector('[data-showroom-data]').textContent);
  const player = showroom.querySelector('[data-character-player]');
  const poster = showroom.querySelector('[data-character-poster]');
  const toggle = showroom.querySelector('[data-motion-toggle]');
  const status = showroom.querySelector('[data-motion-status]');
  const choices = [...showroom.querySelectorAll('[data-character]')];
  const count = String(entries.length).padStart(2, '0');
  const motionList = showroom.querySelector('[data-motion-list]');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let selected = entries[0];
  let motion = selected.motions[0];
  let wanted = !reduced.matches;
  let visible = false;
  let generation = 0;
  const readable = (name) => name.replaceAll('_', ' ').replace(/^./u, (letter) => letter.toUpperCase());
  const update = async () => {
    const request = ++generation;
    status.hidden = true;
    if (!wanted || !visible || document.hidden) {
      player.pause();
      toggle.textContent = 'Play motion';
      toggle.setAttribute('aria-pressed', 'false');
      return;
    }
    if (player.getAttribute('src') !== motion.src || player.error) {
      player.hidden = true;
      poster.hidden = false;
      player.src = motion.src;
      player.load();
    }
    try {
      await player.play();
      if (request !== generation) return;
      poster.hidden = true;
      player.hidden = false;
      toggle.textContent = 'Pause motion';
      toggle.setAttribute('aria-pressed', 'true');
    } catch {
      if (request !== generation) return;
      status.textContent = 'Preview paused. Select Play motion to try again.';
      status.hidden = false;
      player.hidden = true;
      poster.hidden = false;
      toggle.textContent = 'Play motion';
      toggle.setAttribute('aria-pressed', 'false');
    }
  };
  const build = createBuildReplay(showroom, () => { wanted = false; void update(); });
  build.select(selected);
  const revealStage = () => { if (!visible) showroom.querySelector('.character-stage').scrollIntoView({ block: 'center', behavior: reduced.matches ? 'instant' : 'smooth' }); };
  const showMotions = () => {
    motionList.replaceChildren(...selected.motions.map((clip) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = readable(clip.name);
      button.setAttribute('aria-pressed', String(clip === motion));
      button.addEventListener('click', () => {
        player.pause();
        motion = clip;
        wanted = true;
        revealStage();
        for (const sibling of motionList.children) sibling.setAttribute('aria-pressed', String(sibling === button));
        void update();
      });
      return button;
    }));
  };
  for (const button of choices) {
    button.addEventListener('click', () => {
      selected = entries[Number(button.dataset.character)];
      motion = selected.motions[0];
      ++generation;
      player.pause();
      player.removeAttribute('src');
      player.load();
      player.hidden = true;
      poster.src = selected.posterSrc;
      poster.alt = selected.label;
      poster.hidden = false;
      player.setAttribute('aria-label', `${selected.label} animated preview`);
      showroom.querySelector('[data-stage-word]').textContent = selected.entryName;
      showroom.querySelector('[data-character-name]').textContent = selected.label;
      showroom.querySelector('[data-character-summary]').textContent = selected.summary;
      showroom.querySelector('[data-character-position]').textContent = `${selected.index} / ${count}`;
      showroom.querySelector('[data-workspace-download]').href = selected.workspaceHref;
      showroom.querySelector('[data-glb-download]').href = selected.glbHref;
      for (const sibling of choices) sibling.setAttribute('aria-pressed', String(sibling === button));
      build.select(selected);
      showMotions();
      void update();
    });
  }
  toggle.addEventListener('click', () => { wanted = player.paused; if (wanted) revealStage(); void update(); });
  reduced.addEventListener('change', () => {
    wanted = !reduced.matches;
    if (reduced.matches) { player.hidden = true; poster.hidden = false; build.pause(); }
    void update();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) build.pause(); void update(); });
  window.addEventListener('pageshow', () => void update());
  window.addEventListener('pagehide', () => { ++generation; player.pause(); build.pause(); });
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; void update(); }, { threshold: 0.2 }).observe(showroom.querySelector('.character-stage'));
  player.addEventListener('error', () => {
    player.hidden = true;
    poster.hidden = false;
    wanted = false;
    void update();
    status.textContent = 'Preview unavailable. You can still download this character below.';
    status.hidden = false;
  });
  showMotions();
}
