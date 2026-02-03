import type { TexturePresetName } from '../shared/toolConstants';

export type MaterialPreset = {
  preset: TexturePresetName;
  palette?: string[];
  match: 'exact' | 'fallback' | 'default';
};

type MaterialPresetDefinition = {
  preset: TexturePresetName;
  palette?: string[];
};

const MATERIAL_PRESET_MAP: Record<string, MaterialPresetDefinition> = {
  painted_metal: { preset: 'painted_metal' },
  metal: { preset: 'painted_metal' },
  steel: { preset: 'painted_metal' },
  iron: { preset: 'painted_metal' },
  aluminum: { preset: 'painted_metal' },
  aluminium: { preset: 'painted_metal' },
  chrome: { preset: 'painted_metal' },
  rust: { preset: 'painted_metal' },
  rusty: { preset: 'painted_metal' },
  rubber: { preset: 'rubber' },
  tire: { preset: 'rubber' },
  tyre: { preset: 'rubber' },
  glass: { preset: 'glass' },
  wood: { preset: 'wood' },
  timber: { preset: 'wood' },
  plank: { preset: 'wood' },
  dirt: { preset: 'dirt' },
  soil: { preset: 'dirt' },
  mud: { preset: 'dirt' },
  plant: { preset: 'plant' },
  leaf: { preset: 'plant' },
  foliage: { preset: 'plant' },
  stone: { preset: 'stone' },
  rock: { preset: 'stone' },
  sand: { preset: 'sand' },
  leather: { preset: 'leather' },
  fabric: { preset: 'fabric' },
  cloth: { preset: 'fabric' },
  ceramic: { preset: 'ceramic' },
  clay: { preset: 'ceramic' },
  terracotta: { preset: 'ceramic' },
  pottery: { preset: 'ceramic' },
  earthenware: { preset: 'ceramic' }
};

const MATERIAL_FALLBACKS: Array<{ match: (material: string) => boolean; preset: TexturePresetName }> = [
  { match: (value) => value.includes('metal') || value.includes('steel') || value.includes('iron'), preset: 'painted_metal' },
  { match: (value) => value.includes('rubber') || value.includes('tire') || value.includes('tyre'), preset: 'rubber' },
  { match: (value) => value.includes('glass'), preset: 'glass' },
  { match: (value) => value.includes('wood') || value.includes('plank') || value.includes('timber'), preset: 'wood' },
  { match: (value) => value.includes('dirt') || value.includes('soil') || value.includes('mud'), preset: 'dirt' },
  { match: (value) => value.includes('plant') || value.includes('leaf') || value.includes('foliage'), preset: 'plant' },
  { match: (value) => value.includes('stone') || value.includes('rock'), preset: 'stone' },
  { match: (value) => value.includes('sand'), preset: 'sand' },
  { match: (value) => value.includes('leather'), preset: 'leather' },
  { match: (value) => value.includes('fabric') || value.includes('cloth'), preset: 'fabric' },
  { match: (value) => value.includes('ceramic') || value.includes('tile') || value.includes('clay'), preset: 'ceramic' }
];

const normalizeMaterial = (material: string): string =>
  material.trim().toLowerCase().replace(/[\s-]+/g, '_');

export const resolveMaterialPreset = (material: string): MaterialPreset => {
  const normalized = normalizeMaterial(material);
  const exact = MATERIAL_PRESET_MAP[normalized];
  if (exact) return { ...exact, match: 'exact' };
  for (const fallback of MATERIAL_FALLBACKS) {
    if (fallback.match(normalized)) {
      return { preset: fallback.preset, match: 'fallback' };
    }
  }
  return { preset: 'painted_metal', match: 'default' };
};


