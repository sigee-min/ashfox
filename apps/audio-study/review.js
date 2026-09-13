'use strict';
const $ = (id) => document.getElementById(id);
const names = {
  griffin_call: ['Griffin call', 'CREATURE · VOICE', 'A deep creature call layered with a rough, breathy texture.', '◈'],
  wolf_howl: ['Wolf howl', 'ANIMAL · VOICE', 'A sustained howl shaped by pitch and resonance.', '◇'],
  bird_call: ['Bird call', 'ANIMAL · VOICE', 'Two phrases of curved whistles, answering notes and delicate trills.', '⌁'],
  frog_croak: ['Frog croak', 'ANIMAL · VOICE', 'A low, throaty call with an uneven pulse.', '≋'],
  wing_whoosh: ['Wing whoosh', 'MOVEMENT · EFFECT', 'A soft rush of air following a sweeping wingbeat.', '⌁'],
  claw_hit: ['Claw impact', 'IMPACT · EFFECT', 'A sharp strike with a short, low resonance.', '↯']
};
const info = (sound) => names[sound] || [sound.replaceAll('_', ' '), 'SOUND', 'Listen to a sound created entirely from code.', '◈'];
let state, current, baseline, selectedSound, selectedVariant, players = [], requestGeneration = 0;
const option = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; return o; };
const buildName = (b) => `${state.head?.build === b.id ? 'Current result' : 'Saved result'} · ${state.builds.length - state.builds.indexOf(b)}`;
const dispose = () => { players.forEach((p) => p.dispose()); players = []; };
const entryFor = (b) => b?.entries.find((e) => e.sound === selectedSound && e.variant === selectedVariant);
const makePlayer = (host, b, label) => {
  const entry = entryFor(b); if (!entry) { $(host).textContent = 'This sound variation is not available in that result.'; return; }
  players.push(window.SoundPlayer.create({ host: $(host), build: b, entry, label, loop: () => $('loop').checked,
    onError: (message) => { $('status').textContent = message; } }));
};
const drawPlayers = () => {
  dispose(); $('primary-player').replaceChildren(); $('baseline-player').replaceChildren();
  makePlayer('primary-player', current, 'Selected sound');
  baseline = $('compare-toggle').getAttribute('aria-expanded') === 'true' ? state.builds.find((b) => b.id === $('baseline').value) : null;
  $('comparison').hidden = !baseline;
  if (baseline) makePlayer('baseline-player', baseline, 'Previous result');
  $('same-output').textContent = baseline && entryFor(baseline)?.wavHash === entryFor(current)?.wavHash ? 'This variation sounds identical in both results.' : 'Switch between the same variation in each result.';
};
const variantsFor = (sound) => current.entries.filter((e) => e.sound === sound).sort((a, b) => Number(b.variant === 'base') - Number(a.variant === 'base') || a.variant.localeCompare(b.variant));
const selectVariant = (variant) => {
  selectedVariant = variant;
  for (const button of $('variants').children) button.setAttribute('aria-pressed', String(button.dataset.id === variant));
  const entries = variantsFor(selectedSound), index = entries.findIndex((e) => e.variant === variant);
  $('variant-help').textContent = entries.length > 1 ? `${index === 0 ? 'Original sound' : 'A variation of the same sound'} · Seeds vary authored ranges and stochastic voice details.` : 'One variation is available for this sound.';
  const entry = entryFor(current);
  $('sound-meta').textContent = `${(entry.samples / entry.sampleRate).toFixed(2)}s · Mono · ${entry.playback.kind}`;
  for (const type of ['wav', 'ogg']) {
    const link = $('download-' + type); link.hidden = !entry[type];
    if (entry[type]) link.href = `/builds/${current.id}/${entry[type]}`; else link.removeAttribute('href');
    link.onclick = () => window.SoundPlayer.pauseAll();
  }
  $('status').textContent = '';
  drawPlayers();
};
const selectSound = (sound) => {
  selectedSound = sound;
  const [title, category, description] = info(sound);
  $('title').textContent = title; $('category').textContent = category; $('description').textContent = description;
  for (const b of $('library').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.sound === sound));
  const entries = variantsFor(sound);
  $('variants').replaceChildren(...entries.map((e, i) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.id = e.variant; b.textContent = i === 0 ? 'Original' : `Variation ${i}`; b.setAttribute('aria-pressed', 'false'); b.onclick = () => selectVariant(e.variant); return b; }));
  selectVariant(entries.some((e) => e.variant === selectedVariant) ? selectedVariant : entries[0].variant);
};
const drawLibrary = () => {
  const sounds = [...new Set(current.entries.map((e) => e.sound))].sort((a, b) => Object.keys(names).indexOf(a) - Object.keys(names).indexOf(b));
  $('count').textContent = String(sounds.length); $('library').replaceChildren();
  for (const sound of sounds) {
    const [name, category, , symbol] = info(sound), entry = current.entries.find((e) => e.sound === sound);
    const button = document.createElement('button'); button.className = 'sound-item'; button.dataset.sound = sound;
    const icon = document.createElement('span'); icon.className = 'sound-symbol'; icon.textContent = symbol; icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span'); copy.className = 'sound-copy'; const title = document.createElement('strong'); title.textContent = name; const subtitle = document.createElement('small'); subtitle.textContent = category; copy.append(title, subtitle);
    const length = document.createElement('span'); length.className = 'sound-length'; length.textContent = `${(entry.samples / entry.sampleRate).toFixed(1)}s`;
    button.append(icon, copy, length); button.onclick = () => selectSound(sound); $('library').append(button);
  }
  selectSound(sounds.includes(selectedSound) ? selectedSound : sounds.includes('griffin_call') ? 'griffin_call' : sounds[0]);
};
const chooseBuild = () => {
  current = state.builds.find((b) => b.id === $('build').value);
  $('studio').hidden = !current; $('empty').hidden = Boolean(current);
  if (!current) { dispose(); $('library').replaceChildren(); $('count').textContent = '0'; return; }
  $('adopted').textContent = current.id === state.head?.build ? 'Current result' : 'Saved result';
  const previous = $('baseline').value, alternatives = state.builds.filter((b) => b.id !== current.id);
  $('baseline').replaceChildren(...alternatives.map((b) => option(b.id, buildName(b))));
  if (alternatives.some((b) => b.id === previous)) $('baseline').value = previous;
  else if (alternatives.some((b) => b.id === state.head?.build)) $('baseline').value = state.head.build;
  $('compare-toggle').disabled = !alternatives.length; $('compare-hint').textContent = alternatives.length ? '' : 'Comparison becomes available when another result is built.';
  if (!alternatives.length) $('compare-toggle').setAttribute('aria-expanded', 'false');
  drawLibrary();
};
const load = async () => {
  const generation = ++requestGeneration; $('refresh').disabled = true;
  try {
    const response = await fetch('/catalog'); if (!response.ok) throw new Error('Could not load results. Please try again.');
    const next = await response.json(); if (generation !== requestGeneration) return;
    state = next; const previous = $('build').value;
    $('build').replaceChildren(...state.builds.map((b) => option(b.id, buildName(b))));
    if (state.builds.some((b) => b.id === previous)) $('build').value = previous;
    chooseBuild(); $('status').textContent = '';
  } catch (e) { $('status').textContent = e.message; } finally { if (generation === requestGeneration) $('refresh').disabled = false; }
};
$('build').onchange = chooseBuild; $('baseline').onchange = drawPlayers; $('refresh').onclick = load;
$('compare-toggle').onclick = () => { const expanded = $('compare-toggle').getAttribute('aria-expanded') !== 'true'; $('compare-toggle').setAttribute('aria-expanded', String(expanded)); $('compare-toggle').firstChild.textContent = expanded ? 'Close comparison ' : 'Compare results '; $('compare-toggle').lastElementChild.textContent = expanded ? '−' : '＋'; drawPlayers(); };
load();
