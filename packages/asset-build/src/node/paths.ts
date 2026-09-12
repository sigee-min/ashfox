import * as fs from 'node:fs';
import * as path from 'node:path';
import { BuildFailure } from '../bundle/contract';
import { safeRelative } from '../shared/path';
export { safeRelative } from '../shared/path';
export const contained = (root: string, relative: string): string => {
  if (!safeRelative(relative))
    throw new BuildFailure('path.invalid', `Invalid relative path: ${relative}`, 2);
  const target = path.resolve(root, relative),
    relation = path.relative(root, target);
  if (relation.startsWith('..') || path.isAbsolute(relation))
    throw new BuildFailure('path.escape', relative, 2);
  return target;
};
/** Inspect every existing component, including ancestors of the project root. */
export const noLinks = (target: string): void => {
  const absolute = path.resolve(target),
    parts = absolute.slice(path.parse(absolute).root.length).split(path.sep);
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      try {
        if (fs.lstatSync(current).isSymbolicLink())
          throw new BuildFailure('path.symlink', current, 3);
      } catch (error) {
        if (error instanceof BuildFailure) throw error;
      }
      continue;
    }
    if (fs.lstatSync(current).isSymbolicLink()) throw new BuildFailure('path.symlink', current, 3);
  }
};
export const listFiles = (directory: string): readonly string[] => {
  const found: string[] = [];
  const visit = (relative: string): void => {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true })) {
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      if (!safeRelative(next) || entry.isSymbolicLink())
        throw new BuildFailure('output.path', next, 3);
      if (entry.isDirectory()) visit(next);
      else if (entry.isFile()) found.push(next);
      else throw new BuildFailure('output.special-file', next, 3);
      if (found.length > 8192) throw new BuildFailure('output.budget', 'Too many files', 3);
    }
  };
  visit('');
  return found.sort();
};
