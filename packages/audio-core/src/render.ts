import type { SoundRecipe } from './contract';
import { readRecipe } from './read';
import { createVoice } from './voice';
import { createChirp } from './chirp';
const TAU = Math.PI * 2;

export const measure = (pcm: Float64Array) => {
  let peak = 0, sum = 0, dc = 0;
  for (const value of pcm) {
    if (!Number.isFinite(value)) throw new Error('Non-finite PCM');
    peak = Math.max(peak, Math.abs(value)); sum += value * value; dc += value;
  }
  return { peak, rms: Math.sqrt(sum / pcm.length), dc: dc / pcm.length };
};
export const render = (input: SoundRecipe) => {
  const recipe = readRecipe(input);
  const rate = recipe.sampleRate;
  const result = new Float64Array(Math.round(recipe.duration * rate));
  for (const layer of [...recipe.layers].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const source = layer.source;
    let seed = recipe.seed;
    for (const char of recipe.id + '/' + layer.id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
    if (!seed) seed = 1;
    const noise = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000 * 2 - 1; };
    const voice = source.kind === 'vocal' ? createVoice(source, rate, noise) : null;
    const chirp = source.kind === 'chirp' ? createChirp(source, rate, layer.duration, noise) : null;
    let phase = 0, previous = 0, hp = 0, lp = 0;
    const hpA = Math.exp(-TAU * layer.highpass / rate);
    const lpA = 1 - Math.exp(-TAU * layer.lowpass / rate);
    const length = Math.round(layer.duration * rate), start = Math.round(layer.start * rate);
    for (let i = 0; i < length && start + i < result.length; i++) {
      const t = i / rate;
      let value;
      if (source.kind === 'fm') {
        const frequency = source.pitch[0] * Math.pow(source.pitch[1] / source.pitch[0], Math.min(1, t / source.sweepSeconds)) *
          Math.pow(2, Math.sin(TAU * source.vibratoHz * t) * source.vibratoCents / 1200);
        phase += TAU * frequency / rate;
        value = Math.sin(phase + source.index * Math.sin(phase * source.ratio));
      } else if (chirp) value = chirp(t);
      else if (voice) value = voice(t);
      else value = noise();
      hp = hpA * (hp + value - previous); previous = value;
      lp += lpA * (hp - lp);
      const edge = Math.min(1, t / layer.attack, (length - 1 - i) / rate / layer.release);
      const envelope = 0.5 - 0.5 * Math.cos(Math.PI * edge);
      result[start + i] += lp * envelope * layer.gain;
    }
  }
  measure(result);
  return result;
};

// Output policy belongs to this sound alone, never the comparison inventory.
export const master = (pcm: Float64Array, policy: SoundRecipe['output']) => {
  const stats = measure(pcm);
  if (stats.rms < 1e-8) throw new Error('sound.silent: silent output');
  const gain = Math.min(10 ** (policy.rmsDb / 20) / stats.rms, 10 ** (policy.peakDb / 20) / stats.peak);
  return Float64Array.from(pcm, (v) => v * gain);
};
