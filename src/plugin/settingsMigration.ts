import type { ReadGlobals } from './types';

export const cleanupLegacySettings = (deps: { readGlobals: ReadGlobals }) => {
  const globals = deps.readGlobals();
  const settings = globals.settings;
  if (!settings || typeof settings !== 'object') return;
  const versionKey = 'greyfox_settings_version';
  const versionEntry = settings[versionKey];
  const currentVersion = typeof versionEntry?.value === 'number' ? Number(versionEntry.value) : 0;
  if (currentVersion >= 1) return;
  const keep = new Set(['greyfox_host', 'greyfox_port', 'greyfox_path']);
  for (const key of Object.keys(settings)) {
    if (key.startsWith('greyfox_') && !keep.has(key)) {
      try {
        delete settings[key];
      } catch (_err) {
        // ignore
      }
    }
  }
  if (versionEntry?.set) {
    versionEntry.set(1);
  } else {
    settings[versionKey] = { value: 1 };
  }
};

