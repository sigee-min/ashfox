const formatClock = (seconds) => {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const fallbackPeaks = () =>
  Array.from({ length: 96 }, (_, i) => {
    const t = i / 95;
    return Number(
      (Math.sin(t * Math.PI) * (0.25 + 0.55 * Math.abs(Math.sin(i * 0.45)))).toFixed(3),
    );
  });

export const initStageAudio = (root, copy) => {
  const stage = root.querySelector('[data-stage-audio]');
  const audio = root.querySelector('[data-studio-audio]');
  const canvas = root.querySelector('[data-audio-canvas]');
  const playBtn = root.querySelector('[data-audio-play]');
  const loopBtn = root.querySelector('[data-audio-loop]');
  const timeEl = root.querySelector('[data-audio-time]');
  const variantGroup = root.querySelector('[data-audio-variants]');
  const baseBtn = root.querySelector('[data-audio-variant="base"]');
  const altBtn = root.querySelector('[data-audio-variant="alternate"]');
  const ctx = canvas?.getContext('2d') || null;

  let activeEntry = null;
  let variant = 'base';
  let looping = false;
  let rafId = 0;
  let pendingSeekRatio = null;

  const currentDuration = () => {
    if (audio && Number.isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return activeEntry?.meta?.durationSec || 0;
  };

  const currentProgress = () => {
    const dur = currentDuration();
    if (!dur || !audio) return 0;
    return Math.max(0, Math.min(1, audio.currentTime / dur));
  };

  const drawWaveform = () => {
    if (!canvas || !ctx || !activeEntry) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 560;
    const height = canvas.clientHeight || 160;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const peaks =
      Array.isArray(activeEntry.peaks) && activeEntry.peaks.length
        ? activeEntry.peaks
        : fallbackPeaks();
    const maxPeak = Math.max(...peaks, 0.01);
    const progress = currentProgress();
    const barSlot = width / peaks.length;
    const barW = Math.max(2, barSlot * 0.62);
    const midY = height / 2;

    for (let i = 0; i < peaks.length; i += 1) {
      const ratio = i / peaks.length;
      const barH = Math.max(4, (peaks[i] / maxPeak) * (height - 24));
      const x = i * barSlot + (barSlot - barW) * 0.5;
      ctx.fillStyle = ratio <= progress ? '#e69a43' : 'rgba(208, 214, 224, 0.26)';
      ctx.beginPath();
      ctx.roundRect(x, midY - barH / 2, barW, barH, Math.min(2, barW / 2));
      ctx.fill();
    }

    const headX = Math.max(1, Math.min(width - 1, progress * width));
    ctx.fillStyle = '#f7f8f8';
    ctx.fillRect(headX - 1, 8, 2, height - 16);
  };

  const updateTimeReadout = () => {
    if (!timeEl || !audio) return;
    const dur = currentDuration();
    if (dur > 0 && dur < 10) {
      const cur =
        Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : 0;
      timeEl.textContent = `${cur.toFixed(2)}s / ${dur.toFixed(2)}s`;
      return;
    }
    timeEl.textContent = `${formatClock(audio.currentTime)} / ${formatClock(dur)}`;
  };

  const syncPlayButton = () => {
    if (!playBtn || !audio) return;
    const playing = !audio.paused && !audio.ended;
    playBtn.textContent = playing
      ? `⏸ ${copy.motionPause || 'Pause'}`
      : `▶ ${copy.motionPlay || 'Play'}`;
    playBtn.setAttribute('aria-pressed', String(playing));
  };

  const stopLoopRaf = () => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const tick = () => {
    drawWaveform();
    updateTimeReadout();
    if (audio && !audio.paused && !audio.ended) {
      rafId = window.requestAnimationFrame(tick);
    } else {
      rafId = 0;
    }
  };

  const seekToRatio = (ratio) => {
    const clamped = Math.max(0, Math.min(1, ratio));
    const dur = currentDuration();
    if (!audio) return;
    if (audio.readyState >= 1 && dur > 0) {
      audio.currentTime = clamped * dur;
      pendingSeekRatio = null;
    } else {
      pendingSeekRatio = clamped;
    }
    drawWaveform();
    updateTimeReadout();
  };

  const setVariant = (nextVariant, autoplay = false) => {
    if (!activeEntry || !audio) return;
    variant = nextVariant === 'alternate' && activeEntry.alternateHref ? 'alternate' : 'base';
    audio.src = variant === 'alternate' ? activeEntry.alternateHref : activeEntry.outputHref;
    baseBtn?.setAttribute('aria-pressed', String(variant === 'base'));
    altBtn?.setAttribute('aria-pressed', String(variant === 'alternate'));
    drawWaveform();
    updateTimeReadout();
    if (autoplay) void audio.play().catch(() => {});
  };

  playBtn?.addEventListener('click', () => {
    if (!audio) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  });

  loopBtn?.addEventListener('click', () => {
    looping = !looping;
    if (audio) audio.loop = looping;
    loopBtn.setAttribute('aria-pressed', String(looping));
  });

  baseBtn?.addEventListener('click', () => setVariant('base', !audio?.paused));
  altBtn?.addEventListener('click', () => setVariant('alternate', !audio?.paused));

  canvas?.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    seekToRatio((e.clientX - rect.left) / rect.width);
  });

  audio?.addEventListener('loadedmetadata', () => {
    if (pendingSeekRatio !== null && audio.duration > 0) {
      audio.currentTime = pendingSeekRatio * audio.duration;
      pendingSeekRatio = null;
    }
    drawWaveform();
    updateTimeReadout();
  });
  audio?.addEventListener('play', () => {
    syncPlayButton();
    stopLoopRaf();
    rafId = window.requestAnimationFrame(tick);
  });
  audio?.addEventListener('pause', () => {
    syncPlayButton();
    stopLoopRaf();
    drawWaveform();
    updateTimeReadout();
  });
  audio?.addEventListener('ended', () => {
    syncPlayButton();
    stopLoopRaf();
    drawWaveform();
    updateTimeReadout();
  });
  audio?.addEventListener('timeupdate', () => {
    drawWaveform();
    updateTimeReadout();
  });

  const resizeObserver =
    typeof ResizeObserver !== 'undefined' && canvas
      ? new ResizeObserver(() => {
          if (stage && !stage.hidden) drawWaveform();
        })
      : null;
  if (canvas) resizeObserver?.observe(canvas);

  const show = (entry) => {
    activeEntry = entry;
    pendingSeekRatio = null;
    if (!stage || !audio) return;
    stage.hidden = false;
    audio.pause();
    looping = Boolean(entry.meta?.loop);
    audio.loop = looping;
    loopBtn?.setAttribute('aria-pressed', String(looping));
    if (variantGroup) variantGroup.hidden = !entry.alternateHref;
    setVariant('base', false);
    syncPlayButton();
    window.requestAnimationFrame(drawWaveform);
  };

  const hide = () => {
    stopLoopRaf();
    audio?.pause();
    if (stage) stage.hidden = true;
  };

  const togglePlay = () => {
    if (!audio || stage?.hidden) return;
    if (audio.paused) void audio.play().catch(() => {});
    else audio.pause();
  };

  return {
    show,
    hide,
    togglePlay,
    isActive: () => Boolean(stage && !stage.hidden),
  };
};
