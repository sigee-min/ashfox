'use strict';

/** Current-only serialized schema authorities. Historical internal registries,
 * generic version lookup, and unused routing versions are deliberately absent. */
const PROJECT_DOCUMENT_SCHEMA_VERSION = 1;
const EXPORT_BUNDLE_SCHEMA_VERSION = 1;
const SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION = 2;

const isClosedContractRecord = (value) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    if ('toJSON' in value) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        descriptor !== undefined &&
        descriptor.enumerable === true &&
        Object.prototype.hasOwnProperty.call(descriptor, 'value')
      );
    });
  } catch (_error) {
    return false;
  }
};

const isDenseContractArray = (value) => {
  if (!Array.isArray(value)) return false;
  try {
    if (Object.getPrototypeOf(value) !== Array.prototype) return false;
    if ('toJSON' in value) return false;
    const keys = Reflect.ownKeys(value);
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (
      !lengthDescriptor ||
      !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      lengthDescriptor.value < 0 ||
      keys.length !== lengthDescriptor.value + 1
    ) {
      return false;
    }
    for (const key of keys) {
      if (typeof key !== 'string') return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        return false;
      }
      if (key === 'length') {
        if (descriptor.enumerable) return false;
        continue;
      }
      const index = Number(key);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= lengthDescriptor.value ||
        String(index) !== key ||
        !descriptor.enumerable
      ) {
        return false;
      }
    }
    return true;
  } catch (_error) {
    return false;
  }
};

const hasExactContractKeys = (value, keys) => {
  try {
    const actual = Reflect.ownKeys(value);
    return (
      actual.length === keys.size && actual.every((key) => typeof key === 'string' && keys.has(key))
    );
  } catch (_error) {
    return false;
  }
};

const isCanonicalIsoDate = (value) => {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
};

const isNonEmptyContractText = (value) =>
  typeof value === 'string' && value.length > 0 && value.trim() === value;

const isUniqueContractTextArray = (value) =>
  (() => {
    if (!isDenseContractArray(value)) return false;
    const seen = new Set();
    for (let index = 0; index < value.length; index += 1) {
      const entry = value[index];
      if (!isNonEmptyContractText(entry) || seen.has(entry)) return false;
      seen.add(entry);
    }
    return true;
  })();

const utf8ContractByteLength = (value) => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
};

const DEFAULT_AUDIT_THRESHOLD = 75;

const compareText = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();
const encodeUtf8 = (value) => UTF8_ENCODER.encode(value);
const decodeUtf8 = (bytes) => UTF8_DECODER.decode(bytes);

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const ramp = (value, low, high) =>
  high <= low ? (value >= high ? 1 : 0) : clamp01((value - low) / (high - low));
const round2 = (value) => Math.round(value * 100) / 100;
const round4 = (value) => Math.round(value * 10000) / 10000;

const auditSubmetric = (id, label, ratio, maxScore, value, target, detail) => ({
  id,
  label,
  score: round2(clamp01(ratio) * maxScore),
  maxScore,
  value: round4(value),
  target,
  detail,
});

const gradeForAudit = (allGates, score, passed, threshold = DEFAULT_AUDIT_THRESHOLD) => {
  if (!allGates || score < 50) return 'fail';
  if (!passed || score < threshold) return 'needs_work';
  return score >= 85 ? 'excellent' : 'pass';
};

const rankTopAuditDeductions = (gateDeductions, pillarDeductions, limit = 5) => {
  const sorted = [...pillarDeductions].sort(
    (left, right) =>
      right.lostPoints - left.lostPoints || compareText(left.metricId, right.metricId),
  );
  return [...gateDeductions, ...sorted].slice(0, limit);
};

const damerauLevenshtein = (left, right) => {
  if (left === right) return 0;
  const aLen = left.length;
  const bLen = right.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  const rows = Array.from({ length: aLen + 1 }, () => new Array(bLen + 1).fill(0));
  for (let i = 0; i <= aLen; i += 1) rows[i][0] = i;
  for (let j = 0; j <= bLen; j += 1) rows[0][j] = j;
  for (let i = 1; i <= aLen; i += 1) {
    for (let j = 1; j <= bLen; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        best = Math.min(best, rows[i - 2][j - 2] + 1);
      }
      rows[i][j] = best;
    }
  }
  return rows[aLen][bLen];
};

const toSnakeCaseTrap = (raw) => {
  if (!raw || (!raw.includes('-') && !/[A-Z]/.test(raw))) return null;
  const converted = raw
    .replace(/-/g, '_')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  return converted && converted !== raw ? converted : null;
};

const suggestClosest = (input, candidates, maxDistance = 2) => {
  if (!input) return null;
  const list = [...new Set(candidates)].filter(Boolean).sort(compareText);
  if (list.length === 0) return null;
  const trapped = toSnakeCaseTrap(input);
  if (trapped !== null) {
    const exactTrap = list.find((candidate) => candidate.toLowerCase() === trapped);
    if (exactTrap !== undefined) return exactTrap;
  }
  const probe = (trapped ?? input).toLowerCase();
  const rawLower = input.toLowerCase();
  let best = null;
  let bestDistance = maxDistance + 1;
  for (const candidate of list) {
    const candLower = candidate.toLowerCase();
    const distance = Math.min(
      damerauLevenshtein(probe, candLower),
      damerauLevenshtein(rawLower, candLower),
    );
    if (distance <= maxDistance && distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
};

module.exports = {
  auditSubmetric,
  clamp01,
  compareText,
  damerauLevenshtein,
  decodeUtf8,
  DEFAULT_AUDIT_THRESHOLD,
  encodeUtf8,
  EXPORT_BUNDLE_SCHEMA_VERSION,
  gradeForAudit,
  hasExactContractKeys,
  isCanonicalIsoDate,
  isClosedContractRecord,
  isDenseContractArray,
  isNonEmptyContractText,
  isUniqueContractTextArray,
  PROJECT_DOCUMENT_SCHEMA_VERSION,
  ramp,
  rankTopAuditDeductions,
  round2,
  round4,
  SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION,
  suggestClosest,
  toSnakeCaseTrap,
  utf8ContractByteLength,
};
