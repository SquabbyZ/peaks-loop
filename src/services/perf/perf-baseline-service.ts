/**
 * Performance baseline scaffolding for the RD stage.
 *
 * peaks-solo's RD stage runs before the QA stage. The user-facing pain is
 * that performance tests (lighthouse / k6 / project-local benches / etc.)
 * have historically only been run at QA Gate A4 — too late in the loop,
 * because a slow regression discovered at QA triggers a return-to-rd
 * cycle, the RD ships another "fix", QA re-runs, and the same cycle
 * repeats up to 3 times before the slice ships.
 *
 * `peaks perf baseline` is the user-visible artifact of a deliberate
 * compromise: keep the heavy performance measurement as something the
 * RD runs themselves (lighthouse is project-shape dependent and we
 * don't want to bake a lighthouse dependency into the CLI), but capture
 * the result in a stable, scaffolded file under
 * `.peaks/_runtime/<sid>/rd/perf-baseline.md` so QA Gate A4 has a known-good
 * reference to diff against. The CLI itself only writes the scaffold
 * and records the path; the actual measurement is a project-local
 * concern that lives in the README, not in peaks-cli.
 *
 * The four-grounds check (per the skill-primary-CLI-auxiliary dev
 * preference):
 *   1. hook/script/CI invokability  — yes, a hook can call this CLI
 *                                     to scaffold the file on session
 *                                     init, similar to session bootstrap.
 *   2. JSON envelope that gates a downstream decision — yes,
 *                                     peaks-rd reads the result and
 *                                     attaches it to the handoff.
 *   3. Destructive --apply side effect — yes, default dry-run.
 *   4. Machine-enforced gate that prose cannot enforce — no, the
 *                                     measurement still lives in
 *                                     the LLM / project tools. We do
 *                                     NOT add a lint gate here.
 *
 * Net: CLI is justified. The destructive --apply default is dry-run,
 * matching the rest of peaks-cli's scaffolding pattern.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getSessionId } from '../session/session-manager.js';
import { getSessionDir } from '../session/getSessionDir.js';
import { findProjectRoot } from '../config/config-safety.js';

export type PerfBaselineInitOptions = {
  projectRoot: string;
  apply?: boolean;
  reason?: string;
};

export type PerfBaselinePlan = {
  apply: boolean;
  projectRoot: string;
  sessionId: string | null;
  perfBaselinePath: string | null;
  plannedWrites: Array<{
    path: string;
    kind: 'directory' | 'file';
    bytes: number;
    content: string;
  }>;
  alreadyInitialized: boolean;
  existingFiles: string[];
};

export type PerfBaselineResult = PerfBaselinePlan & {
  writtenFiles: string[];
  createdDirectories: string[];
  reason?: string;
};

const README_BODY = `# Performance baseline

> Scaffolding for the RD-side performance baseline. Created by
> \`peaks perf baseline\`. The actual measurement is the RD's
> responsibility — see the "How to fill this in" section below.

## Why this exists

The QA stage's Gate A4 (performance check) compares the slice's
performance against the most recent baseline. Without an RD-side
baseline, the first time Gate A4 runs it has nothing to compare
against and any regression it finds is a blind-side surprise.
Capturing the baseline at the RD stage — right after the
implementation lands and before QA picks it up — closes that
gap and prevents the "QA returns 3 times for the same perf
regression" loop.

## What to capture

For each performance-sensitive code path in the slice, record:

- **Path / route** — which entry point (page, hook, API) the
  measurement targets.
- **Workload** — what you did with it (cold load, hot loop, the
  exact N of records the slice introduces).
- **Tool** — lighthouse / k6 / autocannon / project-local bench
  script. Match the tool to the workload; do not introduce a new
  one if the project already has a benchmark script.
- **Metrics** — at minimum LCP / FCP / TBT / CLS for frontend,
  p50/p95/p99 latency + rps for backend, rss / heap growth
  for long-running services.
- **Baseline value** — the number you measured, with units.
- **Threshold** — what the slice's PRD / acceptance criteria
  consider acceptable. If the PRD does not specify, leave this
  field as \`TBD (ask PM)\` and surface it in the RD handoff.

## How to fill this in

1. Run the project's chosen performance tool against the
   implementation you just landed. If the project does not have
   a tool yet, the lightest first step is the chrome devtools
   performance tab on the touched route.
2. For each metric, copy the row from "What to capture" into
   the "Results" table below and fill in the number.
3. The threshold is the bar QA Gate A4 will compare against.
   Be conservative — if the threshold is tighter than what the
   tool reports, Gate A4 will fail.

## Results

| Path / route | Workload | Tool | Metric | Baseline | Threshold |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Notes

- If the slice is documentation-only or has no user-visible
  performance surface, write \`N/A — no perf surface\` here and
  surface that fact in the RD handoff.
- If the measurement exceeded the threshold on the first run,
  do NOT loosen the threshold to make it pass. The right move
  is to optimise the implementation and re-measure, or to
  surface the trade-off to the PRD owner for a threshold bump.

## Handoff

- to peaks-qa: the \`Results\` table is the input to Gate A4.
  Without it QA cannot establish a comparison baseline.
- to peaks-sc: any threshold bumps captured here belong in the
  release notes if the threshold moved.
`;

function renderBaselineTemplate(): string {
  return README_BODY;
}

function buildPlan(projectRoot: string, apply: boolean): PerfBaselinePlan {
  const sessionId = getSessionId(projectRoot);
  const sessionRoot = sessionId !== null
    ? getSessionDir(projectRoot, sessionId)
    : null;
  const perfBaselinePath = sessionRoot !== null
    ? join(sessionRoot, 'rd', 'perf-baseline.md')
    : null;
  const plannedWrites: PerfBaselinePlan['plannedWrites'] = [];
  if (sessionRoot !== null && perfBaselinePath !== null) {
    plannedWrites.push({
      path: join(sessionRoot, 'rd'),
      kind: 'directory',
      bytes: 0,
      content: ''
    });
    plannedWrites.push({
      path: perfBaselinePath,
      kind: 'file',
      bytes: 0,
      content: renderBaselineTemplate()
    });
    for (const write of plannedWrites) {
      if (write.kind === 'file') {
        write.bytes = Buffer.byteLength(write.content, 'utf8');
      }
    }
  }
  return {
    apply,
    projectRoot,
    sessionId,
    perfBaselinePath,
    plannedWrites,
    alreadyInitialized: false,
    existingFiles: []
  };
}

/**
 * Idempotency: skip writes for the perf-baseline file when it
 * already exists. Re-running `peaks perf baseline` on the same
 * session is a normal RD retry pattern (re-measurement, threshold
 * adjustment, etc.); we must not blow away hand-edited content.
 */
async function planPerfBaselineInit(options: PerfBaselineInitOptions): Promise<PerfBaselinePlan> {
  const plan = buildPlan(options.projectRoot, options.apply ?? false);
  if (plan.perfBaselinePath !== null && existsSync(plan.perfBaselinePath)) {
    plan.alreadyInitialized = true;
    plan.existingFiles = [plan.perfBaselinePath];
    plan.plannedWrites = [];
  }
  return plan;
}

export async function executePerfBaselineInit(options: PerfBaselineInitOptions): Promise<PerfBaselineResult> {
  const plan = await planPerfBaselineInit(options);
  const writtenFiles: string[] = [];
  const createdDirectories: string[] = [];

  if (plan.sessionId === null) {
    return {
      ...plan,
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
      writtenFiles,
      createdDirectories
    };
  }

  if (plan.apply && !plan.alreadyInitialized) {
    for (const write of plan.plannedWrites) {
      if (write.kind === 'directory') {
        if (!existsSync(write.path)) {
          await mkdir(write.path, { recursive: true });
          createdDirectories.push(write.path);
        }
        continue;
      }
      if (write.content.length === 0) continue;
      await writeFile(write.path, write.content, 'utf8');
      writtenFiles.push(write.path);
    }
  }

  return {
    ...plan,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
    writtenFiles,
    createdDirectories
  };
}

/**
 * Re-exported so the CLI command can fall back to a project-root
 * resolution when the caller did not pass --project. The CLI does
 * the same findProjectRoot walk that `workspace init` does; this
 * helper exists for the command layer to import without reaching
 * into config-safety directly.
 */
export function resolveProjectRootFromCwd(cwd: string): string {
  return findProjectRoot(cwd) ?? cwd;
}
