// The find-or-create resolution of the parent command groups the loop-eval family
// attaches to. Each resolver is idempotent, so the group a caller receives does not
// depend on which sub-registrar ran first — the same posture the single
// `registerWorkflowEvalCommands` body had when both were resolved once at its top.
import type { Command } from 'commander';

/** The `peaks workflow` parent, or a newly created one. */
export function workflowCommandParent(program: Command): Command {
  const existingWorkflow = program.commands.find((c) => c.name() === 'workflow');
  return (
    existingWorkflow ??
    program.command('workflow').description('Workflow primitive (run / plan / lint)')
  );
}

/** The `peaks loop` parent, or a newly created one. */
export function loopCommandParent(program: Command): Command {
  const existingLoop = program.commands.find((c) => c.name() === 'loop');
  return existingLoop ?? program.command('loop').description('Loop primitive (eval)');
}

/** The `peaks loop spec` parent, or a newly created one. */
export function loopSpecParent(program: Command): Command {
  const loop = loopCommandParent(program);
  const existingSpec = loop.commands.find((c) => c.name() === 'spec');
  return (
    existingSpec ??
    loop
      .command('spec')
      .description(
        'Slice E.2: read or bootstrap the spec for a rid. Defaults to read; pass --bootstrap to write a default spec.'
      )
  );
}
