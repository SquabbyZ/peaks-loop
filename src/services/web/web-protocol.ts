/**
 * The `peaks web` daemon contract — on-disk (`daemon.json`) and on-the-wire
 * (`POST /op`) in one place (slice S1, files 5/6).
 *
 * `parseDaemonInfo` validates both shape and `PROTOCOL_VERSION`, so a daemon
 * left over from an older protocol is rejected (and therefore killed and
 * respawned) rather than mis-called.
 */

/** Bumped whenever `WebOpRequest` / `WebOpResponse` / `WebDaemonInfo` change shape. */
export const PROTOCOL_VERSION = 1;

/** The full `peaks web` verb surface. S1 implements the first six. */
export type WebOp =
  | 'open'
  | 'text'
  | 'snap'
  | 'click'
  | 'shot'
  | 'metrics'
  | 'login'
  | 'install'
  | 'status'
  | 'stop';

/** Contents of `web/daemon/daemon.json` — the only way to reach a live daemon. */
export interface WebDaemonInfo {
  readonly protocolVersion: number;
  readonly pid: number;
  readonly port: number;
  /** 32 random bytes, hex. Sent as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** `peaks-loop` version that wrote the file. */
  readonly version: string;
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly startedAt: string;
}

/** Body of `POST /op`. */
export interface WebOpRequest {
  readonly op: WebOp;
  readonly args: Readonly<Record<string, unknown>>;
}

/** Response of `POST /op`. */
export interface WebOpResponse<T = unknown> {
  readonly ok: boolean;
  readonly data: T | null;
  readonly code: string | null;
  readonly message: string | null;
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

/**
 * Parse and validate a `daemon.json` body. Returns `null` for malformed JSON,
 * a wrong `protocolVersion`, or any missing/mistyped/out-of-range field — never
 * throws.
 *
 * Every field is checked against how the caller will USE it, not just its type:
 * `port` is bounded to the TCP range because it is interpolated into a URL, and
 * `pid` is a positive integer because it is passed to `process.kill`. Ownership
 * (`projectRoot` / `sessionId` vs the caller's) is deliberately NOT checked here
 * — this function has no caller to compare against; `daemon-registry.readDaemonInfo`
 * is where that comparison belongs.
 */
export function parseDaemonInfo(raw: string): WebDaemonInfo | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const { protocolVersion, pid, port, token, version, projectRoot, sessionId, startedAt } =
    parsed as Record<string, unknown>;
  if (protocolVersion !== PROTOCOL_VERSION) {
    return null;
  }
  if (!isPositiveInteger(pid) || !isTcpPort(port)) {
    return null;
  }
  if (!isNonEmptyString(token) || !isNonEmptyString(version)) {
    return null;
  }
  if (!isNonEmptyString(projectRoot) || !isNonEmptyString(sessionId) || !isNonEmptyString(startedAt)) {
    return null;
  }
  return { protocolVersion, pid, port, token, version, projectRoot, sessionId, startedAt };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** 1..65535 — the range `fetch('http://127.0.0.1:<port>')` can actually mean. */
function isTcpPort(value: unknown): value is number {
  return isPositiveInteger(value) && value <= 65_535;
}
