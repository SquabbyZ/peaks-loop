/**
 * Shape predicates shared by the config reader/writer family.
 *
 * Split out of `config-service.ts` (file-size cap campaign). The service
 * re-exports every name declared here, so existing importers keep using
 * `./config-service.js` unchanged.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isSafeConfigSegment(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..') && !value.endsWith('.')
  );
}

/**
 * A shallow copy of `value` with the `proxy` key removed. The project layer's
 * config is always consumed without its `proxy` (the proxy belongs to the user
 * layer), and spreading around a named rest sibling left a binding no reader
 * needs.
 */
export function omitProxy<T extends object>(value: T): Omit<T, 'proxy'> {
  const copy = { ...value } as Record<string, unknown>;
  delete copy['proxy'];
  return copy as Omit<T, 'proxy'>;
}
