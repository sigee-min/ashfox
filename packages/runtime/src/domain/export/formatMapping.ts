import type { FormatKind } from '@ashfox/contracts/types/internal';
import type { NonGltfExportFormat, ResolvedExportFormat } from './types';

export const exportFormatToCapability = (format: ResolvedExportFormat): FormatKind | null => {
  switch (format) {
    case 'java_block_item_json':
      return 'Java Block/Item';
    case 'gecko_geo_anim':
      return 'geckolib';
    case 'animated_java':
      return 'animated_java';
    case 'generic_model_json':
      return 'Generic Model';
    case 'gltf':
    case 'native_codec':
    default:
      return null;
  }
};

export const mapFormatKindToDefaultExport = (formatKind: FormatKind): NonGltfExportFormat | null => {
  switch (formatKind) {
    case 'Java Block/Item':
      return 'java_block_item_json';
    case 'geckolib':
      return 'gecko_geo_anim';
    case 'animated_java':
      return 'animated_java';
    case 'Generic Model':
      return 'generic_model_json';
    default:
      return null;
  }
};

