/**
 * Dotted-path access into a raw config object, with prototype-pollution guards.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
const UNSAFE_NESTED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function getNestedPathParts(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
}

function hasUnsafeNestedPathSegment(parts: string[]): boolean {
  return parts.some((part) => UNSAFE_NESTED_PATH_SEGMENTS.has(part));
}

export function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = getNestedPathParts(path);
  if (parts.length === 0 || hasUnsafeNestedPathSegment(parts)) {
    return undefined;
  }

  let current: unknown = obj;
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, part)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = getNestedPathParts(path);
  if (parts.length === 0 || hasUnsafeNestedPathSegment(parts)) {
    throw new Error('Unsafe config path');
  }

  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i] as string;
    if (
      !Object.prototype.hasOwnProperty.call(current, part) ||
      typeof current[part] !== 'object' ||
      current[part] === null ||
      Array.isArray(current[part])
    ) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1] as string;
  current[last] = value;
}
