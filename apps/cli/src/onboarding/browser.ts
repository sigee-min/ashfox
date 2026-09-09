import * as fs from 'node:fs';
import * as path from 'node:path';

export const findChrome = (): string | undefined => {
  const candidates = process.env.ASHFOX_CHROME_PATH ? [process.env.ASHFOX_CHROME_PATH] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap(key =>
      process.env[key] ? [path.join(process.env[key]!, 'Google/Chrome/Application/chrome.exe')] : []),
    ...(process.env.PATH ?? '').split(path.delimiter).filter(Boolean).flatMap(directory =>
      ['chromium', 'chromium-browser', 'google-chrome', 'chrome.exe'].map(name => path.join(directory, name)))
  ];
  return candidates.find(file => {
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile(); }
    catch (error) { if (error instanceof Error) return false; return false; }
  });
};
