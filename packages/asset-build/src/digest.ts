import { sha256ByteDigest } from '@ashfox/engine-core';
export const digest = (value: string | Uint8Array): string => sha256ByteDigest(typeof value === 'string' ? new TextEncoder().encode(value) : value).slice(7);
export const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : value;
export const json = (value: unknown): string => JSON.stringify(stable(value)) + '\n';
