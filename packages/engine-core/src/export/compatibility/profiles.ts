import type { ExportFormatProfile } from '../adapter/contract';
import type { ExportAdapterInput } from '../adapter/input';
import { exportCompatibilityFor } from './queries';

export function exportProfileForAdapter(input: ExportAdapterInput): ExportFormatProfile | null {
  if (arguments.length !== 1)
    throw new TypeError('exportProfileForAdapter expects exactly one closed input.');
  switch (input.target) {
    case 'gltf':
    case 'glb': {
      const compatibility = exportCompatibilityFor(input.target);
      if (!compatibility) return null;
      return {
        ...compatibility.profile,
        modelPath: input.modelPath,
      };
    }
    case 'java_block': {
      const compatibility = exportCompatibilityFor('java_block');
      if (!compatibility) return null;
      return {
        ...compatibility.profile,
        namespace: input.namespace,
        modelPath: input.modelPath,
      };
    }
    case 'bedrock': {
      const compatibility = exportCompatibilityFor('bedrock');
      if (!compatibility) return null;
      return {
        ...compatibility.profile,
        namespace: input.namespace,
        modelPath: input.modelPath,
        animationPath: input.modelPath,
        geometryIdentifier: `geometry.${input.modelPath.split('/').join('.')}`,
      };
    }
    case 'geckolib5': {
      const compatibility = exportCompatibilityFor('geckolib5');
      if (!compatibility) return null;
      return {
        ...compatibility.profile,
        namespace: input.namespace,
        modelPath: input.modelPath,
        animationPath: input.modelPath,
        geometryIdentifier: `geometry.${input.modelPath.split('/').join('.')}`,
      };
    }
  }
}
