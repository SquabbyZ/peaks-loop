const STALENESS_MS = 24 * 60 * 60 * 1000;

export function isStale(auditedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(auditedAtIso);
  if (Number.isNaN(t)) return true;
  return nowMs - t > STALENESS_MS;
}
