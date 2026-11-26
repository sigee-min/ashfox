import { resourceToken } from '../../resourceToken';
import {
  isExportModelPathValid,
  isExportNamespaceValid,
  type ExportPreset,
} from '../../model/exportFormat';

export { isExportModelPathValid, isExportNamespaceValid };

const isMinecraftExportPreset = (target: ExportPreset): boolean =>
  target === 'bedrock' || target === 'geckolib5' || target === 'java_block';

export const normalizeExportModelPath = (target: ExportPreset, value: string): string =>
  isMinecraftExportPreset(target)
    ? value
        .split('/')
        .map((segment) => resourceToken(segment, 'asset'))
        .join('/')
    : value;
