import { describe, expect, test } from 'vitest';
import { validateAgainstSchema } from '../../src/shared/json-schema-mini.js';

describe('validateAgainstSchema — primitives and required keys', () => {
  test('passes a minimal object that satisfies required keys', () => {
    const schema = {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } }
    };

    const result = validateAgainstSchema({ name: 'ok' }, schema);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('reports a missing required key with the property path', () => {
    const schema = {
      type: 'object',
      required: ['sessionId', 'why'],
      properties: { sessionId: { type: 'string' }, why: { type: 'string' } }
    };

    const result = validateAgainstSchema({ sessionId: 'x' }, schema);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/' && err.message.includes('why'))).toBe(true);
  });

  test('reports a type mismatch with the property path', () => {
    const schema = {
      type: 'object',
      properties: { count: { type: 'integer' } }
    };

    const result = validateAgainstSchema({ count: 'not-a-number' }, schema);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/count')).toBe(true);
  });

  test('rejects null when the root is required to be an object', () => {
    const schema = { type: 'object' };

    const result = validateAgainstSchema(null, schema);

    expect(result.valid).toBe(false);
  });

  test('rejects arrays when the root is required to be an object', () => {
    const schema = { type: 'object' };

    const result = validateAgainstSchema([1, 2], schema);

    expect(result.valid).toBe(false);
  });
});

describe('validateAgainstSchema — arrays and items', () => {
  test('enforces array type', () => {
    const schema = { type: 'array', items: { type: 'string' } };

    expect(validateAgainstSchema([], schema).valid).toBe(true);
    expect(validateAgainstSchema(['a', 'b'], schema).valid).toBe(true);
    expect(validateAgainstSchema('not-array', schema).valid).toBe(false);
  });

  test('reports a per-item type mismatch with an indexed path', () => {
    const schema = { type: 'array', items: { type: 'string' } };

    const result = validateAgainstSchema(['ok', 42], schema);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/1')).toBe(true);
  });

  test('checks items.minLength on array entries', () => {
    const schema = { type: 'array', items: { type: 'string', minLength: 1 } };

    const result = validateAgainstSchema(['', 'ok'], schema);

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/0' && err.message.includes('minLength'))).toBe(true);
  });
});

describe('validateAgainstSchema — enum / pattern / oneOf', () => {
  test('enforces enum membership', () => {
    const schema = { type: 'string', enum: ['add', 'update'] };

    expect(validateAgainstSchema('add', schema).valid).toBe(true);
    expect(validateAgainstSchema('delete', schema).valid).toBe(false);
  });

  test('enforces regex pattern', () => {
    const schema = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' };

    expect(validateAgainstSchema('ok-name', schema).valid).toBe(true);
    expect(validateAgainstSchema('.hidden', schema).valid).toBe(false);
    expect(validateAgainstSchema('with/slash', schema).valid).toBe(false);
  });

  test('supports oneOf with mixed null and object branches', () => {
    const schema = {
      type: 'object',
      properties: {
        progress: {
          oneOf: [
            { type: 'null' },
            { type: 'object', required: ['done'], properties: { done: { type: 'integer' } } }
          ]
        }
      }
    };

    expect(validateAgainstSchema({ progress: null }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ progress: { done: 3 } }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ progress: { done: 'not-int' } }, schema).valid).toBe(false);
    expect(validateAgainstSchema({ progress: 'string' }, schema).valid).toBe(false);
  });

  test('reports minLength violations', () => {
    const schema = { type: 'string', minLength: 1 };

    expect(validateAgainstSchema('', schema).valid).toBe(false);
    expect(validateAgainstSchema('x', schema).valid).toBe(true);
  });

  test('supports integer minimum', () => {
    const schema = { type: 'integer', minimum: 0 };

    expect(validateAgainstSchema(0, schema).valid).toBe(true);
    expect(validateAgainstSchema(-1, schema).valid).toBe(false);
    expect(validateAgainstSchema(1.5, schema).valid).toBe(false);
  });

  test('treats boolean type strictly', () => {
    const schema = { type: 'boolean' };

    expect(validateAgainstSchema(true, schema).valid).toBe(true);
    expect(validateAgainstSchema(false, schema).valid).toBe(true);
    expect(validateAgainstSchema('true', schema).valid).toBe(false);
  });

  test('treats null type strictly', () => {
    const schema = { type: 'null' };

    expect(validateAgainstSchema(null, schema).valid).toBe(true);
    expect(validateAgainstSchema(undefined, schema).valid).toBe(false);
    expect(validateAgainstSchema(0, schema).valid).toBe(false);
  });

  test('accepts a schema with only enum (no explicit type)', () => {
    const schema = { enum: ['add', 'remove'] };

    expect(validateAgainstSchema('add', schema).valid).toBe(true);
    expect(validateAgainstSchema('delete', schema).valid).toBe(false);
  });

  test('accepts number type with finite decimal values', () => {
    const schema = { type: 'number', minimum: 0 };

    expect(validateAgainstSchema(1.5, schema).valid).toBe(true);
    expect(validateAgainstSchema(Number.POSITIVE_INFINITY, schema).valid).toBe(false);
    expect(validateAgainstSchema(-0.5, schema).valid).toBe(false);
  });
});

describe('validateAgainstSchema — openspec-render-request shape', () => {
  const renderRequestSchema = {
    type: 'object',
    required: ['sessionId', 'why', 'whatChanges', 'acceptanceCriteria'],
    properties: {
      sessionId: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]*$' },
      why: { type: 'string' },
      whatChanges: { type: 'array', items: { type: 'string', minLength: 1 } },
      acceptanceCriteria: { type: 'array', items: { type: 'string', minLength: 1 } },
      outOfScope: { type: 'array', items: { type: 'string', minLength: 1 } },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          required: ['heading', 'todos'],
          properties: {
            heading: { type: 'string', minLength: 1 },
            todos: { type: 'array', items: { type: 'string', minLength: 1 } }
          }
        }
      }
    }
  };

  test('accepts a well-formed render request', () => {
    const result = validateAgainstSchema(
      {
        sessionId: 'add-foo',
        why: 'reason',
        whatChanges: ['change a'],
        acceptanceCriteria: ['accept a'],
        tasks: [{ heading: '1. Section', todos: ['t1'] }]
      },
      renderRequestSchema
    );

    expect(result.valid).toBe(true);
  });

  test('rejects a request with path-traversal sessionId', () => {
    const result = validateAgainstSchema(
      { sessionId: '../escape', why: 'r', whatChanges: ['x'], acceptanceCriteria: ['a'] },
      renderRequestSchema
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/sessionId')).toBe(true);
  });

  test('rejects a request with a non-array whatChanges', () => {
    const result = validateAgainstSchema(
      { sessionId: 'ok', why: 'r', whatChanges: 'oops', acceptanceCriteria: ['a'] },
      renderRequestSchema
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/whatChanges')).toBe(true);
  });

  test('rejects a request with an empty bullet in acceptanceCriteria', () => {
    const result = validateAgainstSchema(
      { sessionId: 'ok', why: 'r', whatChanges: ['x'], acceptanceCriteria: ['', 'good'] },
      renderRequestSchema
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/acceptanceCriteria/0')).toBe(true);
  });

  test('rejects a task without a heading', () => {
    const result = validateAgainstSchema(
      {
        sessionId: 'ok',
        why: 'r',
        whatChanges: ['x'],
        acceptanceCriteria: ['a'],
        tasks: [{ todos: ['t1'] }]
      },
      renderRequestSchema
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === '/tasks/0')).toBe(true);
  });
});
