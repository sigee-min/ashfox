import { sha256ByteDigest } from '@ashfox/engine-core';
import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
export const digest = (value: string | Uint8Array): string =>
  sha256ByteDigest(typeof value === 'string' ? encodeUtf8(value) : value).slice(7);
export const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => compareText(a, b))
            .map(([k, v]) => [k, stable(v)]),
        )
      : value;
export const json = (value: unknown): string => JSON.stringify(stable(value)) + '\n';
