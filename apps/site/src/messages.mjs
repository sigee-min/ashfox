import { readFileSync } from 'node:fs';
import { defaultLocale, localeRegistry } from './locales.mjs';

const catalogs = new Map(localeRegistry.locales.map(locale => [locale.code,
  JSON.parse(readFileSync(new URL(`./messages/${locale.code}.json`, import.meta.url), 'utf8'))
]));
const keys = Object.keys(catalogs.get(defaultLocale.code)).sort().join();
for (const [code, catalog] of catalogs) {
  if (Object.keys(catalog).sort().join() !== keys ||
      !Object.values(catalog).every(value => typeof value === 'string' && value.trim())) {
    throw new Error(`Incomplete site messages: ${code}`);
  }
}
export const siteMessages = locale => catalogs.get(locale.code);
