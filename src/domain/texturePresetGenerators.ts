import type { TexturePresetName, TexturePresetSpec } from './texturePresetTypes';
import { generatePaintedMetal } from './texturePresets/paintedMetal';
import { generateRubber } from './texturePresets/rubber';
import { generateGlass } from './texturePresets/glass';
import { generateWood } from './texturePresets/wood';
import { generateDirt } from './texturePresets/dirt';
import { generatePlant } from './texturePresets/plant';
import { generateStone } from './texturePresets/stone';
import { generateSand } from './texturePresets/sand';
import { generateLeather } from './texturePresets/leather';
import { generateFabric } from './texturePresets/fabric';
import { generateCeramic } from './texturePresets/ceramic';

export const PRESET_GENERATORS: Record<TexturePresetName, (spec: TexturePresetSpec, data: Uint8ClampedArray) => void> = {
  painted_metal: generatePaintedMetal,
  rubber: generateRubber,
  glass: generateGlass,
  wood: generateWood,
  dirt: generateDirt,
  plant: generatePlant,
  stone: generateStone,
  sand: generateSand,
  leather: generateLeather,
  fabric: generateFabric,
  ceramic: generateCeramic
};
