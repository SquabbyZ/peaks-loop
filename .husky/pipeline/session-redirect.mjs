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
 * memory commit made from a session that carries no request — and a gate that
 * refuses legitimate work is what teaches `--no-verify`. The measured harm in
 * the recorded incident was that the check did not run: the contract WAS
 * satisfied. So the leg verifies the right session instead of verifying nothing.
 *
 * EXACTLY ONE SIBLING, THE NEWEST. Verifying every rid-carrying session is
 * unbounded and the leg's budget is 5s. "Newest" is the greatest mtime among the
 * sibling's own CARRIER FILES, because both cheaper axes are wrong here: a
 * directory's mtime moves when a child is created on Windows and does not on
 * Linux, and the inner `session.json` is written when the session is CREATED
 * rather than when it last worked (measured: session 2026-10-14-session-2f9323's
 * `session.json` is 00:05Z while its newest carrier is 07:39Z). A tie keeps the
 * greater session id — decided HERE, so the answer cannot depend on the order
 * the lister happened to enumerate in.
 *
 * THE POPULATION is `discoverSessions`, the repository's own answer to "what is
 * a session directory", injected rather than re-spelled here for the reason the
 * leg composes `requestIdFromFileName` instead of carrying its own naming rule.
 *
 * A SIBLING THAT CANNOT BE READ IS NEITHER A CANDIDATE NOR IGNORABLE (§9.49).
 * `collectRids` reports an unlistable carrier directory, and an unreadable
 * carrier file, in `failures`. A session with zero carriers AND failures has an
 * UNKNOWN carrier count: it cannot be ranked (its newest carrier is unknown) and
 * it must not be dropped, because dropping it is how the leg comes to verify an
 * OLDER session while the newest is unreadable. So it is NAMED in the note and
 * COUNTED in the not-verified total; the note may never print "0 NOT verified"
 * while a session was in fact left out. It is reported, not refused: this scan
 * runs only after the bound scope returned a clean and empty answer, so refusing
 * here would let one unreadable directory block a commit that has nothing to do
 * with it — the exact shape rejected in the paragraph above. A candidate that IS
 * selected still refuses on its own `failures`, exactly as the bound scope does.
 *
 * `null` means "the bound scope's emptiness is the whole truth": the scan read
 * every sibling it could and none carries a request. An unreadable sibling is
 * not `null` — that is the one posture in which the scan cannot know.
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
 * The note clause for the siblings a scan could not read, or `''` when there
 * were none — so the ordinary sentence stays byte for byte what it was.
 */
function unreadClause(unreadable) {
  if (unreadable.length === 0) return '';
  return `${unreadable.length} unreadable (${unreadable.join(', ')})`;
}

/** The candidate that wins: greatest carrier mtime, then greatest session id. */
function better(candidate, best) {
  if (best === null) return true;
  if (candidate.newest !== best.newest) return candidate.newest > best.newest;
  // A tie is broken HERE. The caller's `discoverSessions` happens to sort, which
  // is why `>=` looked correct; a stub lister does not, and then the LAST
  // enumerated sibling wins — the same tree, a different target. Code-unit order
  // is a total order over the alphabet the session-id pattern admits.
  return candidate.session.sessionId > best.session.sessionId;
}

/**
 * `null`, or `{ sessionId, carriers, failures, note }` where:
 *
 *   - `sessionId` is the sibling to verify instead — or `null` when there is
 *     nothing verifyable: either the SCAN itself could not run, or it found no
 *     readable carrier while at least one sibling stayed unreadable. Both
 *     postures are TOLD, and neither refuses; refusing is the rejected design,
 *     and the bound scope's own read failures still refuse on their own path.
 *   - `carriers` / `failures` have `collectRids`' shape, for the session in
 *     `sessionId`; both are empty when `sessionId` is `null`.
 *   - `note` is the sentence the caller appends to its scope note. It names the
 *     target, that target's carrier count, how many siblings were NOT verified,
 *     and every sibling it could not read. ONE sentence on purpose: it is
 *     printed inside the scope note on the pass path and as its own line on the
 *     refusal path, so a reader sees the same scope statement on both.
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
  let unreadable;
  try {
    candidates = [];
    unreadable = [];
    for (const session of await listSessionDirs(projectRoot)) {
      // The bound session is not excluded by name: a candidate has to CARRY a
      // rid, and this function is only reached when the bound session carried
      // none. Stated, rather than defended by a comparison no case can exercise.
      const { carriers, failures } = collectRids(session.path, deriveId);
      if (carriers.size > 0) {
        candidates.push({ session, carriers, failures, newest: newestCarrierMs(carriers) });
      } else if (failures.length > 0) {
        // Unknown, not empty: carried out of the scan and named, never dropped.
        unreadable.push(session.sessionId);
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
    if (better(candidate, best)) best = candidate;
  }
  if (best === null) {
    if (unreadable.length === 0) return null;
    return {
      sessionId: null,
      carriers: new Map(),
      failures: [],
      // Not `null`: the caller would then keep its "the scope held nothing"
      // sentence byte for byte and the dropped sibling would vanish, which is
      // the whole defect. No refusal either — there is simply nothing to verify.
      note: `no readable sibling carries a request; ${unreadClause(unreadable)}`
    };
  }
  const unread = unreadClause(unreadable);
  const skipped = candidates.length - 1 + unreadable.length;
  return {
    sessionId: best.session.sessionId,
    carriers: best.carriers,
    failures: best.failures,
    note:
      `REDIRECTED to session ${best.session.sessionId} (${best.carriers.size} rid(s)), ` +
      `${unread === '' ? 'the newest of' : 'the newest readable of'} ` +
      `${candidates.length} rid-carrying session(s); ${skipped} NOT verified${unread === '' ? '' : `; ${unread}`}`
  };
}
