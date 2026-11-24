import { isNonEmptyString } from './shared/value';
import type { FindingSink, IdRegistrar, InvariantFinding } from './contract';

export interface ValidationContext {
  readonly findings: readonly Readonly<InvariantFinding>[];
  readonly add: FindingSink;
  readonly registerId: IdRegistrar;
}

const immutableFinding = (finding: InvariantFinding): Readonly<InvariantFinding> =>
  Object.freeze({
    ...finding,
    ...(finding.entityIds ? { entityIds: Object.freeze([...finding.entityIds]) } : {}),
    ...(finding.assetIds ? { assetIds: Object.freeze([...finding.assetIds]) } : {}),
    ...(finding.clipIds ? { clipIds: Object.freeze([...finding.clipIds]) } : {}),
  });

export const createValidationContext = (): ValidationContext => {
  const findings: Readonly<InvariantFinding>[] = [];
  const idPaths = new Map<string, string>();
  const add: FindingSink = (finding) => {
    findings.push(immutableFinding(finding));
  };
  const registerId: IdRegistrar = (id, path) => {
    if (!isNonEmptyString(id)) {
      add({
        code: 'document.required_value',
        severity: 'error',
        message: 'Addressable IDs must be non-empty strings.',
        path,
      });
      return;
    }
    const existing = idPaths.get(id);
    if (existing && existing !== path) {
      add({
        code: 'identity.duplicate',
        severity: 'error',
        message: `ID "${id}" is reused at "${existing}" and "${path}".`,
        path,
      });
      return;
    }
    idPaths.set(id, path);
  };

  return {
    get findings(): readonly Readonly<InvariantFinding>[] {
      return Object.freeze([...findings]);
    },
    add,
    registerId,
  };
};
