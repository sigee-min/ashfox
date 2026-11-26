import { canonicalJsonString } from '../canonicalJson';
import type { JsonValue } from '../model';
import type { JsonExportFile, ExportFileRole } from './contract';

export const stringifyCompactDeterministicJson = (value: JsonValue | object): string =>
  canonicalJsonString(value);

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
