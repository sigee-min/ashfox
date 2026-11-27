import {
  damerauLevenshtein,
  suggestClosest as closestCandidate,
  toSnakeCaseTrap,
} from '@ashfox/internal-contracts';

export { damerauLevenshtein, toSnakeCaseTrap };

export const ASHFOX_UNITS: readonly string[] = Object.freeze([
  's',
  'ms',
  'deg',
  'u',
  'px',
  'b',
  'hz',
  'db',
  'lufs',
  'st',
  'cents',
  '%',
]);

const UNIT_TRAPS: Readonly<Record<string, string>> = Object.freeze({
  sec: 's',
  secs: 's',
  second: 's',
  seconds: 's',
  msec: 'ms',
  msecs: 'ms',
  millisecond: 'ms',
  milliseconds: 'ms',
  degree: 'deg',
  degrees: 'deg',
  unit: 'u',
  units: 'u',
  pixel: 'px',
  pixels: 'px',
  block: 'b',
  blocks: 'b',
  hertz: 'hz',
  decibel: 'db',
  decibels: 'db',
  semitone: 'st',
  semitones: 'st',
  cent: 'cents',
  pct: '%',
  percent: '%',
  ratio: '%',
});

/** Deterministic Damerau-Levenshtein + camel/kebab-to-snake_case suggestion. */
export const suggestClosest = (
  input: string,
  candidates: Iterable<string>,
  maxDistance = 2,
): string | null => closestCandidate(input, candidates, maxDistance);

/** Suggests a valid ashfox 1 numeric unit for an unrecognized suffix. */
export const suggestUnit = (
  rawUnit: string,
  allowed: Iterable<string> = ASHFOX_UNITS,
): string | null => {
  const allowedList = [...allowed].filter(Boolean);
  const trap = UNIT_TRAPS[rawUnit.toLowerCase()];
  if (trap && allowedList.includes(trap)) return trap;
  return closestCandidate(rawUnit, allowedList, 2);
};

/** Formats `" Did you mean \"<match>\"?"` when a candidate matches within maxDistance. */
export const formatDidYouMean = (
  input: string,
  candidates: Iterable<string>,
  maxDistance = 2,
): string => {
  const match = suggestClosest(input, candidates, maxDistance);
  return match === null ? '' : ` Did you mean "${match}"?`;
};

/** Returns a standardized CLI documentation hint for a domain. */
export const docsHint = (domain: string): string => `Hint: run 'ashfox docs ${domain}'`;

/** Appends a fuzzy suggestion and pairs it with the owning domain hint. */
export const withSuggestion = (
  message: string,
  input: string,
  candidates: Iterable<string>,
  domain: string,
  maxDistance = 2,
): { readonly message: string; readonly hint: string } => ({
  message: `${message}${formatDidYouMean(input, candidates, maxDistance)}`,
  hint: docsHint(domain),
});
