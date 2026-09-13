'use strict';
(() => {
  const players = new Set();
  const pauseAll = (except) => { for (const p of players) if (p !== except) p.audio.pause(); };
  window.addEventListener('pagehide', () => pauseAll());
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseAll(); });
  const create = ({ host, build, entry, label, loop, onError }) => {
    const audio = document.createElement('audio'); audio.preload = 'metadata'; audio.loop = entry.playback.kind === 'loop'; audio.src = `/builds/${build.id}/${entry.wav}`;
    const root = document.createElement('div'); root.className = 'audio-player';
    root.innerHTML = '<div class="wave-wrap"><canvas aria-hidden="true"></canvas><input type="range" min="0" value="0" step="0.001"></div><div class="transport"><button class="play-button" type="button"><span aria-hidden="true">▶</span><span class="play-text">Play</span></button><span class="transport-time"><strong>0.00</strong> / <span class="duration"></span></span><span class="transport-label">Original volume</span></div>';
    host.append(root); root.append(audio); audio.hidden = true;
    const canvas = root.querySelector('canvas'), ctx = canvas.getContext('2d'), seek = root.querySelector('input');
    const button = root.querySelector('button'), duration = entry.samples / entry.sampleRate;
    seek.max = String(duration); seek.setAttribute('aria-label', `${label} playback position`); button.setAttribute('aria-label', `Play ${label.toLowerCase()}`);
    root.querySelector('.duration').textContent = `${duration.toFixed(2)}s`;
    let peaks = [], disposed = false, raf;
    const controller = new AbortController();
    const draw = () => {
      if (disposed || !ctx) return;
      const box = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 2);
      if (canvas.width !== Math.round(box.width * dpr) || canvas.height !== Math.round(box.height * dpr)) { canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, box.width, box.height);
      const progress = audio.currentTime / duration;
      if (!peaks.length) { ctx.fillStyle = '#6d8271'; ctx.font = '11px system-ui'; ctx.fillText('Loading waveform…', 0, box.height / 2); return; }
      const maximum = Math.max(...peaks, .001), step = box.width / peaks.length;
      peaks.forEach((p, i) => { const h = Math.max(2, p / maximum * box.height * .78); ctx.fillStyle = i / peaks.length <= progress ? '#c4eabe' : '#59705d'; ctx.fillRect(i * step, (box.height - h) / 2, Math.max(1, step * .55), h); });
    };
    const update = () => { seek.value = String(audio.currentTime); seek.setAttribute('aria-valuetext', `${audio.currentTime.toFixed(2)}s / ${duration.toFixed(2)}s`); root.querySelector('.transport-time strong').textContent = audio.currentTime.toFixed(2); draw(); };
    const animate = () => { update(); if (!audio.paused && !disposed) raf = requestAnimationFrame(animate); };
    const player = { audio, dispose: () => { disposed = true; controller.abort(); audio.pause(); audio.removeAttribute('src'); audio.load(); cancelAnimationFrame(raf); observer.disconnect(); players.delete(player); root.remove(); } };
    players.add(player);
    button.onclick = async () => { try { if (audio.paused) { if (audio.ended) audio.currentTime = 0; await audio.play(); } else audio.pause(); } catch (e) { onError(e.message); } };
    audio.onplay = () => { pauseAll(player); button.querySelector('.play-text').textContent = 'Pause'; button.firstElementChild.textContent = 'Ⅱ'; button.setAttribute('aria-label', `Pause ${label.toLowerCase()}`); cancelAnimationFrame(raf); animate(); };
    audio.onpause = () => { cancelAnimationFrame(raf); button.querySelector('.play-text').textContent = 'Play'; button.firstElementChild.textContent = '▶'; button.setAttribute('aria-label', `Play ${label.toLowerCase()}`); update(); };
    audio.ontimeupdate = update;
    audio.onended = () => {
      if (loop() && !document.hidden && !disposed) { audio.currentTime = 0; audio.play().catch((e) => onError(e.message)); }
    };
    audio.onerror = () => { if (!disposed) { button.disabled = true; onError('Could not load audio. Refresh the results to try again.'); } };
    seek.oninput = () => { if (audio.readyState) { audio.currentTime = Number(seek.value); update(); } };
    const observer = new ResizeObserver(draw); observer.observe(canvas); draw();
    fetch(audio.src, { signal: controller.signal }).then((r) => { if (!r.ok) throw new Error('Could not load the waveform.'); return r.arrayBuffer(); }).then((buffer) => {
      const data = new DataView(buffer); let offset = 12, start = 0, count = 0;
      while (offset + 8 <= data.byteLength) { const size = data.getUint32(offset + 4, true); if (data.getUint32(offset, false) === 0x64617461) { start = offset + 8; count = size / 2; break; } offset += 8 + size + (size % 2); }
      if (!count || start + count * 2 > data.byteLength) throw new Error('Invalid waveform data.');
      peaks = Array.from({ length: 130 }, (_, bin) => { let peak = 0; for (let i = Math.floor(bin * count / 130); i < Math.floor((bin + 1) * count / 130); i++) peak = Math.max(peak, Math.abs(data.getInt16(start + i * 2, true)) / 32768); return peak; });
      draw();
    }).catch((e) => { if (!disposed) onError(e.message); });
    return player;
  };
  window.SoundPlayer = { create, pauseAll };
})();
