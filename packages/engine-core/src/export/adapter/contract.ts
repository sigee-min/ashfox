import type {
  ExportFormatProfile,
  Gltf2ExportProfile,
  MinecraftBedrockExportProfile,
  MinecraftJavaBlockExportProfile,
  MinecraftJavaGeckoLib5ExportProfile,
} from '../../model/exportFormat';

export type {
  ExportFormatProfile,
  Gltf2ExportProfile,
  MinecraftBedrockExportProfile,
  MinecraftJavaBlockExportProfile,
  MinecraftJavaGeckoLib5ExportProfile,
};

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
