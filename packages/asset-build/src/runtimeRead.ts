import { BuildFailure } from './contract';
import type { GameAssetManifest } from './runtime';
import { safeRelative } from './path';
/** Validate the generated runtime contract before consuming file references. */
export const readGameAssetManifest = (value: unknown): GameAssetManifest => {
  const fail = (message: string): never => { throw new BuildFailure('output.integrity', 'Game manifest: ' + message, 3); };
  const record = (v: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('Expected record');
    const r = v as Record<string, unknown>;
    if (Object.keys(r).length !== keys.length || keys.some(k => !Object.hasOwnProperty.call(r, k))) fail('Unexpected fields');
    return r;
  };
  const finite = (v: unknown, positive: boolean): boolean => typeof v === 'number' && Number.isFinite(v) && (positive ? v > 0 : v >= 0);
  const r = record(value, ['format','version','assets']);
  if (r.format !== 'ashfox-game-assets' || r.version !== 1 || !Array.isArray(r.assets) || !r.assets.length) return fail('Invalid format or assets');
  const ids = new Set<string>(), allPaths = new Set<string>();
  for (const raw of r.assets) {
    if (!raw || typeof raw !== 'object' || !('kind' in raw)) return fail('Invalid kind');
    const fields = raw.kind === 'model' ? ['model','coordinateSystem','unitsPerMeter','clips','requiredExtensions'] :
      raw.kind === 'sprite' ? ['image','width','height','pixelsPerUnit','filter'] :
        raw.kind === 'sound' ? ['codec','variants'] : fail('Unknown kind');
    const a = record(raw, ['id','kind','files', ...fields]);
    if (typeof a.id !== 'string' || !/^[a-z][a-z0-9_.:/-]{0,127}$/.test(a.id) || ids.has(a.id)) return fail('Invalid or duplicate ID');
    ids.add(a.id);
    if (!Array.isArray(a.files) || !a.files.length || a.files.length > 8192) return fail('Invalid files');
    const paths = new Set<string>();
    for (const rawFile of a.files) {
      const f = record(rawFile, ['path','sha256','byteLength']);
      if (typeof f.path !== 'string' || !safeRelative(f.path) || f.path === 'assets.json' || allPaths.has(f.path.toLowerCase()) ||
        typeof f.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(f.sha256) || !Number.isSafeInteger(f.byteLength) || (f.byteLength as number) < 0) return fail('Invalid file record');
      paths.add(f.path); allPaths.add(f.path.toLowerCase());
    }
    const referenced: string[] = [];
    const reference = (path: unknown, extension: string): void => {
      if (typeof path !== 'string' || !paths.has(path) || !path.endsWith(extension)) return fail('Missing typed file reference');
      referenced.push(path);
    };
    if (a.kind === 'model') {
      reference(a.model, '.glb');
      if (a.coordinateSystem !== 'gltf2' || !finite(a.unitsPerMeter, true) || !Array.isArray(a.clips)) return fail('Invalid model metadata');
      if (!Array.isArray(a.requiredExtensions) || a.requiredExtensions.some(e => typeof e !== 'string' || !e)) return fail('Invalid glTF extensions');
      for (const rawClip of a.clips) {
        const clip = record(rawClip, ['name','durationSeconds']);
        if (typeof clip.name !== 'string' || !clip.name || !finite(clip.durationSeconds, false)) return fail('Invalid animation clip');
      }
    } else if (a.kind === 'sprite') {
      reference(a.image, '.png');
      if (!Number.isSafeInteger(a.width) || !finite(a.width, true) || !Number.isSafeInteger(a.height) || !finite(a.height, true) ||
        !finite(a.pixelsPerUnit, true) || !['nearest','linear'].includes(String(a.filter))) return fail('Invalid sprite metadata');
    } else {
      if (!['wav','ogg'].includes(String(a.codec)) || !Array.isArray(a.variants) || !a.variants.length) return fail('Invalid audio metadata');
      const variants = new Set<string>();
      for (const rawVariant of a.variants) {
        const v = record(rawVariant, ['id','file','durationSeconds','sampleRate','channels']);
        if (typeof v.id !== 'string' || !v.id || variants.has(v.id) || !finite(v.durationSeconds, true) ||
          !Number.isSafeInteger(v.sampleRate) || !finite(v.sampleRate, true) || !Number.isSafeInteger(v.channels) || !finite(v.channels, true)) return fail('Invalid sound variant');
        variants.add(v.id); reference(v.file, '.' + a.codec);
      }
    }
    if (referenced.length !== paths.size || new Set(referenced).size !== paths.size) return fail('Incomplete file references');
  }
  return value as GameAssetManifest;
};
