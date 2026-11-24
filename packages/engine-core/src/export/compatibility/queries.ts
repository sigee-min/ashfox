import {
  registeredExportCompatibilityEntries,
  registeredExportCompatibilityFor,
  type ExportCompatibilityEntry,
} from './registry';
import type { ExportCompatibilityOption, ExportPreset } from './contract';
import { exportTargetDescriptorForPreset } from './target';

const compatibilityEntries = registeredExportCompatibilityEntries();

export const EXPORT_PRESETS = Object.freeze([
  ...new Set(compatibilityEntries.map(({ target }) => target)),
]) as readonly ExportPreset[];

export function exportCompatibilityOptions(
  target?: ExportPreset,
): readonly ExportCompatibilityOption[] {
  if (arguments.length > 1)
    throw new TypeError('exportCompatibilityOptions accepts at most one target.');
  if (target !== undefined && !EXPORT_PRESETS.includes(target))
    throw new TypeError('exportCompatibilityOptions received an unknown target.');
  return Object.freeze(
    compatibilityEntries
      .filter((entry) => target === undefined || entry.target === target)
      .map((entry) => {
        const descriptor = exportTargetDescriptorForPreset(entry.target);
        return Object.freeze({
          target: entry.target,
          label: entry.label,
          targetVersion: descriptor.target.version,
          namespaceRequired: descriptor.namespaceRequired,
          animationSupport: entry.animationSupport,
        });
      }),
  );
}

export function exportCompatibilityFor<TTarget extends ExportPreset>(
  target: TTarget,
): Extract<ExportCompatibilityEntry, { target: TTarget }> | null {
  if (arguments.length !== 1)
    throw new TypeError('exportCompatibilityFor expects exactly one target.');
  return registeredExportCompatibilityFor(target);
}
