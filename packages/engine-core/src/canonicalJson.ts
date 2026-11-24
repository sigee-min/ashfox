import { compareStableText } from './stableOrder';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const canonicalJsonString = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonString).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort(compareStableText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonString(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'undefined';
};
