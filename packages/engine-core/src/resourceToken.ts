export const resourceToken = (value: string, fallback = 'asset'): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '') || fallback;
