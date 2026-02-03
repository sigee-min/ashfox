import type { TexturePresetName } from '../shared/toolConstants';

export type PresetPalette = {
  base: string;
  dark: string;
  light: string;
  accent: string;
  accent2: string;
};

export const PRESET_PALETTES: Record<TexturePresetName, PresetPalette> = {
  painted_metal: { base: '#c6372e', dark: '#9f2c25', light: '#d94b3b', accent: '#b3352a', accent2: '#7d1f1a' },
  rubber: { base: '#2f2f2f', dark: '#1f1f1f', light: '#4a4a4a', accent: '#5c5c5c', accent2: '#101010' },
  glass: { base: '#4f86c6', dark: '#3a6ea8', light: '#6fb2e2', accent: '#8fd0f2', accent2: '#2d5e92' },
  wood: { base: '#b68654', dark: '#8f5f32', light: '#c99a64', accent: '#5a3b1f', accent2: '#d6aa70' },
  dirt: { base: '#4b2f1a', dark: '#3a2414', light: '#5a3a20', accent: '#2f1c10', accent2: '#6b4526' },
  plant: { base: '#3f8a3a', dark: '#2f6e2c', light: '#56a94e', accent: '#7acb64', accent2: '#1f5a1c' },
  stone: { base: '#7a7a7a', dark: '#5f5f5f', light: '#9a9a9a', accent: '#4c4c4c', accent2: '#b0b0b0' },
  sand: { base: '#d8c08a', dark: '#bfa46f', light: '#eed7a3', accent: '#c9b27d', accent2: '#f4e4be' },
  leather: { base: '#7b4b2a', dark: '#5c3620', light: '#9b6a3c', accent: '#4a2d1a', accent2: '#b58354' },
  fabric: { base: '#7b7f8a', dark: '#5f626c', light: '#a0a5b0', accent: '#9096a3', accent2: '#4f525b' },
  ceramic: { base: '#d7d7d1', dark: '#b8b8b1', light: '#f0f0ea', accent: '#c6c6bf', accent2: '#ffffff' }
};
