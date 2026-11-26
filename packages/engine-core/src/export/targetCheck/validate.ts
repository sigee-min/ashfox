import type { ExportAdaptedDocument } from '../adapter';
import { validateExportCompatibilityProfile } from '../compatibility/validate';
import type { FindingSink } from '../../validation/contract';
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
