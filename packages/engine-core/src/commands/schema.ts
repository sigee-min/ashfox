import type { JsonPrimitive } from '../model';

interface CommandInputSchemaMetadata {
  description?: string;
}

export type CommandInputSchema = (
  | {
      type: 'string';
      minLength?: number;
      maxLength?: number;
      pattern?: string;
    }
  | {
      type: 'number';
      minimum?: number;
      maximum?: number;
      integer?: boolean;
      multipleOf?: number;
    }
  | {
      type: 'boolean';
    }
  | {
      type: 'array';
      items: CommandInputSchema;
      minItems?: number;
      maxItems?: number;
      uniqueItems?: boolean;
    }
  | {
      type: 'object';
      properties: Readonly<Record<string, CommandInputSchema>>;
      required?: readonly string[];
      atLeastOne?: readonly string[];
      minProperties?: number;
      maxProperties?: number;
      additionalProperties: boolean | CommandInputSchema;
    }
  | {
      enum: readonly JsonPrimitive[];
    }
  | {
      anyOf: readonly CommandInputSchema[];
    }
) &
  CommandInputSchemaMetadata;

export interface SchemaIssue {
  path: string;
  message: string;
  expected: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const validateEnum = (
  value: unknown,
  schema: Extract<CommandInputSchema, { enum: readonly JsonPrimitive[] }>,
  path: string,
): SchemaIssue | null =>
  schema.enum.some((entry) => Object.is(entry, value))
    ? null
    : {
        path,
        message: 'Value is outside the allowed set.',
        expected: schema.enum.map(String).join(' | '),
      };

const validateAnyOf = (
  value: unknown,
  schema: Extract<CommandInputSchema, { anyOf: readonly CommandInputSchema[] }>,
  path: string,
): SchemaIssue | null => {
  const discriminatedCandidates =
    isRecord(value) && typeof value.kind === 'string'
      ? schema.anyOf.filter((candidate) => {
          if (!('type' in candidate) || candidate.type !== 'object') {
            return false;
          }
          const discriminator = candidate.properties.kind;
          return (
            discriminator !== undefined &&
            'enum' in discriminator &&
            discriminator.enum.some((entry) => Object.is(entry, value.kind))
          );
        })
      : [];
  const candidates = discriminatedCandidates.length > 0 ? discriminatedCandidates : schema.anyOf;
  const issues = candidates.map((candidate) => validateCommandInput(value, candidate, path));
  if (issues.some((issue) => issue === null)) return null;
  return (
    (issues as readonly SchemaIssue[])
      .slice()
      .sort(
        (left, right) =>
          right.path.length - left.path.length || left.path.localeCompare(right.path),
      )[0] ?? {
      path,
      message: 'Value does not match an allowed shape.',
      expected: 'one allowed schema',
    }
  );
};

const validateString = (
  value: unknown,
  schema: Extract<CommandInputSchema, { type: 'string' }>,
  path: string,
): SchemaIssue | null => {
  if (typeof value !== 'string') {
    return { path, message: 'Expected a string.', expected: 'string' };
  }
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    return {
      path,
      message: 'String is shorter than allowed.',
      expected: `at least ${schema.minLength} character(s)`,
    };
  }
  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    return {
      path,
      message: 'String is longer than allowed.',
      expected: `at most ${schema.maxLength} character(s)`,
    };
  }
  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    return {
      path,
      message: 'String does not match the required pattern.',
      expected: schema.pattern,
    };
  }
  return null;
};

const validateNumber = (
  value: unknown,
  schema: Extract<CommandInputSchema, { type: 'number' }>,
  path: string,
): SchemaIssue | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { path, message: 'Expected a finite number.', expected: 'number' };
  }
  if (schema.integer && !Number.isSafeInteger(value)) {
    return {
      path,
      message: 'Expected a safe integer.',
      expected: 'safe integer',
    };
  }
  if (
    schema.multipleOf !== undefined &&
    (!Number.isFinite(schema.multipleOf) ||
      schema.multipleOf <= 0 ||
      Math.abs(value / schema.multipleOf - Math.round(value / schema.multipleOf)) >
        Number.EPSILON * 16)
  ) {
    return {
      path,
      message: 'Number is not on the required increment.',
      expected: `multiple of ${schema.multipleOf}`,
    };
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    return {
      path,
      message: 'Number is below the allowed minimum.',
      expected: `>= ${schema.minimum}`,
    };
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    return {
      path,
      message: 'Number is above the allowed maximum.',
      expected: `<= ${schema.maximum}`,
    };
  }
  return null;
};

const validateArray = (
  value: unknown,
  schema: Extract<CommandInputSchema, { type: 'array' }>,
  path: string,
): SchemaIssue | null => {
  if (!Array.isArray(value)) {
    return { path, message: 'Expected an array.', expected: 'array' };
  }
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    return {
      path,
      message: 'Array has too few items.',
      expected: `at least ${schema.minItems} item(s)`,
    };
  }
  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    return {
      path,
      message: 'Array has too many items.',
      expected: `at most ${schema.maxItems} item(s)`,
    };
  }
  if (schema.uniqueItems) {
    const serialized = value.map((entry) => JSON.stringify(entry));
    if (new Set(serialized).size !== serialized.length) {
      return {
        path,
        message: 'Array items must be unique.',
        expected: 'unique items',
      };
    }
  }
  for (let index = 0; index < value.length; index += 1) {
    const issue = validateCommandInput(value[index], schema.items, `${path}[${index}]`);
    if (issue) return issue;
  }
  return null;
};

const validateObject = (
  value: unknown,
  schema: Extract<CommandInputSchema, { type: 'object' }>,
  path: string,
): SchemaIssue | null => {
  if (!isRecord(value)) {
    return { path, message: 'Expected an object.', expected: 'object' };
  }
  const propertyCount = Object.keys(value).length;
  if (schema.minProperties !== undefined && propertyCount < schema.minProperties) {
    return {
      path,
      message: 'Object has too few properties.',
      expected: `at least ${schema.minProperties} property/properties`,
    };
  }
  if (schema.maxProperties !== undefined && propertyCount > schema.maxProperties) {
    return {
      path,
      message: 'Object has too many properties.',
      expected: `at most ${schema.maxProperties} property/properties`,
    };
  }
  for (const key of schema.required ?? []) {
    if (!(key in value)) {
      return {
        path: `${path}.${key}`,
        message: 'Required property is missing.',
        expected: 'defined value',
      };
    }
  }
  if (schema.atLeastOne !== undefined && !schema.atLeastOne.some((key) => key in value)) {
    return {
      path,
      message: 'One of the required alternatives is missing.',
      expected: `at least one of ${schema.atLeastOne.join(', ')}`,
    };
  }
  const unknownKeys = Object.keys(value).filter((key) => !(key in schema.properties));
  if (schema.additionalProperties === false) {
    if (unknownKeys[0]) {
      return {
        path: `${path}.${unknownKeys[0]}`,
        message: 'Property is not part of this command.',
        expected: 'registered property',
      };
    }
  } else if (typeof schema.additionalProperties === 'object') {
    for (const key of unknownKeys) {
      const issue = validateCommandInput(value[key], schema.additionalProperties, `${path}.${key}`);
      if (issue) return issue;
    }
  }
  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    if (!(key in value)) continue;
    const issue = validateCommandInput(value[key], propertySchema, `${path}.${key}`);
    if (issue) return issue;
  }
  return null;
};

export const validateCommandInput = (
  value: unknown,
  schema: CommandInputSchema,
  path = '$',
): SchemaIssue | null => {
  if ('enum' in schema) return validateEnum(value, schema, path);
  if ('anyOf' in schema) return validateAnyOf(value, schema, path);

  switch (schema.type) {
    case 'string':
      return validateString(value, schema, path);
    case 'number':
      return validateNumber(value, schema, path);
    case 'boolean':
      return typeof value === 'boolean'
        ? null
        : { path, message: 'Expected a boolean.', expected: 'boolean' };
    case 'array':
      return validateArray(value, schema, path);
    case 'object':
      return validateObject(value, schema, path);
  }
};
