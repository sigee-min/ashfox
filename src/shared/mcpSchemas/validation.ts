import type { JsonSchema } from './types';
import {
  MCP_VALIDATION_ENUM_MESSAGE,
  MCP_VALIDATION_ANY_OF_MESSAGE,
  MCP_VALIDATION_MAX_ITEMS_MESSAGE,
  MCP_VALIDATION_MIN_ITEMS_MESSAGE,
  MCP_VALIDATION_NOT_ALLOWED_MESSAGE,
  MCP_VALIDATION_REQUIRED_MESSAGE,
  MCP_VALIDATION_TYPE_MESSAGE
} from '../messages';

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      path: string;
      reason: 'type' | 'enum' | 'minItems' | 'maxItems' | 'required' | 'additionalProperties' | 'anyOf';
      details?: Record<string, unknown>;
    };

const isObject = (value: unknown) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const typeMatches = (schemaType: JsonSchema['type'], value: unknown) => {
  if (!schemaType) return true;
  switch (schemaType) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
};

export const validateSchema = (schema: JsonSchema, value: unknown, path = '$'): ValidationResult => {
  if (!typeMatches(schema.type, value)) {
    const actualType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    return {
      ok: false,
      message: MCP_VALIDATION_TYPE_MESSAGE(path, schema.type ?? 'unknown'),
      path,
      reason: 'type',
      details: { expected: schema.type ?? 'unknown', actual: actualType }
    };
  }

  if (schema.enum && !schema.enum.some((item) => item === value)) {
    return {
      ok: false,
      message: MCP_VALIDATION_ENUM_MESSAGE(path, schema.enum),
      path,
      reason: 'enum',
      details: { expected: schema.enum, actual: value, candidates: schema.enum }
    };
  }

  if (schema.anyOf && schema.anyOf.length > 0) {
    const results = schema.anyOf.map((candidate) => validateSchema(candidate, value, path));
    if (!results.some((result) => result.ok)) {
      const candidateKeys = schema.anyOf
        .map((candidate) => {
          if (!candidate.required || candidate.required.length === 0) return null;
          return candidate.required.length === 1 ? candidate.required[0] : candidate.required.join('+');
        })
        .filter((entry): entry is string => Boolean(entry));
      return {
        ok: false,
        message: MCP_VALIDATION_ANY_OF_MESSAGE(path, candidateKeys.length > 0 ? candidateKeys : undefined),
        path,
        reason: 'anyOf',
        details: {
          candidates: candidateKeys.length > 0 ? candidateKeys : schema.anyOf.map((candidate) => candidate.required)
        }
      };
    }
  }

  if (schema.type === 'array' && Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      return {
        ok: false,
        message: MCP_VALIDATION_MIN_ITEMS_MESSAGE(path, schema.minItems),
        path,
        reason: 'minItems',
        details: { expected: schema.minItems, actual: value.length }
      };
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      return {
        ok: false,
        message: MCP_VALIDATION_MAX_ITEMS_MESSAGE(path, schema.maxItems),
        path,
        reason: 'maxItems',
        details: { expected: schema.maxItems, actual: value.length }
      };
    }
    if (schema.items) {
      for (let i = 0; i < value.length; i += 1) {
        const result = validateSchema(schema.items, value[i], `${path}[${i}]`);
        if (!result.ok) return result;
      }
    }
  }

  if (schema.type === 'object' && isObject(value)) {
    const obj = value as Record<string, unknown>;
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in obj)) {
          const targetPath = `${path}.${key}`;
          return {
            ok: false,
            message: MCP_VALIDATION_REQUIRED_MESSAGE(path, key),
            path: targetPath,
            reason: 'required',
            details: { key }
          };
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj) {
          const result = validateSchema(propSchema, obj[key], `${path}.${key}`);
          if (!result.ok) return result;
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          const targetPath = `${path}.${key}`;
          return {
            ok: false,
            message: MCP_VALIDATION_NOT_ALLOWED_MESSAGE(path, key),
            path: targetPath,
            reason: 'additionalProperties',
            details: { key }
          };
        }
      }
    }
  }

  return { ok: true };
};



