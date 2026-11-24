const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const QUOTED_VALUE = /^"(?:[\t !#-\[\]-~]|\\[\t !-~])*"$/;
const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

type ParsedMediaRange = {
  type: string;
  subtype: string;
  parameters: Map<string, string>;
};

const splitOutsideQuotes = (value: string, delimiter: string): string[] | null => {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === delimiter) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (quoted || escaped) return null;
  parts.push(value.slice(start));
  return parts;
};

const parseMediaRange = (raw: string, allowWildcards: boolean): ParsedMediaRange | null => {
  if (/[\r\n]/.test(raw)) return null;
  const segments = splitOutsideQuotes(raw, ';');
  if (!segments || segments.length === 0) return null;
  const essence = segments[0].trim().toLowerCase();
  const slash = essence.indexOf('/');
  if (slash <= 0 || slash !== essence.lastIndexOf('/')) return null;
  const type = essence.slice(0, slash);
  const subtype = essence.slice(slash + 1);
  const validName = (value: string) => TOKEN.test(value) || (allowWildcards && value === '*');
  if (!validName(type) || !validName(subtype)) return null;
  if (type === '*' && subtype !== '*') return null;

  const parameters = new Map<string, string>();
  for (const segment of segments.slice(1)) {
    const equals = segment.indexOf('=');
    if (equals <= 0) return null;
    const name = segment.slice(0, equals).trim().toLowerCase();
    const value = segment.slice(equals + 1).trim();
    if (!TOKEN.test(name) || (!TOKEN.test(value) && !QUOTED_VALUE.test(value))) {
      return null;
    }
    if (parameters.has(name)) return null;
    parameters.set(name, value);
  }
  return { type, subtype, parameters };
};

export const isJsonMediaType = (value: string | undefined): boolean => {
  if (typeof value !== 'string' || value.includes(',')) return false;
  const mediaType = parseMediaRange(value, false);
  return mediaType?.type === 'application' && mediaType.subtype === 'json';
};

export const acceptsEventStream = (value: string | undefined): boolean => {
  if (typeof value !== 'string') return false;
  const ranges = splitOutsideQuotes(value, ',');
  if (!ranges) return false;
  return ranges.some((raw) => {
    const range = parseMediaRange(raw, true);
    if (!range) return false;
    const quality = range.parameters.get('q');
    if (quality !== undefined && (!QUALITY.test(quality) || Number(quality) === 0)) {
      return false;
    }
    return (
      (range.type === 'text' || range.type === '*') &&
      (range.subtype === 'event-stream' || range.subtype === '*')
    );
  });
};
