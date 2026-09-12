const landing = document.querySelector('.world-landing');
if (landing) {
  const items = { sword: ['/media/landing/sword.png', siteCopy.swordAlt], amethyst: ['/media/landing/amethyst.png', siteCopy.amethystAlt] };
  for (const button of landing.querySelectorAll('[data-item]')) button.onclick = () => {
    const [src, alt] = items[button.dataset.item];
    const image = landing.querySelector('[data-item-image]'); image.src = src; image.alt = alt; landingMotion.change(image);
    landing.querySelector('[data-item-download]').href = src;
    for (const sibling of landing.querySelectorAll('[data-item]')) sibling.setAttribute('aria-pressed', String(sibling === button));
  };
  const native = landing.querySelector('[data-native-size]');
  native.onclick = () => { const enabled = native.getAttribute('aria-pressed') !== 'true'; native.setAttribute('aria-pressed', String(enabled)); landing.querySelector('.item-art').classList.toggle('native', enabled); };
  const audio = landing.querySelector('[data-landing-audio]');
  const play = landing.querySelector('[data-sound-play]');
  const status = landing.querySelector('[data-sound-status]');
  const reset = () => { landing.querySelector('.sound-player').classList.remove('is-playing'); play.textContent = '▶'; play.setAttribute('aria-label', siteCopy.playSound); };
  play.onclick = async () => {
    if (!audio.paused) { audio.pause(); return; }
    try { await audio.play(); status.textContent = siteCopy.playingSound; } catch { status.textContent = siteCopy.soundPlayFailed; }
  };
  audio.addEventListener('play', () => { landing.querySelector('.sound-player').classList.add('is-playing'); play.textContent = 'Ⅱ'; play.setAttribute('aria-label', siteCopy.pauseSound); });
  audio.addEventListener('pause', reset);
  audio.addEventListener('ended', () => { reset(); status.textContent = siteCopy.soundEnded; });
  audio.addEventListener('error', () => { reset(); status.textContent = siteCopy.soundLoadFailed; });
  audio.addEventListener('timeupdate', () => { landing.querySelector('[data-sound-progress]').style.width = `${Number.isFinite(audio.duration) ? audio.currentTime / audio.duration * 100 : 0}%`; });
  let soundVariant = 'base';
  landing.querySelector('[data-sound-another]').onclick = async () => {
    soundVariant = soundVariant === 'base' ? 'alternate' : 'base';
    audio.pause();
    landing.querySelector('[data-sound-wave]').src = `/media/landing/claw-${soundVariant}.svg`;
    audio.src = `/media/landing/claw-${soundVariant}.wav`;
    landing.querySelector('[data-sound-download]').href = audio.src;
    landing.querySelector('[data-sound-progress]').style.width = '0%';
    try { await audio.play(); status.textContent = siteCopy.soundVariation; }
    catch { status.textContent = siteCopy.soundTry; }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); });
  new IntersectionObserver(entries => { if (!entries[0].isIntersecting) audio.pause(); }).observe(landing.querySelector('.world-sound'));
  const paths = { model: '/examples/griffin/workbench/main.ashfox', item: '/examples/items/src/iron_sword.ashfox', sound: '/examples/sounds/src/claw_hit.ashfox' };
  const modelPreview = landing.querySelector('[data-source-preview]').getAttribute('src');
  let revision = 0;
  const source = async key => {
    const preview = landing.querySelector('[data-source-preview]');
    const previews = { model: [modelPreview, siteCopy.modelAlt], item: ['/media/landing/sword.png', siteCopy.generatedSword], sound: ['/media/landing/claw-base.svg', siteCopy.generatedWave] };
    [preview.src, preview.alt] = previews[key]; landingMotion.change(preview);
    const current = ++revision, code = landing.querySelector('[data-source-code]'); code.textContent = siteCopy.loadingSource;
    landing.querySelector('[data-source-link]').href = paths[key];
    for (const button of landing.querySelectorAll('[data-source]')) button.setAttribute('aria-pressed', String(button.dataset.source === key));
    try { const response = await fetch(paths[key]); if (!response.ok) throw Error(); const text = await response.text(); if (revision === current) code.textContent = text.split('\n').slice(0, 16).join('\n'); }
    catch { if (revision === current) code.textContent = siteCopy.sourceFailed; }
  };
  for (const button of landing.querySelectorAll('[data-source]')) button.onclick = () => void source(button.dataset.source);
  void source('model');
}
