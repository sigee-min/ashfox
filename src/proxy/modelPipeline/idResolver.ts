import { hashTextToHex } from '../../shared/hash';

const sanitizeId = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const resolveId = (
  kind: 'bone' | 'cube',
  specId: string | undefined,
  specName: string | undefined,
  parentId: string | null | undefined,
  index: number,
  policy: 'explicit' | 'stable_path' | 'hash'
): string => {
  if (specId) return specId;
  const label = specName ?? `${kind}_${index}`;
  if (policy === 'explicit') {
    return '';
  }
  const base = `${kind}:${parentId ?? 'root'}:${label}`;
  if (policy === 'hash') {
    return `${kind}_${hashTextToHex(base)}`;
  }
  const sanitized = sanitizeId(base);
  return sanitized ? sanitized : `${kind}_${hashTextToHex(base)}`;
};
