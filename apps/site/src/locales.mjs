import { readFileSync } from 'node:fs';

export const localeRegistry = JSON.parse(readFileSync(new URL('../../../docs/locales.json', import.meta.url), 'utf8'));
const codes = new Set(), prefixes = new Set();
export const defaultLocale = localeRegistry.locales.find(locale => locale.code === localeRegistry.default);
if (!defaultLocale || defaultLocale.prefix !== '') throw new Error('Default locale must own unprefixed routes');
for (const locale of localeRegistry.locales) {
  if (!/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale.code) ||
      !(locale.prefix === '' || /^\/[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale.prefix)) ||
      codes.has(locale.code) || prefixes.has(locale.prefix) ||
      Object.keys(locale.ui).sort().join() !== Object.keys(defaultLocale.ui).sort().join() ||
      Object.keys(locale.sections).sort().join() !== Object.keys(defaultLocale.sections).sort().join() ||
      ![locale.label, locale.ogLocale, ...Object.values(locale.ui), ...Object.values(locale.sections)].every(value => typeof value === 'string' && value.length)) {
    throw new Error(`Invalid locale registration: ${locale.code}`);
  }
  codes.add(locale.code); prefixes.add(locale.prefix);
}
export const localizedRoute = (route, locale) => `${locale.prefix}${route}`;
