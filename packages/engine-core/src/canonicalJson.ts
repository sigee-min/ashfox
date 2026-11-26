const SAFE_ASCII_KEY = /^[\x20\x21\x23-\x5b\x5d-\x7e]+$/;
const KEY_CACHE = new Map<string, string>();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const formatJsonKey = (key: string): string => {
  let cached = KEY_CACHE.get(key);
  if (cached !== undefined) return cached;
  cached = SAFE_ASCII_KEY.test(key) ? `"${key}":` : `${JSON.stringify(key)}:`;
  if (KEY_CACHE.size < 512) KEY_CACHE.set(key, cached);
  return cached;
};

const isSimplePrimitiveArray = (items: readonly unknown[]): boolean => {
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const t = typeof item;
    if (item !== null && t !== 'number' && t !== 'string' && t !== 'boolean') return false;
  }
  return true;
};

const canonicalArrayString = (items: readonly unknown[]): string => {
  if (items.length === 0) return '[]';
  if (items.length <= 16 && isSimplePrimitiveArray(items)) return JSON.stringify(items);
  let out = '[';
  for (let index = 0; index < items.length; index += 1) {
    if (index > 0) out += ',';
    out += canonicalJsonString(items[index]);
  }
  return out + ']';
};

const canonicalRecordString = (record: Readonly<Record<string, unknown>>): string => {
  const keys = Object.keys(record);
  const len = keys.length;
  if (len === 0) return '{}';
  if (len === 2) {
    if (keys[0]! > keys[1]!) {
      const tmp = keys[0]!;
      keys[0] = keys[1]!;
      keys[1] = tmp;
    }
  } else if (len > 2) {
    keys.sort();
  }
  let out = '{';
  for (let index = 0; index < len; index += 1) {
    const key = keys[index]!;
    if (index > 0) out += ',';
    out += formatJsonKey(key) + canonicalJsonString(record[key]);
  }
  return out + '}';
};

const canonicalPrimitive = (value: unknown): string => {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null) return 'null';
  return JSON.stringify(value) ?? 'undefined';
};

export const canonicalJsonString = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return canonicalPrimitive(value);
  if (Array.isArray(value)) return canonicalArrayString(value);
  return isRecord(value) ? canonicalRecordString(value) : (JSON.stringify(value) ?? 'undefined');
};
