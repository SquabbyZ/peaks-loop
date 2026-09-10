/**
 * Loopback HTTP client for the `peaks web` daemon (slice S1, file 6).
 *
 * The CLI layer never speaks HTTP itself: this class is the only thing it
 * knows how to talk to, so every transport concern (bearer token, timeouts,
 * envelope normalisation) lives here and every CLI test can stub the daemon
 * with a plain `node:http` server.
 */
import type { WebDaemonInfo, WebOp, WebOpRequest, WebOpResponse } from './web-protocol.js';

/** `/health` is a liveness probe; a wedged daemon must answer fast or not at all. */
const HEALTH_TIMEOUT_MS = 500;

export class WebDaemonClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(info: WebDaemonInfo) {
    this.baseUrl = `http://127.0.0.1:${info.port}`;
    this.token = info.token;
  }

  /** True when a daemon is listening on the recorded port and accepting our token. */
  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS)
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Invoke one op. A transport failure throws; an op failure comes back as `ok: false`. */
  async call<T>(op: WebOp, args: Readonly<Record<string, unknown>>, timeoutMs: number): Promise<WebOpResponse<T>> {
    const body: WebOpRequest = { op, args };
    const response = await fetch(`${this.baseUrl}/op`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return {
        ok: false,
        data: null,
        code: `WEB_DAEMON_HTTP_${response.status}`,
        message: `peaks web daemon answered HTTP ${response.status}`,
        warnings: [],
        nextActions: ['Run `peaks web stop` and retry to respawn the daemon']
      };
    }
    const parsed = (await response.json()) as Partial<WebOpResponse<T>>;
    return {
      ok: parsed.ok === true,
      data: parsed.data ?? null,
      code: parsed.code ?? null,
      message: parsed.message ?? null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : [],
      nextActions: Array.isArray(parsed.nextActions) ? parsed.nextActions : []
    };
  }

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' };
  }
}
