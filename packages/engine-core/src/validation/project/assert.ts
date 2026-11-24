import type { ProjectDocument } from '../../model';
import { ProjectInvariantError } from '../contract';
import { validateProjectDocument } from './validate';

export const assertProjectDocument = (document: ProjectDocument): void => {
  const report = validateProjectDocument(document);
  if (!report.valid) {
    throw new ProjectInvariantError(report);
  }
};
