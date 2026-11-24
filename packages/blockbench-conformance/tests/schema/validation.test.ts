import assert from 'node:assert/strict';

import { projectContractReader as currentProjectContractReader } from '@ashfox/blockbench-contracts/types/project/contract';
import { runSchemaValidationContractTests } from '../../../blockbench-contracts/testSupport/schema/contract';

runSchemaValidationContractTests();
assert.equal(
  Object.isFrozen(currentProjectContractReader),
  true,
  'the canonical project contract reader is immutable',
);
