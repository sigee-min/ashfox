import assert from 'node:assert/strict';

import type { JsonSchema } from '../../src/mcpSchemas/types';
import { validateSchema } from '../../src/mcpSchemas/validation';

export const runSchemaValidationContractTests = (): void => {
  {
    const schema: JsonSchema = { type: 'object' };
    const result = validateSchema(schema, 'not-object');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'type');
      assert.equal(result.path, '$');
    }
  }

  {
    const schema: JsonSchema = { type: 'string', enum: ['a', 'b'] };
    const result = validateSchema(schema, 'c');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'enum');
      assert.equal(Array.isArray(result.details?.candidates), true);
    }
  }

  {
    const schema: JsonSchema = {
      type: 'string',
      pattern: '^#[0-9a-fA-F]{6}$',
    };
    assert.deepEqual(validateSchema(schema, '#a0B1c2'), { ok: true });
    const result = validateSchema(schema, '#abc');
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'pattern');
      assert.equal(result.path, '$');
    }
  }

  {
    const schema: JsonSchema = {
      anyOf: [
        {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: { b: { type: 'number' } },
          required: ['b'],
          additionalProperties: false,
        },
      ],
    };
    const result = validateSchema(schema, { c: true });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'anyOf');
      assert.equal(Array.isArray(result.details?.candidates), true);
    }
  }

  {
    const schema: JsonSchema = {
      type: 'object',
      anyOf: [{ required: ['rotation'] }, { required: ['position'] }],
    };
    const result = validateSchema(schema, {});
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'anyOf');
  }

  {
    const schema: JsonSchema = { type: 'array', minItems: 2 };
    const result = validateSchema(schema, [1]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'minItems');
      assert.equal(result.path, '$');
    }
  }

  {
    const schema: JsonSchema = { type: 'array', maxItems: 1 };
    const result = validateSchema(schema, [1, 2]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'maxItems');
      assert.equal(result.path, '$');
    }
  }

  {
    const inheritedKey = '__ashfoxInheritedRequiredFixture__';
    Object.defineProperty(Object.prototype, inheritedKey, {
      value: true,
      configurable: true,
    });
    try {
      const required = validateSchema(
        {
          type: 'object',
          properties: { [inheritedKey]: { type: 'boolean' } },
          required: [inheritedKey],
          additionalProperties: false,
        },
        {},
      );
      assert.equal(required.ok, false);
      if (!required.ok) assert.equal(required.reason, 'required');

      assert.deepEqual(
        validateSchema(
          {
            type: 'object',
            properties: { [inheritedKey]: { type: 'string' } },
            additionalProperties: false,
          },
          {},
        ),
        { ok: true },
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>)[inheritedKey];
    }
  }

  {
    const schema: JsonSchema = {
      type: 'number',
      minimum: 0.25,
      maximum: 64,
    };
    const below = validateSchema(schema, -1);
    const above = validateSchema(schema, 65);
    assert.equal(below.ok, false);
    assert.equal(above.ok, false);
    if (!below.ok) assert.equal(below.reason, 'minimum');
    if (!above.ok) assert.equal(above.reason, 'maximum');
  }

  {
    const schema: JsonSchema = {
      type: 'array',
      items: { type: 'number' },
    };
    const result = validateSchema(schema, [1, 'x']);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'type');
      assert.equal(result.path, '$[1]');
    }
  }

  {
    const schema: JsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    };
    const result = validateSchema(schema, {});
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'required');
      assert.equal(result.path, '$.name');
    }
  }

  {
    const schema: JsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    };
    const result = validateSchema(schema, { name: 'ok', extra: 1 });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'additionalProperties');
      assert.equal(result.path, '$.extra');
    }
  }

  {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
    };
    const result = validateSchema(schema, { extra: true });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'additionalProperties');
      assert.equal(result.path, '$.extra');
    }
  }

  {
    const schema: JsonSchema = {
      type: 'object',
      additionalProperties: false,
    };
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const value = JSON.parse(`{"${key}":true}`) as unknown;
      const result = validateSchema(schema, value);
      assert.equal(result.ok, false, key);
      if (!result.ok) assert.equal(result.reason, 'additionalProperties');
    }
  }

  {
    const schema: JsonSchema = { type: 'object', minProperties: 1 };
    const result = validateSchema(schema, {});
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'minProperties');
  }

  {
    const sparse = new Array(1);
    const result = validateSchema({ type: 'array' }, sparse);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reason, 'type');
  }

  {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'number' } },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    };
    const result = validateSchema(schema, {
      items: [{ id: 1 }, { id: 2 }],
    });
    assert.deepEqual(result, { ok: true });
  }
};
