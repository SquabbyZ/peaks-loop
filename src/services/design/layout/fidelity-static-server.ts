/**
 * Serves one already-read local prototype file on the loopback interface for
 * the duration of a fidelity capture. The brief allows exactly this and only
 * this: the fidelity command never starts an application server, and a
 * prototype file has no URL of its own to capture.
 *
 * The response set is fixed — `/` and `/index.html` answer the one document,
 * every other path is 404 — so no request can name a path on disk. The socket
 * binds `127.0.0.1` on an ephemeral port, and the caller records the loopback
 * fact in the artifact.
 */
import { createServer, type RequestListener, type Server } from 'node:http';

const LOOPBACK_HOST = '127.0.0.1';
const INDEX_PATHS: ReadonlySet<string> = new Set(['/', '/index.html']);
const CONTENT_TYPE = 'text/html; charset=utf-8';
const NOT_FOUND = 404;
const OK = 200;

export type PrototypeService = {
  /** The loopback URL the capture is pointed at. */
  url: string;
  loopback: true;
  close: () => Promise<void>;
};

export type ServeResult = { ok: true; service: PrototypeService } | { ok: false; reason: string };

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function handler(body: Buffer): RequestListener {
  return (request, response) => {
    if (!INDEX_PATHS.has(request.url ?? '')) {
      response.writeHead(NOT_FOUND).end();
      return;
    }
    response.writeHead(OK, { 'content-type': CONTENT_TYPE, 'content-length': String(body.length) });
    response.end(body);
  };
}

/**
 * Bind the loopback socket and answer the one document. A listen failure is a
 * value, not a throw, so the caller reports it as a blocked capture.
 */
export async function servePrototype(body: Buffer): Promise<ServeResult> {
  const server = createServer(handler(body));
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, LOOPBACK_HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the prototype static server could not bind (${detail})` };
  }
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server);
    return { ok: false, reason: 'the prototype static server reported no loopback port' };
  }
  const port = address.port;
  return {
    ok: true,
    service: {
      url: `http://${LOOPBACK_HOST}:${String(port)}/`,
      loopback: true,
      close: () => closeServer(server)
    }
  };
}
