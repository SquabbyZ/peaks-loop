#!/usr/bin/env node
/**
 * peaks-gate-pipeline — the ARTIFACT-CONTRACT leg of the pre-commit gate.
 *
 * WHY THE LOCAL COMMIT IS THE ONLY BOUNDARY. The artifacts live under
 * `.peaks/_runtime/<sessionId>/`, which is gitignored, so CI structurally
 * cannot see them: no job in `.github/workflows/` reads the artifact contract,
 * and that is a property of where the artifacts live, not an oversight to be
 * fixed by adding a job. Commit time is the only boundary where they are visible.
 *
 * NOT A SECOND CHECKER. The checker exists and works: `peaks workflow
 * verify-pipeline` derives the contract from `contractEvidencePaths()`
 * (`src/services/workflow/pipeline-verify-gate-support.ts`) and reads the
 * ARTIFACTS, not the state machine's state names. This leg only RUNS it, and
 * imports the very same `verifyPipeline` the CLI action calls
 * (`src/cli/commands/workflow-gate-commands.ts` → `runVerifyPipeline`), so
 * there is one table and one answer.
 *
 * WHY IT IMPORTS INSTEAD OF SPAWNING — A MEASUREMENT, NOT A PREFERENCE.
 * Spawning `peaks workflow verify-pipeline` costs ~2.0s per rid (a tsx boot plus
 * the whole CLI module graph, per process): 3 rids measured 6.1s, over the 5s
 * budget this leg is held to. One tsx boot with N in-process calls measured
 * 0.54s for the same 3 rids. Do not restore the spawn without re-measuring, and
 * do not reach for `bin/peaks.js`: it runs a `dist/` that is gitignored and
 * absent on a fresh clone, so a leg built on it would refuse every commit in a
 * tree that was never built.
 *
 * FAIL CLOSED — A DETECTOR THAT CANNOT RUN IS A GATE FAILURE, NOT A ZERO.
 * If the checker cannot be loaded, or throws, or answers with something that is
 * not a verdict, this leg REFUSES and says the checker did not run; it never
 * reads "no answer" as "no violations". Running this file under plain `node`
 * (no tsx) is the reproducible form of that path: the source import fails and
 * the leg refuses — correctly, because the checker genuinely did not run.
 *
 * ZERO RIDS IS A PASS, LOUDLY. A session with no rid under
 * `{prd,rd,qa}/requests/` passes and names the scope it found empty; refusing
 * there would block every commit from the first one, which is how a gate dies
 * and gets bypassed (see `.husky/peaks-gate.mjs`). A MISSING session binding is
 * treated the same way AND printed by name, so an unbound tree can never be
 * mistaken for a satisfied contract. A requests directory that EXISTS and cannot
 * be listed is the other case, and it refuses: "the detector could not read the
 * scope" is not "the scope held nothing".
 *
 * ZERO RIDS IS ALSO NOT PROOF THAT THE SESSION IS THE RIGHT ONE (§9.48). The
 * scope is resolved from the BINDING, and a live binding can point at a session
 * that did not produce the commit: on 2026-10-14 this leg permitted a commit with
 * "no rid to verify … Nothing was refused, exit 0" while the work belonged to a
 * sibling session whose contract the checker reported `complete: true` for. Both
 * sentences were true and only one of them was a check. So when the bound scope
 * reads cleanly AND holds nothing, the leg verifies the MOST RECENTLY ACTIVE
 * sibling session that does carry rids, and says so on both the pass and the
 * refusal path, naming the bound session, the redirected session, and how many
 * rid-carrying sessions were NOT verified. Refusing on the emptiness instead was
 * measured and rejected: it would refuse every docs / chore / memory commit from
 * a fresh session. `.husky/pipeline/session-redirect.mjs` holds the rule.
 *
 * A REQUEST IS AN ARTIFACT, NOT A FILENAME. The rid is the one the artifact
 * service reads off a filename (`requestIdFromFileName`), and the file must be the
 * document that request is (`ridFromCarrier`). A filename prefix is wrong in both
 * directions: it enumerates a dispatch prompt dumped into a requests dir — an
 * unsatisfiable rid, which is how a gate trains `--no-verify` — and it drops a
 * request whose name does not carry the prefix.
 *
 * TYPE FROM THE CARRIER; THE DEFAULT IS THE HEAVIEST TABLE. Each rid's type is
 * read from the `- type: <t>` line in its carrier (`rd/requests` →
 * `prd/requests` → `qa/requests`, first hit wins). With no such line this leg
 * passes NO type and lets the checker's own default apply — `feature`, whose
 * prerequisite table is the heaviest, deliberately fail-closed. An unrecognised
 * value falls back to that default too (and says so) rather than being forwarded:
 * that keeps the leg's answer identical to the checker's own coercion, which is
 * what the note is for — a fallback nobody can see is a silent decision.
 *
 * THE EXEMPTION IS LOUD, AND ITS KNOWN COST IS RECORDED.
 * `PEAKS_SKIP_PIPELINE_VERIFY=1` passes the leg and then NAMES EVERY RID it
 * skipped, plus the scope it read them from; a generic "skipped" is not
 * acceptable. KNOWN COST: an environment token leaves NO trace in git history —
 * the commit that skipped the check is indistinguishable in `git log` from one
 * that passed it. `--allow-incomplete` leaves its reason in the artifact; this
 * token leaves nothing. If the exemption ever needs to be auditable the fix is
 * a NAMED LITERAL IN THE COMMIT SUBJECT (`[wip]`), which needs a `commit-msg`
 * hook because `pre-commit` runs before the message exists. RECORDED, NOT DONE.
 *
 * `git commit --no-verify` still bypasses this leg, as it bypasses every other
 * one. Git owns that semantics; this leg does not fight it.
 *
 * THE DECISION IS IN SIBLINGS. The pure part — enumeration, type resolution,
 * and `decidePipelineVerdict` — is `.husky/pipeline/contract-verdict.mjs`, split
 * out for the 300-line hooks cap exactly as `.husky/gate/*.mjs` is split out of
 * `.husky/peaks-gate.mjs`; the scope redirect is
 * `.husky/pipeline/session-redirect.mjs`, split out for the same cap. What stays
 * here is the two things that touch the world: loading the checker, and printing
 * the verdict to a real commit line.
 *
 * Exit codes: 0 pass, 1 the contract (or the checker) failed. Nothing else.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
// `../.husky/…`, not `./…`: a gate COPY has to be able to load (see the same
// note in `.husky/peaks-gate.mjs` — a scratch copy runs one level under the
// repo root, so `<copy dir>/..` must be the repo root).
import {
  SKIP_TOKEN_ENV,
  decidePipelineVerdict,
  enumerateScope,
  messageOf,
  resolveRidType
} from '../.husky/pipeline/contract-verdict.mjs';
import { findRedirectScope } from '../.husky/pipeline/session-redirect.mjs';

/** The checker modules. Lazy, so importing this file into a test stays cheap. */
export async function loadPeaks() {
  const [pipeline, artifacts, requests, numbering, session, sessionDir] = await Promise.all([
    import('../src/services/workflow/pipeline-verify-service.js'),
    import('../src/services/artifacts/artifact-prerequisites.js'),
    import('../src/services/artifacts/request-artifact-service.js'),
    import('../src/shared/incrementing-number.js'),
    import('../src/services/session/session-manager.js'),
    import('../src/services/session/getSessionDir.js')
  ]);
  return {
    verifyPipeline: pipeline.verifyPipeline,
    isRequestType: artifacts.isRequestType,
    getSessionIdCanonical: session.getSessionIdCanonical,
    getSessionDir: sessionDir.getSessionDir,
    /**
     * The id a request artifact's filename carries, or null when it cannot carry
     * one. Composed from the two rules that own it — the artifact service's own
     * naming rule for the stem, and its own id pattern for the shape — because
     * this leg must not spell a third answer to "what is this file called".
     */
    requestIdFromFileName: (name) => {
      const id = numbering.requestIdFromFileName(name);
      return id !== null && requests.REQUEST_ID_PATTERN.test(id) ? id : null;
    },
    /**
     * Every session directory the repository itself recognises — the same
     * enumeration `peaks workspace reconcile` reads, so the leg never spells a
     * second answer to "what is a session directory".
     *
     * LAZY, AND THAT IS THE POINT: `await import` costs a second module graph,
     * and the ordinary run — a bound session that HAS carriers — never redirects
     * and so never calls this. Only `findRedirectScope` reads it.
     */
    listSessionDirs: async (root) => {
      const { discoverSessions } = await import('../src/services/workspace/reconcile-service.js');
      return discoverSessions(root).map((entry) => ({
        sessionId: entry.sessionId,
        path: entry.path
      }));
    }
  };
}

/**
 * Enumerate → (exemption | check each rid) → decide. `peaks` is injectable so a
 * unit test can drive the branches that need no real project tree — it is
 * exercised that way in `tests/unit/hooks/pipeline-contract-gate.test.ts`.
 *
 * A LOAD FAILURE IS NOT SWALLOWED. Without the checker this leg cannot produce
 * a verdict, so it refuses — except under the exemption token, where the
 * decision is already made and refusing would contradict it; there the load
 * failure is printed as the reason the exemption cannot name its rids.
 *
 * A SCOPE FAILURE REFUSES TOO (unless the exemption is on, as above). An
 * unlistable requests directory, or a binding whose session id the repo's own
 * resolver refuses, arrives in `scope.failures` and is turned into a checker
 * failure: the rids of an unread scope are unknown, so "no violations" is not
 * available as an answer.
 */
export async function runPipelineLeg({ projectRoot, env = process.env, peaks }) {
  let loader = null;
  let loadError = null;
  try {
    loader = peaks === undefined ? await loadPeaks() : await Promise.resolve(peaks);
  } catch (err) {
    loadError = messageOf(err);
  }
  const token = env[SKIP_TOKEN_ENV];
  const exemptionOn = typeof token === 'string' && token !== '' && token !== '0';
  if (loader === null) {
    const why = `the peaks modules could not be loaded (${loadError})`;
    return decidePipelineVerdict({
      rids: [],
      results: exemptionOn ? [] : [{ rid: '<checker>', error: why }],
      skipToken: exemptionOn ? token : null,
      scopeNote: exemptionOn ? `${why}, so this exemption cannot name any rid it skipped` : why
    });
  }
  const scope = enumerateScope(
    projectRoot,
    loader.getSessionIdCanonical,
    loader.getSessionDir,
    loader.requestIdFromFileName
  );
  const rids = [...scope.carriers.keys()];
  if (exemptionOn) {
    return decidePipelineVerdict({ rids, results: [], skipToken: token, scopeNote: scope.note });
  }
  // THE SCOPE REDIRECT (`.peaks/docs/backlog.md` §9.48). An empty scope under a
  // LIVE binding is not "nothing to check" — it can be the wrong session, and
  // this leg passed a commit from a session that had produced it while saying
  // "Nothing was refused". Three conditions, each load-bearing:
  //   - `sessionId !== null`: a scope that was never RESOLVED (the resolver threw,
  //     or there is no binding) is NOT an empty scope. Those postures carry an
  //     empty `failures` too, so without this they would degrade into a redirect
  //     — verifying somebody else's session where a named failure is the answer.
  //   - `failures.length === 0`: a scope whose requests directory could not be
  //     listed is already a refusal; redirecting there would answer a detector
  //     failure with a green line about another session.
  //   - `carriers.size === 0`: the ordinary case never pays for the scan. The
  //     exemption returned above, so an exempted commit never pays for it either.
  const redirect =
    scope.sessionId !== null && scope.carriers.size === 0 && scope.failures.length === 0
      ? await findRedirectScope({
          projectRoot,
          listSessionDirs: loader.listSessionDirs,
          deriveId: loader.requestIdFromFileName
        })
      : null;
  const redirected = redirect !== null && redirect.sessionId !== null;
  const verified = redirected ? redirect : scope;
  const scopeNote = redirect === null ? scope.note : `${scope.note}; ${redirect.note}`;
  const results = verified.failures.map((failure) => ({
    // A scope read failure under a redirect must name the session it could not
    // read, or the refusal blames the bound session for the sibling's state.
    rid: redirected ? `the scope of session ${redirect.sessionId}` : 'the session scope',
    error: failure
  }));
  for (const [rid, carrier] of verified.carriers) {
    const resolved = resolveRidType(carrier.path, loader.isRequestType);
    const note = resolved.note === null ? {} : { note: resolved.note };
    try {
      const verdict = await loader.verifyPipeline({
        projectRoot,
        rid,
        // The scope being verified, NAMED. After a redirect that is the SIBLING,
        // not the binding, and the checker reads exactly the session this leg
        // enumerated — a carrier lookup that fell back to the binding would land
        // in the empty session the redirect exists to look past.
        ...(verified.sessionId === null ? {} : { sessionId: verified.sessionId }),
        ...(resolved.type === undefined ? {} : { requestType: resolved.type })
      });
      if (typeof verdict?.complete !== 'boolean') {
        results.push({ rid, error: 'the checker returned no `complete` verdict', ...note });
      } else {
        results.push({
          rid,
          ...note,
          type: verdict.requestType ?? null,
          complete: verdict.complete,
          violations: Array.isArray(verdict.violations) ? verdict.violations : []
        });
      }
    } catch (err) {
      results.push({ rid, error: messageOf(err), ...note });
    }
  }
  return decidePipelineVerdict({
    rids,
    results,
    skipToken: null,
    scopeNote,
    redirect: redirected ? redirect.note : null
  });
}

/** Print the verdict and set the exit code. Nothing else decides anything. */
export async function main(projectRoot = process.cwd(), env = process.env) {
  let verdict;
  try {
    verdict = await runPipelineLeg({ projectRoot, env });
  } catch (err) {
    verdict = decidePipelineVerdict({
      rids: [],
      results: [{ rid: '<checker>', error: `the leg threw before deciding (${messageOf(err)})` }],
      skipToken: null,
      scopeNote: projectRoot
    });
  }
  for (const line of verdict.lines) console.error(line);
  process.exitCode = verdict.exitCode;
}

/** Only a direct `node <tsx> <this file>` run acts; importing it for tests does not. */
function invokedDirectly() {
  const entry = process.argv[1];
  if (typeof entry !== 'string') return false;
  const self = fileURLToPath(import.meta.url);
  const asked = resolve(entry);
  return process.platform === 'win32' ? asked.toLowerCase() === self.toLowerCase() : asked === self;
}

if (invokedDirectly()) await main();
