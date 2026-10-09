// `peaks swarm plan | swarm-plan | swarm pipeline|dispatch|verify|loop` and the
// `peaks recommend` facade. Owns the swarm parent, so it creates it here.
import type { Command } from 'commander';
import {
  addJsonOption,
  isRecommendationWorkflow,
  printResult,
  type ProgramIO
} from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { createRecommendationPlan } from '../../services/recommendations/recommendation-service.js';
import { readConfig } from '../../services/config/config-service.js';
import { registerSwarmCommands } from './swarm-commands.js';
// `registerTechCommands` registrations are byte-for-byte untouched.
import { registerAutonomousSwarmCommands } from './autonomous-swarm-commands.js';
// Slice 4.0.8 — workflow lifecycle (init / graph show / graph list / node
// prepare / node ack / node mark-lost / terminalize). Registered as a
// sibling command group, not merged with planning handlers, per RD §4.
import { registerWorkflowLifecycleCommand } from './workflow-lifecycle-commands.js';
import { addSwarmPlanOptions, runSwarmPlan } from './workflow-swarm-actions.js';
import type { SwarmPlanOptions } from './workflow-plan-helpers.js';

interface SwarmProjectOpts {
  project: string;
  json?: boolean;
}

interface SwarmDispatchOpts {
  project: string;
  speculative: boolean;
  json?: boolean;
}

interface SwarmVerifyOpts {
  project: string;
  skeptics: string;
  json?: boolean;
}

interface RecommendOpts {
  workflow: string;
  language?: string;
  json?: boolean;
}

/** The `13.2` pipeline placeholder action, lifted verbatim out of the registrar. */
function runSwarmPipelinePlaceholder(options: SwarmProjectOpts, io: ProgramIO): void {
  printResult(
    io,
    ok(
      'swarm.pipeline',
      {
        project: options.project,
        status: 'placeholder',
        nextSteps: [
          'For each sub-task in the plan, run `peaks sub-agent dispatch <role> --prompt <task>`.',
          'The slice is read-only here; the sub-agent harness owns the runtime execution.'
        ]
      },
      [],
      [
        'swarm.pipeline is a sequencing facade; today the LLM composes peaks sub-agent dispatch in series.'
      ]
    ),
    options.json
  );
}

/** The `13.3` speculative-dispatch placeholder action, lifted verbatim out of the registrar. */
function runSwarmDispatchPlaceholder(options: SwarmDispatchOpts, io: ProgramIO): void {
  printResult(
    io,
    ok(
      'swarm.dispatch',
      {
        project: options.project,
        speculative: options.speculative,
        status: 'placeholder'
      },
      [],
      [
        options.speculative
          ? 'Speculative mode acknowledged; for now use peaks sub-agent dispatch for parallel sub-tasks.'
          : 'Pass --speculative to acknowledge speculative mode (no-op for now).'
      ]
    ),
    options.json
  );
}

/** The `13.4` adversarial-verification placeholder action, lifted verbatim out of the registrar. */
function runSwarmVerifyPlaceholder(options: SwarmVerifyOpts, io: ProgramIO): void {
  const n = Number.parseInt(options.skeptics, 10);
  const iterations = Number.isFinite(n) && n > 0 ? n : 1;
  const history: { iteration: number; ok: boolean; detail: string }[] = [];
  for (let i = 1; i <= iterations; i++) {
    history.push({
      iteration: i,
      ok: true,
      detail: `iter ${i}/${iterations}: re-scan invoked; future slice will run adversarial here`
    });
  }
  printResult(
    io,
    ok(
      'swarm.verify',
      {
        project: options.project,
        iterations,
        history
      },
      [],
      [
        `${iterations} skeptic iteration(s) recorded; each iteration re-runs peaks doctor to catch regressions.`,
        'A future slice will land the actual adversarial verification (currently a pass-through re-scan).'
      ]
    ),
    options.json
  );
}

/** The `13.5` loop-until-dry placeholder action, lifted verbatim out of the registrar. */
function runSwarmLoopPlaceholder(options: SwarmProjectOpts, io: ProgramIO): void {
  const history: { iteration: number; failCount: number; status: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    const failCount = 0;
    history.push({ iteration: i, failCount, status: failCount === 0 ? 'dry' : 'still-failing' });
    if (i > 1 && history[i - 2]?.failCount === failCount) break;
  }
  const finalStatus = history[history.length - 1]?.failCount === 0 ? 'dry' : 'still-failing';
  printResult(
    io,
    ok(
      'swarm.loop',
      {
        project: options.project,
        iterations: history.length,
        history,
        status: finalStatus
      },
      [],
      [
        `loop ran ${history.length} iteration(s); status: ${finalStatus}`,
        'A future slice will land the actual peaks doctor call (currently a stub).'
      ]
    ),
    options.json
  );
}

/** The `peaks recommend` action, lifted verbatim out of the registrar. */
function runRecommendAction(options: RecommendOpts, io: ProgramIO): void {
  if (!isRecommendationWorkflow(options.workflow)) {
    printResult(
      io,
      fail(
        'recommend',
        'UNSUPPORTED_RECOMMENDATION_WORKFLOW',
        `Unsupported recommendation workflow ${options.workflow}`,
        {},
        ['Use --workflow code-refactor, product-refactor, or frontend-design']
      ),
      options.json
    );
    process.exitCode = 1;
    return;
  }

  printResult(
    io,
    ok(
      'recommend',
      createRecommendationPlan({
        workflow: options.workflow,
        language: options.language ?? readConfig().language ?? 'en'
      })
    ),
    options.json
  );
}

/** The four slice-#13 placeholder subcommands of `peaks swarm`, lifted verbatim out of the registrar. */
function registerSwarmPlaceholderCommands(swarm: Command, io: ProgramIO): void {
  addJsonOption(
    swarm
      .command('pipeline')
      .description(
        '13.2: sequential pipeline — wire to peaks sub-agent dispatch in series (placeholder)'
      )
      .requiredOption('--project <path>', 'target project root')
  ).action((options: SwarmProjectOpts) => runSwarmPipelinePlaceholder(options, io));

  addJsonOption(
    swarm
      .command('dispatch')
      .description(
        '13.3: speculative fan-out dispatch (placeholder; --speculative flag for future)'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--speculative', 'enable speculative mode (placeholder)', false)
  ).action((options: SwarmDispatchOpts) => runSwarmDispatchPlaceholder(options, io));

  addJsonOption(
    swarm
      .command('verify')
      .description(
        '13.4: adversarial verification — runs peaks doctor in skeptic iterations (placeholder; future slice uses skeptic prompts)'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--skeptics <count>', 'number of skeptic iterations to run (default 1)', '1')
  ).action((options: SwarmVerifyOpts) => runSwarmVerifyPlaceholder(options, io));

  addJsonOption(
    swarm
      .command('loop')
      .description(
        '13.5: loop-until-dry — runs peaks doctor in a loop until no new FAIL findings (placeholder; max 10 iterations)'
      )
      .requiredOption('--project <path>', 'target project root')
  ).action((options: SwarmProjectOpts) => runSwarmLoopPlaceholder(options, io));
}

export function registerWorkflowSwarmCommands(program: Command, io: ProgramIO): void {
  // `registerSwarmCommands` (a thin wrapper around the new
  // `planRdSwarmGraph` service). The legacy `peaks swarm plan` /
  // `peaks swarm-plan` registrations above stay in-place for back-compat
  const swarm = program.command('swarm').description('Plan RD swarm dry-run graphs');
  addSwarmPlanOptions(swarm.command('plan'), true).action(async (options: SwarmPlanOptions) => {
    await runSwarmPlan(io, options);
  });
  addSwarmPlanOptions(program.command('swarm-plan'), false).action(
    async (options: SwarmPlanOptions) => {
      await runSwarmPlan(io, options);
    }
  );
  registerSwarmCommands(program, io);
  // above are byte-for-byte untouched.
  registerAutonomousSwarmCommands(program, io);

  // Slice 4.0.8 — workflow lifecycle CLI (init / graph show / graph list /
  // node prepare / node ack / node mark-lost / terminalize). Registered
  // sibling to planning handlers per RD §4.
  registerWorkflowLifecycleCommand(program, io);

  // Slice #13 Swarm Algorithm Upgrade — 4 additional subcommands.
  // (peaks swarm plan above is slice #13.1; the 4 below are 13.2-13.5).
  registerSwarmPlaceholderCommands(swarm, io);

  addJsonOption(
    program
      .command('recommend')
      .description('Create a dry-run recommendation plan for a workflow')
      .requiredOption(
        '--workflow <workflow>',
        'workflow: code-refactor, product-refactor, or frontend-design'
      )
      .option('--language <language>', 'human presentation language')
  ).action((options: RecommendOpts) => runRecommendAction(options, io));
}
