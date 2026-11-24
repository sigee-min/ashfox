import type { ExportAdaptedDocument } from '../../export/adapter';
import { validateExportCompatibilityProfile } from '../../export/compatibility/validate';
import type { FindingSink } from '../contract';
import { validateAnimationExportCapabilities } from './animation';
import { validateGltfProfile } from './gltf';
import { validateJavaBlockProfile } from './block';
import { validateMinecraftActorProfile } from './actor';

export const validateFormatProfile = (document: ExportAdaptedDocument, add: FindingSink): void => {
  validateExportCompatibilityProfile(document).forEach(add);
  validateJavaBlockProfile(document, add);
  validateMinecraftActorProfile(document, add);
  validateGltfProfile(document, add);
  validateAnimationExportCapabilities(document, add);
};
