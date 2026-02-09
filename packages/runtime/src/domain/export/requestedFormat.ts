import type { ExportPayload } from '@ashfox/contracts/types/internal';
import type { NativeCodecTarget } from '../../ports/exporter';
import type { SessionState } from '../../session';
import { resolveAutoFormatFromSnapshot, type MatchOverrideKind } from './snapshotResolution';
import type { ResolvedExportSelection } from './types';

export type ResolveRequestedExportResult =
  | { ok: true; value: ResolvedExportSelection }
  | { ok: false; reason: 'auto_unresolved' };

export const resolveRequestedExport = (
  payload: ExportPayload,
  snapshot: SessionState,
  options: {
    nativeCodecs: NativeCodecTarget[];
    matchOverrideKind: MatchOverrideKind;
  }
): ResolveRequestedExportResult => {
  if (payload.format !== 'auto') {
    if (payload.format === 'native_codec') {
      return { ok: true, value: { format: payload.format, codecId: payload.codecId } };
    }
    return { ok: true, value: { format: payload.format } };
  }

  const extension = extractPathExtension(payload.destPath);
  if (extension === 'gltf' || extension === 'glb') {
    return { ok: true, value: { format: 'gltf' } };
  }
  if (extension === 'json') {
    const fromProjectJson = resolveAutoFormatFromSnapshot(snapshot, options.matchOverrideKind);
    if (fromProjectJson) return { ok: true, value: { format: fromProjectJson } };
  }
  const codecId = resolveCodecIdFromPath(payload.destPath, options.nativeCodecs);
  if (codecId) {
    return { ok: true, value: { format: 'native_codec', codecId } };
  }
  const fromProject = resolveAutoFormatFromSnapshot(snapshot, options.matchOverrideKind);
  if (fromProject) return { ok: true, value: { format: fromProject } };
  return { ok: false, reason: 'auto_unresolved' };
};

export const resolveCodecIdFromPath = (
  destPath: string,
  nativeCodecs: NativeCodecTarget[]
): string | null => {
  const extension = extractPathExtension(destPath);
  if (!extension) return null;
  const match = nativeCodecs.find((codec) => {
    if (codec.id.toLowerCase() === extension) return true;
    return codec.extensions.some((value) => value.toLowerCase() === extension);
  });
  return match?.id ?? null;
};

export const extractPathExtension = (destPath: string): string | null => {
  const normalized = String(destPath ?? '').trim().toLowerCase();
  const index = normalized.lastIndexOf('.');
  if (index < 0 || index === normalized.length - 1) return null;
  return normalized.slice(index + 1);
};

