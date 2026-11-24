import type { JsonValue } from '../model';
import type { JsonExportFile, ExportFileRole } from './contract';

const sortJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJson(entry));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right))) {
      sorted[key] = sortJson(value[key]);
    }
    return sorted;
  }
  return value;
};

export const stringifyCompactDeterministicJson = (value: JsonValue | object): string =>
  JSON.stringify(sortJson(value as JsonValue));

export const createCompactJsonExportFile = (
  role: ExportFileRole,
  path: string,
  data: JsonValue | object,
  contentType: JsonExportFile['contentType'] = 'application/json',
): JsonExportFile => {
  const jsonData = data as JsonValue;
  return {
    kind: 'json',
    role,
    path,
    contentType,
    data: jsonData,
    text: stringifyCompactDeterministicJson(jsonData),
  };
};
