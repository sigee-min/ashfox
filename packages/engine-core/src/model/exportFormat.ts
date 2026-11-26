import type { Vec3 } from './identity';

export type ExportPreset = 'geckolib5' | 'java_block' | 'bedrock' | 'glb' | 'gltf';

export const EXPORT_PRESETS: readonly ExportPreset[] = Object.freeze([
  'geckolib5',
  'java_block',
  'bedrock',
  'glb',
  'gltf',
]);

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

/**
 * Target-specific shape used only while an already-compiled project is
 * delivered to an external runtime. It is never persisted in a project.
 */
export type MinecraftJavaBlockExportProfile = Readonly<{
  id: 'minecraft.java_block';
  minecraftVersion: '26.2';
  resourcePackFormat: 88;
  modelKind: 'block';
  namespace: string;
  modelPath: string;
  parent?: string;
  ambientOcclusion?: boolean;
  guiLight?: 'front' | 'side';
}>;

export type MinecraftBedrockExportProfile = Readonly<{
  id: 'minecraft.bedrock';
  minecraftVersion: '26.45';
  geometryFormatVersion: '1.21.0';
  animationFormatVersion: '1.8.0';
  geometryKind: 'entity';
  namespace: string;
  modelPath: string;
  animationPath: string;
  geometryIdentifier: string;
  visibleBounds?: {
    width: number;
    height: number;
    offset: Vec3;
  };
}>;

export type MinecraftJavaGeckoLib5ExportProfile = Readonly<{
  id: 'minecraft.java.geckolib5';
  minecraftVersion: '26.2';
  geometryFormatVersion: '1.12.0';
  animationFormatVersion: '1.8.0';
  assetKind: 'entity';
  namespace: string;
  modelPath: string;
  animationPath: string;
  geometryIdentifier: string;
  visibleBounds?: {
    width: number;
    height: number;
    offset: Vec3;
  };
}>;

export type Gltf2ExportProfile = Readonly<{
  id: 'gltf.2';
  version: '2.0';
  container: 'gltf' | 'glb';
  imageStorage: 'external' | 'embedded';
  modelPath: string;
  copyright?: string;
}>;

export type ExportFormatProfile =
  | MinecraftJavaBlockExportProfile
  | MinecraftBedrockExportProfile
  | MinecraftJavaGeckoLib5ExportProfile
  | Gltf2ExportProfile;
