// The `peaks sub-agent dispatch` option surface, on its own so the argv contract is
// readable without the action body. Returns the command the action attaches to.
import type { Command } from 'commander';
import { addJsonOption } from '../cli-helpers.js';

const DISPATCH_DESCRIPTION =
  'Build an IDE-specific tool-call descriptor for a sub-agent dispatch. ' +
  'Dry-run by design; the LLM executes the returned toolCall in its own ' +
  'environment. Flags: --write-artifact (G7), ' +
  '--force (G9 CLI 兜底). ' +
  'See skills/peaks-code/references/sub-agent-dispatch.md for the ' +
  'orchestrator contract.';

function buildDispatchCommandBase(parent: Command): Command {
  return parent
    .command('dispatch')
    .description(DISPATCH_DESCRIPTION)
    .argument('<role>', 'sub-agent role (e.g. rd | qa | ui | txt | qa-business | qa-business-api)');
}

function applyDispatchInputOptions(command: Command): Command {
  return (
    command
      // 2.7.0 slice-dag-dispatcher MVP: --prompt is required ONLY when --from-dag is NOT
      // supplied. Previously this was `.requiredOption('--prompt')`, which blocked
      // `dispatch --from-dag <file>` calls because commander.js validates
      // `.requiredOption` before the action handler runs. The mutual-exclusion
      // check is enforced below in the action body (--prompt XOR --from-dag).
      .option(
        '--prompt <text>',
        'the prompt to send to the sub-agent (required unless --from-dag is provided)'
      )
      .option(
        '--prompt-length <bytes>',
        'DOGFOOD ONLY: synthesize a prompt of this size (overrides --prompt content for size only; content is "x" repeated)'
      )
      .option('--request-id <rid>', 'the same <rid> used by peaks request init')
      .option(
        '--session-id <sid>',
        'override active session id (default: resolve from .peaks/_runtime/session.json; falls back to PEAKS_SESSION_ID env var; final fallback "unknown-sid")'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
      .option('--batch-id <uuid>', 'batch id for the dispatch (default: auto-generated UUID)')
      .option(
        '--write-artifact <path>',
        'G7: register an artifact file at <path>; CLI computes sha256 + size + writes ArtifactMeta to the dispatch record'
      )
      .option(
        '--force',
        'G9: override the 80% hard reject threshold at CLI (NOT allowed at hook layer per RL-30 strict)'
      )
      .option(
        '--from-dag <file>',
        '2.7.0 slice-dag-dispatcher MVP: read a SliceDag JSON file, dispatch one sub-agent per node in topological order; --batch-id overrides the auto-generated batch id (mutually exclusive with <role>)'
      )
      .option(
        '--isolation <mode>',
        'slice 2026-07-29-worktree-l2-extended Part 2.C: isolation mode for the sub-agent. Accepts "worktree" (Part 2.C + Part 12 L2 surface), "container" (Part 8 contract + Part 12 L4 docker runtime), or "vm" (Part 25 contract; the VM runtime is a follow-up rid and fail-fasts with ISOLATION_VM_NOT_YET_IMPLEMENTED). Auto-spawns a lease + injects PEAKS_<MODE>_LEASE_ID into the dispatch envelope so the sub-agent can write to the isolated surface without a separate auth grant.'
      )
      // Slice 4.0.8 RD §4 made this a `.requiredOption`. It is optional now:
      // the requirement was enforced but never validated — nothing downstream
      // reads the node, and the record writer's graph transition is
      // best-effort — so its only observable effect was to block dispatch in
      // every project without graph infrastructure. See
      // `provisionDispatchNode`.
      .option(
        '--graph-node <id>',
        'graph node id this dispatch binds to (default: a node is provisioned on demand)'
      )
      .option(
        '--workflow-id <id>',
        'workflow id the graph node belongs to (defaults to derived from session)'
      )
  );
}

function applyDispatchExecutionOptions(command: Command): Command {
  return (
    command
      .option('--graph-ref <ref>', 'graphRef (defaults to graphs/<workflow-id>.json)')
      // mode is `in-process` so the 106+ existing dispatch call sites
      // keep their path byte-identical. The detached branch below
      // fires only when --mode detached is explicitly passed.
      .option(
        '--mode <mode>',
        'dispatch execution mode: in-process (default, dry-run envelope only) | detached (shell out to peaks-loop-internal-runtime/dispatch.dispatchDetached for real vendor CLI execution).'
      )
      .option(
        '--vendor <vendor>',
        'target vendor CLI for --mode detached (claude | codex | copilot). Ignored in the default in-process path.'
      )
      .option(
        '--no-throttle',
        'rid-001 detached: user-overrides ResourceBudgetGuard when concurrent fan-out exceeds max-concurrent (user accepts risk; surfaces as warning)'
      )
      .option(
        '--max-concurrent <n>',
        'rid-001 detached: override the per-tenant max concurrent budget (default 8). Effective in both detached and in-process paths.'
      )
      // §Lesson 1): the RD sub-agent's fake-green failure mode was that it
      // claimed "5/5 reachability tests PASS" while the files were never
      // on disk. `--must-ls-files <glob>` is the anti-fake-green gate:
      // the CLI runs `git ls-files <glob>` upfront, reports the result in
      // the envelope (`data.mustLsFilesVerification`), and prepends a
      // `## must_ls_files enforcement` block to the sub-agent prompt so
      // the LLM's first action MUST re-verify file existence before any
      // "completed" claim. Absent → old behavior is preserved.
      .option(
        '--must-ls-files <glob>',
        'F5: anti-fake-green gate. Run `git ls-files <glob>` upfront; surface the result in the envelope as `mustLsFilesVerification: { path, exists, files }`; prepend a must_ls_files enforcement block to the sub-agent prompt. Absent → unchanged behavior.'
      )
  );
}

export function buildDispatchCommandSpec(parent: Command): Command {
  return addJsonOption(
    applyDispatchExecutionOptions(applyDispatchInputOptions(buildDispatchCommandBase(parent)))
  );
}
