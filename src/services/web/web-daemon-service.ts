/**
 * The `peaks web` daemon: loopback HTTP server, op routing, shutdown
 * (slice S2, file 16).
 *
 * One daemon per `(projectRoot, sessionId)` (design §10.2). It binds
 * `127.0.0.1:0` — an OS-assigned port, loopback only — and writes
 * `web/daemon/daemon.json` with pid/port/token/version (tech-doc §1.3).
 *
 * Two deliberate properties:
 *
 *   - **Chromium is acquired lazily**, on the first op that needs a page. A
 *     daemon that launched a browser at boot would make `peaks web status` and
 *     a cold `stop` pay ~150–300 MB and a process per session for a session
 *     that may never touch a page — and would make AC6's "no browser survives
 *     the session" unverifiable, because booting would already have started
 *     one.
 *   - **`routeOp` is exported and takes the manager as an argument**, so the
 *     whole op surface is testable without a listening socket.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { getErrorMessage } from 'peaks-loop-shared/result';

import { acquireChromium, type AcquiredChromium } from './browser-acquire.js';
import {
  boundedTeardownStep,
  BrowserSessionManager,
  type CloseAllResult
} from './browser-session-manager.js';
import { removeDaemonInfo, writeDaemonInfo } from './daemon-registry.js';
import type { PwBrowser } from './playwright-loader.js';
import { PROTOCOL_VERSION, type WebOp, type WebOpResponse } from './web-protocol.js';

/** Loopback only: the bearer token is the second lock, not the only one. */
export const DAEMON_HOST = '127.0.0.1';

/**
 * Largest `/op` body we will buffer. Args are a URL, a selector and a
 * dispatch id; 64 KiB is orders of magnitude above the real payload and stops
 * an unrelated local process from growing the daemon's heap.
 */
const MAX_REQUEST_BYTES = 64 * 1024;

/** The request's `dispatchId` when the caller sent none — same default as the CLI. */
const DEFAULT_DISPATCH_ID = 'current';

export interface WebDaemonConfig {
  readonly projectRoot: string;
  readonly sessionId: string;
  /** `peaks-loop` version written into `daemon.json`. */
  readonly version: string;
}

export interface RunningWebDaemon {
  readonly port: number;
  readonly token: string;
  /**
   * Close every context, persist each dispatch's `storageState.json`, close the
   * browser process, stop listening and remove `daemon.json`.
   *
   * Returns the teardown result rather than swallowing it: a `storageState.json`
   * that could not be written is silent data loss for S4's login profile (R1).
   */
  readonly close: () => Promise<CloseAllResult>;
}

/**
 * Start the daemon. Resolves once the server is listening and `daemon.json`
 * exists, so the caller (and every poller in `ensureDaemon`) can treat the
 * resolution as "reachable".
 */
export async function startWebDaemon(config: WebDaemonConfig): Promise<RunningWebDaemon> {
  const { projectRoot, sessionId } = config;
  const token = randomBytes(32).toString('hex');
  let browser: PwBrowser | null = null;
  let manager: BrowserSessionManager | null = null;
  let shutdown: Promise<CloseAllResult> | null = null;
  /** Set synchronously by `close()` before it awaits anything. */
  let shuttingDown = false;
  /**
   * The first acquisition failure, remembered for the daemon's whole lifetime.
   *
   * `managerFor` used to retry on every op, and the `MISSING_EXECUTABLE` branch
   * of `acquireChromium` re-runs `playwright install chromium` — a blocking,
   * network-touching `spawnSync`. A token-holder looping `open` against a host
   * whose cache never satisfies `launch()` therefore got unbounded npx fan-out
   * on the daemon's event loop, which is also what starves `/health` into the
   * false negative of R1. One attempt per daemon lifetime, then fail fast.
   */
  let acquireFailure: unknown = null;
  /**
   * The acquisition already under way, so two ops arriving together share one
   * launch instead of both passing the `manager === null` check and starting a
   * browser each — the loser's handle would be overwritten and never closed.
   */
  let acquiring: Promise<AcquiredChromium> | null = null;

  const managerFor = async (): Promise<BrowserSessionManager> => {
    if (acquireFailure !== null) {
      throw acquireFailure;
    }
    if (manager === null) {
      // The shutdown check lives INSIDE the shared promise, so it runs once for
      // every caller waiting on it.
      acquiring ??= (async (): Promise<AcquiredChromium> => {
        let acquired: AcquiredChromium;
        try {
          acquired = await acquireChromium();
        } catch (error) {
          acquireFailure = error;
          throw error;
        }
        if (shuttingDown) {
          // `close()` ran while chromium was launching, so it snapshotted
          // `browser === null` and would never close this one. Without this the
          // op returns into a daemon that is about to `process.exit(0)`, and
          // the fresh chromium outlives it — AC6's false pass.
          await acquired.browser.close();
          throw new Error(
            'WEB_DAEMON_SHUTTING_DOWN: the daemon is closing; the acquired browser was closed'
          );
        }
        return acquired;
      })();
      const acquired = await acquiring;
      acquiring = null;
      browser = acquired.browser;
      manager = new BrowserSessionManager(acquired.browser, { projectRoot, sessionId });
    }
    return manager;
  };

  const close = async (): Promise<CloseAllResult> => {
    shuttingDown = true;
    if (shutdown !== null) {
      return shutdown;
    }
    shutdown = (async (): Promise<CloseAllResult> => {
      const closed: CloseAllResult =
        manager === null
          ? { closedContexts: 0, stateWriteFailures: [] }
          : await manager.closeAll();
      if (browser !== null) {
        // Closing the browser ends the chromium process. Without this the
        // daemon could record a clean stop while the browser outlived it —
        // the exact false pass AC6 is written against.
        await boundedTeardownStep(browser.close(), 'browser.close').catch(reportTeardownFailure);
      }
      await boundedTeardownStep(stopListening(server), 'stopListening').catch(reportTeardownFailure);
      removeDaemonInfo(projectRoot, sessionId);
      return closed;
    })();
    return shutdown;
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error: unknown) => {
      sendJson(response, 500, failureResponse(error));
    });
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = request.url ?? '';
    // `/health` is unauthenticated by contract (tech-doc §1.3): it answers
    // liveness, and the caller already proved ownership by reading daemon.json.
    if (request.method === 'GET' && url === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }
    if (request.method !== 'POST' || url !== '/op') {
      sendJson(response, 404, failureResponse(new Error('WEB_DAEMON_NOT_FOUND: no such endpoint')));
      return;
    }
    if (!isAuthorized(request, token)) {
      sendJson(response, 401, failureResponse(new Error('WEB_DAEMON_UNAUTHORIZED: bad or missing bearer token')));
      return;
    }
    const request_ = parseOpRequest(await readBody(request));
    if (request_ === null) {
      sendJson(response, 400, failureResponse(new Error('WEB_DAEMON_BAD_REQUEST: body is not a WebOpRequest')));
      return;
    }
    if (request_.op === 'whoami') {
      // The ownership proof `stopDaemon` needs, answered from this process's
      // own identity. Handled here rather than in `routeOp` for the same reason
      // `stop` is: it must answer without ever acquiring a browser, and only the
      // daemon knows who it is. It sits behind the bearer check above, which is
      // what makes it evidence and `/health` not.
      sendJson(response, 200, succeeded({ pid: process.pid, projectRoot, sessionId }));
      return;
    }
    if (request_.op === 'stop') {
      // Answer FIRST, then tear down: the caller must learn that the stop was
      // accepted even though the socket is about to disappear.
      sendJson(response, 200, {
        ok: true,
        data: null,
        code: null,
        message: null,
        warnings: [],
        nextActions: []
      } satisfies WebOpResponse);
      response.once('finish', () => {
        void close()
          .catch((error: unknown) => {
            process.stderr.write(`peaks web: daemon shutdown failed: ${getErrorMessage(error)}\n`);
          })
          .then(() => {
            // Re-raise the signal instead of exiting here: `daemon-entry.ts`'s
            // handler is the single place that ends the process, so the
            // graceful HTTP path and an OS signal take the same route. In a
            // test (no listener) this is a no-op and the teardown above is
            // what the assertions see.
            process.emit('SIGTERM');
          });
      });
      return;
    }
    sendJson(response, 200, await routeOp(request_.op, request_.args, managerFor));
  }

  const port = await listen(server);
  writeDaemonInfo(projectRoot, sessionId, {
    protocolVersion: PROTOCOL_VERSION,
    pid: process.pid,
    port,
    token,
    version: config.version,
    projectRoot,
    sessionId,
    startedAt: new Date().toISOString()
  });
  // One line per boot, on the daemon's stderr (= `daemon.log`). It is the only
  // surviving record of how many daemons have started for this session:
  // `daemon.json` holds the LAST writer, so a second, racing daemon would
  // otherwise leave no trace beyond an orphaned port.
  process.stderr.write(
    `peaks web daemon listening on ${DAEMON_HOST}:${String(port)} (pid ${String(process.pid)}, session ${sessionId})\n`
  );
  return { port, token, close };
}

/**
 * Serve one op. Exported separately from the server so every verb's payload
 * shape and failure code are unit-testable without a socket.
 *
 * The manager arrives as a PROVIDER, not a value: acquiring it is what launches
 * chromium, so it must happen only for ops that actually need a page. An op the
 * daemon does not serve (`install`, `login`, a typo) must answer without
 * starting a browser at all.
 */
export async function routeOp(
  op: WebOp,
  args: Readonly<Record<string, unknown>>,
  managerFor: () => Promise<BrowserSessionManager>
): Promise<WebOpResponse> {
  const dispatchId = stringArg(args['dispatchId']) || DEFAULT_DISPATCH_ID;
  try {
    switch (op) {
      case 'open': {
        const manager = await managerFor();
        return succeeded(await manager.open(dispatchId, stringArg(args['url'])));
      }
      case 'text': {
        const manager = await managerFor();
        return succeeded(await manager.text(dispatchId, optionalArg(args['selector'])));
      }
      case 'snap': {
        const manager = await managerFor();
        return succeeded(await manager.snap(dispatchId, optionalArg(args['selector'])));
      }
      case 'click': {
        const manager = await managerFor();
        return succeeded(await manager.click(dispatchId, stringArg(args['selector'])));
      }
      case 'shot': {
        const manager = await managerFor();
        return succeeded(await manager.shot(dispatchId, optionalArg(args['selector'])));
      }
      case 'metrics': {
        const manager = await managerFor();
        return succeeded(await manager.metrics(dispatchId));
      }
      default:
        // `install` / `login` are S3/S4's; the slot exists so they can be
        // added here as one `case` each rather than by reshaping the router.
        return failureResponse(
          new Error(`WEB_OP_UNSUPPORTED: the daemon does not serve '${op}' yet`)
        );
    }
  } catch (error) {
    // Covers both the op itself and chromium acquisition (a missing download,
    // a resolvable-but-broken playwright).
    return failureResponse(error);
  }
}

/**
 * A bounded teardown step that ran out of budget must not abort the rest of the
 * teardown — the record removal and the exit are what stop a wedged daemon from
 * becoming invisible — but it must not be silent either, so it says so on the
 * daemon's stderr (= `daemon.log`).
 */
function reportTeardownFailure(error: unknown): void {
  process.stderr.write(`peaks web daemon: teardown step failed: ${getErrorMessage(error)}\n`);
}

/** `{ok:true}` with the op payload as `data`. */
function succeeded(data: unknown): WebOpResponse {
  return { ok: true, data, code: null, message: null, warnings: [], nextActions: [] };
}

/**
 * Map a thrown error onto the envelope. S1's modules signal their failure code
 * as a `CODE: detail` prefix, so the code survives the trip to the CLI instead
 * of collapsing every daemon failure into one opaque `WEB_OP_FAILED`.
 */
function failureResponse(error: unknown): WebOpResponse {
  const message = getErrorMessage(error);
  const match = /^([A-Z][A-Z0-9_]{0,63}):\s*([\s\S]*)$/.exec(message);
  return {
    ok: false,
    data: null,
    code: match?.[1] ?? 'WEB_OP_FAILED',
    message: match?.[2] ?? message,
    warnings: [],
    nextActions: []
  };
}

/**
 * Constant-time bearer check. `timingSafeEqual` needs equal byte lengths, so
 * the length is compared first — a length mismatch is not a secret (the token
 * is a fixed 64 hex chars) and the comparison is otherwise byte-for-byte.
 */
function isAuthorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const expected = Buffer.from(token, 'utf8');
  const actual = Buffer.from(presented, 'utf8');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Read the body, refusing anything past `MAX_REQUEST_BYTES`. */
async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > MAX_REQUEST_BYTES) {
      throw new Error(`WEB_DAEMON_BODY_TOO_LARGE: body exceeds ${String(MAX_REQUEST_BYTES)} bytes`);
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** `{op, args}` or `null` when the body is not shaped like a `WebOpRequest`. */
function parseOpRequest(body: string): { op: WebOp; args: Record<string, unknown> } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const { op, args } = parsed as { op?: unknown; args?: unknown };
  if (typeof op !== 'string' || op.length === 0) {
    return null;
  }
  return {
    op: op as WebOp,
    args: typeof args === 'object' && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {}
  };
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** An absent OR mistyped optional argument means "not provided", never `[object Object]`. */
function optionalArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.headersSent) {
    response.end();
    return;
  }
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload, 'utf8')
  });
  response.end(payload);
}

/** Bind, and report the OS-assigned port. */
function listen(server: Server): Promise<number> {
  return new Promise<number>((settle, reject) => {
    server.once('error', reject);
    server.listen(0, DAEMON_HOST, () => {
      server.removeListener('error', reject);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('WEB_DAEMON_BIND_FAILED: no TCP address after listen'));
        return;
      }
      settle(address.port);
    });
  });
}

/**
 * Stop accepting work and release the socket. Idle keep-alive connections are
 * dropped first: `fetch` keeps its connection open, and `server.close()` alone
 * would wait for it until its own timeout.
 */
function stopListening(server: Server): Promise<void> {
  return new Promise<void>((settle) => {
    server.close(() => {
      settle();
    });
    server.closeAllConnections();
  });
}
