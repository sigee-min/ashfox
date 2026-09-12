export const safeRelative = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 240 &&
  !/[\\:\x00-\x1f]/u.test(value) &&
  value.normalize('NFC') === value &&
  value
    .split('/')
    .every(
      (part) =>
        part !== '' &&
        part !== '.' &&
        part !== '..' &&
        !/[. ]$/u.test(part) &&
        !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part),
    );
