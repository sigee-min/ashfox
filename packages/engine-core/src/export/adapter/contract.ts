import type { Vec3 } from '../../model';
import type { ExportCompatibilityEntry } from '../compatibility/registry';

type CompatibilityProfile<TTarget extends ExportCompatibilityEntry['target']> = Extract<
  ExportCompatibilityEntry,
  { target: TTarget }
>['profile'];

/**
 * Target-specific shape used only while an already-compiled project is
 * delivered to an external runtime. It is never persisted in a project.
 */
export type MinecraftJavaBlockExportProfile = CompatibilityProfile<'java_block'> &
  Readonly<{
    namespace: string;
    modelPath: string;
    parent?: string;
    ambientOcclusion?: boolean;
    guiLight?: 'front' | 'side';
  }>;

export type MinecraftBedrockExportProfile = CompatibilityProfile<'bedrock'> &
  Readonly<{
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

export type MinecraftJavaGeckoLib5ExportProfile = CompatibilityProfile<'geckolib5'> &
  Readonly<{
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

export type Gltf2ExportProfile = (CompatibilityProfile<'gltf'> | CompatibilityProfile<'glb'>) &
  Readonly<{
    modelPath: string;
    copyright?: string;
  }>;

export type ExportFormatProfile =
  | MinecraftJavaBlockExportProfile
  | MinecraftBedrockExportProfile
  | MinecraftJavaGeckoLib5ExportProfile
  | Gltf2ExportProfile;

/** A transient Minecraft resource binding derived immediately for delivery. */
export interface MinecraftTextureBinding {
  key: string;
  resource: MinecraftResourceLocation;
  extension: 'png';
  particle?: boolean;
}

export interface MinecraftResourceLocation {
  namespace: string;
  path: string;
}
