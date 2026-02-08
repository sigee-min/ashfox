import type { JsonSchema } from './types';
import type { ValidationResult } from './validationTypes';
import {
  validateAnyOfRule,
  validateArrayRule,
  validateEnumRule,
  validateObjectRule,
  validateTypeRule
} from './validationRules';

export const validateSchema = (schema: JsonSchema, value: unknown, path = '$'): ValidationResult => {
  const applyNested = (nestedSchema: JsonSchema, nestedValue: unknown, nestedPath: string): ValidationResult =>
    validateSchema(nestedSchema, nestedValue, nestedPath);
  const validators = [
    () => validateTypeRule(schema, value, path),
    () => validateEnumRule(schema, value, path),
    () => validateAnyOfRule(schema, value, path, applyNested),
    () => validateArrayRule(schema, value, path, applyNested),
    () => validateObjectRule(schema, value, path, applyNested)
  ];
  for (const validate of validators) {
    const result = validate();
    if (result && !result.ok) return result;
  }

  return { ok: true };
};



