import type { ApplyUvSpecPayload } from '../../../spec';
import type { ToolResponse } from '../../../types';
import { validateUvAssignments } from '../../../domain/uv/assignments';
import { uvAssignmentMessages, validationOk, validatePayloadSchema } from '../common';
import { toolSchemas } from '../../../shared/mcpSchemas/toolSchemas';
import { errFromDomain } from '../../response';

export const validateUvSpec = (payload: ApplyUvSpecPayload): ToolResponse<void> => {
  const schemaErr = validatePayloadSchema('apply_uv_spec', payload, toolSchemas.apply_uv_spec);
  if (schemaErr) return schemaErr;
  const assignmentsRes = validateUvAssignments(payload.assignments, uvAssignmentMessages);
  if (!assignmentsRes.ok) return errFromDomain(assignmentsRes.error);
  return validationOk();
};

