import { resourceToken } from '../../resourceToken';
import type { ExportPreset } from './contract';

const MINECRAFT_NAMESPACE = /^[a-z0-9_.-]+$/;
const MINECRAFT_MODEL_PATH = /^[a-z0-9_./-]+$/;
const GLTF_MODEL_PATH = /^[A-Za-z0-9_./-]+$/;

const isMinecraftExportPreset = (target: ExportPreset): boolean =>
  target === 'bedrock' || target === 'geckolib5' || target === 'java_block';

export const isExportNamespaceValid = (target: ExportPreset, value: string): boolean =>
  !isMinecraftExportPreset(target) || MINECRAFT_NAMESPACE.test(value);

export const isExportModelPathValid = (target: ExportPreset, value: string): boolean => {
  const pattern = target === 'gltf' || target === 'glb' ? GLTF_MODEL_PATH : MINECRAFT_MODEL_PATH;
  return (
    pattern.test(value) &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.includes('..') &&
    (target === 'gltf' || target === 'glb'
      ? !/\.(?:gltf|glb|bin)$/i.test(value)
      : !value.endsWith('.json'))
  );
};

export const normalizeExportModelPath = (target: ExportPreset, value: string): string =>
  isMinecraftExportPreset(target)
    ? value
        .split('/')
        .map((segment) => resourceToken(segment, 'asset'))
        .join('/')
    : value;
