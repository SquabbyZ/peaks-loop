export type JsonSchemaIssue = {
  path: string;
  message: string;
};

export type JsonSchemaResult = {
  valid: boolean;
  errors: JsonSchemaIssue[];
};

export type JsonSchemaNode = Record<string, unknown>;

function joinPath(parent: string, segment: string | number): string {
  if (parent === '/') {
    return `/${segment}`;
  }
  return `${parent}/${segment}`;
}

function typeOf(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (Number.isInteger(value)) {
    return 'integer';
  }
  return typeof value;
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'integer') {
    return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
  }
  if (expected === 'number') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (expected === 'array') {
    return Array.isArray(value);
  }
  if (expected === 'null') {
    return value === null;
  }
  if (expected === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  return typeof value === expected;
}

function validateNode(value: unknown, schema: JsonSchemaNode, path: string, errors: JsonSchemaIssue[]): void {
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf as JsonSchemaNode[];
    const branchErrors: JsonSchemaIssue[][] = [];
    let matched = false;
    for (const branch of branches) {
      const sink: JsonSchemaIssue[] = [];
      validateNode(value, branch, path, sink);
      if (sink.length === 0) {
        matched = true;
        break;
      }
      branchErrors.push(sink);
    }
    if (!matched) {
      const detail = branchErrors.map((sink) => sink.map((issue) => issue.message).join(' / ')).join(' | ');
      errors.push({ path, message: `does not match any oneOf branch (${detail})` });
    }
    return;
  }

  const expectedType = typeof schema.type === 'string' ? schema.type : null;
  if (expectedType !== null && !matchesType(value, expectedType)) {
    errors.push({ path, message: `expected type ${expectedType}, got ${typeOf(value)}` });
    return;
  }

  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({ path, message: `string shorter than minLength ${schema.minLength}` });
    }
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern).test(value)) {
      errors.push({ path, message: `string does not match pattern ${schema.pattern}` });
    }
    if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) {
      errors.push({ path, message: `value ${JSON.stringify(value)} is not in enum` });
    }
    return;
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({ path, message: `number below minimum ${schema.minimum}` });
    }
    return;
  }

  if (Array.isArray(value)) {
    if (schema.items !== undefined) {
      const itemSchema = schema.items as JsonSchemaNode;
      value.forEach((entry, index) => {
        validateNode(entry, itemSchema, joinPath(path, index), errors);
      });
    }
    return;
  }

  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!Object.prototype.hasOwnProperty.call(record, key)) {
          errors.push({ path, message: `missing required property: ${key}` });
        }
      }
    }
    const properties = schema.properties;
    if (properties !== null && typeof properties === 'object' && !Array.isArray(properties)) {
      const propertyMap = properties as Record<string, JsonSchemaNode>;
      for (const [key, child] of Object.entries(propertyMap)) {
        if (Object.prototype.hasOwnProperty.call(record, key)) {
          validateNode(record[key], child, joinPath(path, key), errors);
        }
      }
    }
  }
}

export function validateAgainstSchema(value: unknown, schema: JsonSchemaNode): JsonSchemaResult {
  const errors: JsonSchemaIssue[] = [];
  validateNode(value, schema, '/', errors);
  return { valid: errors.length === 0, errors };
}
