/**
 * THE SCOPE REDIRECT — what the artifact-contract leg verifies when the session
 * it is bound to holds nothing (`.peaks/docs/backlog.md` §9.48).
 *
 * THE DEFECT THIS ANSWERS. `enumerateScope` resolves the session the hook is
 * bound to and enumerates THAT session's requests. When the bound session is a
 * fresh one while the work belongs to another session, the enumeration is empty
 * and the leg permits the commit saying "no rid to verify … Nothing was
 * refused" — true, and a check that never ran. Zero carriers from an empty
 * session and zero carriers from the WRONG session are the same number.
 *
 * WHY THIS IS NOT A REFUSAL, AND THAT WAS MEASURED. Refusing when the bound
 * session is empty while a sibling is not would refuse every docs, chore and
 * memory commit from the six empty sessions this repository held on 2026-10-14 —
 * and a gate that refuses legitimate work is what teaches `--no-verify`. The
 * measured harm in the recorded incident was that the check did not run: the
 * contract WAS satisfied. So the leg verifies the right session instead of
 * verifying nothing.
 *
 * EXACTLY ONE SIBLING, THE NEWEST. Verifying every rid-carrying session is
 * unbounded (87 + 47 + 19 + 18 + 14 rids on 2026-10-14) and the leg's budget is
 * 5s. "Newest" is the greatest mtime among the sibling's own CARRIER FILES,
 * because both cheaper axes are wrong here: a directory's mtime moves when a
 * child is created on Windows and does not on Linux, and the inner
 * `session.json` is written when the session is CREATED rather than when it last
 * worked (measured: session 2026-10-14-session-2f9323's `session.json` is 00:05
 * while its newest carrier is 07:39). A tie keeps the greater session id, so the
 * answer never depends on enumeration order.
 *
 * THE POPULATION is `discoverSessions`, the repository's own answer to "what is
 * a session directory", injected rather than re-spelled here for the reason the
 * leg composes `requestIdFromFileName` instead of carrying its own naming rule.
 *
 * `null` means "the bound scope's emptiness is the whole truth": the scan ran and
 * no sibling carries a rid, so the caller keeps its scope note byte for byte.
 */
import { statSync } from 'node:fs';
import { collectRids, messageOf } from './contract-verdict.mjs';

/** The greatest mtime among a carrier set's own files, or -1 when it has none. */
function newestCarrierMs(carriers) {
  let newest = -1;
  for (const carrier of carriers.values()) {
    const mtime = statSync(carrier.path).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

/**
 * `null`, or `{ sessionId, carriers, failures, note }` where:
 *
 *   - `sessionId` is the sibling to verify instead — or `null` when the SCAN
 *     itself could not run, a posture in which the leg verifies nothing exactly
 *     as it does today but SAYS the detector did not run. It is deliberately not
 *     a refusal: refusing there is the rejected design, and the bound scope's own
 *     read failures still refuse on their own path, unchanged.
 *   - `carriers` / `failures` have `collectRids`' shape, for the session in
 *     `sessionId`; both are empty when `sessionId` is `null`.
 *   - `note` is the sentence the caller appends to its scope note. It names the
 *     target, that target's rid count, and how many rid-carrying sessions were
 *     NOT verified. ONE sentence on purpose: it is printed inside the scope note
 *     on the pass path and as its own line on the refusal path, so a reader sees
 *     the same scope statement on both.
 *
 * A throwing `statSync` is not swallowed: it reaches the same catch as a throwing
 * lister, so an unreadable carrier degrades to the visible scan-refused note
 * rather than to a silent "no sibling carries a rid".
 *
 * `listSessionDirs` may be sync or async (the leg's own is async so the module
 * graph it costs is paid only when a redirect is possible); awaiting both is what
 * keeps a test stub one line.
 */
export async function findRedirectScope({ projectRoot, listSessionDirs, deriveId }) {
  let candidates;
  try {
    candidates = [];
    for (const session of await listSessionDirs(projectRoot)) {
      // The bound session is not excluded by name: a candidate has to CARRY a
      // rid, and this function is only reached when the bound session carried
      // none. Stated, rather than defended by a comparison no case can exercise.
      const { carriers, failures } = collectRids(session.path, deriveId);
      if (carriers.size > 0) {
        candidates.push({ session, carriers, failures, newest: newestCarrierMs(carriers) });
      }
    }
  } catch (err) {
    return {
      sessionId: null,
      carriers: new Map(),
      failures: [],
      note: `the sibling session scan refused (${messageOf(err)})`
    };
  }
  let best = null;
  for (const candidate of candidates) {
    if (best === null || candidate.newest >= best.newest) best = candidate;
  }
  if (best === null) return null;
  const skipped = candidates.length - 1;
  return {
    sessionId: best.session.sessionId,
    carriers: best.carriers,
    failures: best.failures,
    note:
      `REDIRECTED to session ${best.session.sessionId} (${best.carriers.size} rid(s)), the newest of ` +
      `${candidates.length} rid-carrying session(s); ${skipped} NOT verified`
  };
}
