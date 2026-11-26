import { BuildFailure } from '@ashfox/asset-build';
import { isClosedContractRecord } from '@ashfox/engine-core';
import { type SourceInput } from './contract';

const record = (value: unknown, keys: readonly string[]): Readonly<Record<string, unknown>> => {
  if (!isClosedContractRecord(value))
    throw new BuildFailure('observe.contract', 'Expected object', 2);
  for (const key of Object.keys(value))
    if (!keys.includes(key)) throw new BuildFailure('observe.contract', 'Unknown field: ' + key, 2);
  return value;
};

const text = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.length)
    throw new BuildFailure('observe.contract', 'Expected nonempty string: ' + name, 2);
  return value;
};

export const readInput = (value: unknown): SourceInput => {
  const v = record(value, ['file', 'source', 'name', 'files']);
  if (v.file !== undefined) {
    if (Object.keys(v).length !== 1)
      throw new BuildFailure('observe.contract', 'file cannot be mixed with memory source', 2);
    return { file: text(v.file, 'file') };
  }
  const source = text(v.source, 'source'),
    name = v.name === undefined ? 'main.ashfox' : text(v.name, 'name');
  let files: Record<string, string> | undefined;
  if (v.files !== undefined) {
    if (!isClosedContractRecord(v.files))
      throw new BuildFailure('observe.contract', 'files must map paths to source strings', 2);
    files = Object.fromEntries(
      Object.entries(v.files).map(([key, content]) => [key, text(content, key)]),
    );
  }
  return { source, name, files };
};
