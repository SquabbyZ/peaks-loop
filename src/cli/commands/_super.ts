import type { Command } from 'commander';
import type { ProgramIO } from '../cli-helpers.js';

export interface SuperRouteData {
  routedSkill: string;
  confidence: number;
  alternatives: string[];
  rationale: string;
  nextActions: string[];
}

type Route = { skill: string; words: string[] };
const ROUTES: Record<string, Route[]> = {
  make: [
    { skill: 'peaks-code', words: ['code', 'implement', 'refactor', 'cli', 'bug', 'feature'] },
    { skill: 'peaks-content', words: ['blog', 'article', 'post', 'newsletter', 'copy'] },
    { skill: 'peaks-doctor', words: ['audit', 'health', 'doctor', 'project health'] },
    { skill: 'peaks-issue-fix-orchestrator', words: ['fix issues', 'open issues', 'issue sweep'] }
  ],
  learn: [
    { skill: 'peaks-sop', words: ['sop', 'procedure', 'checklist', 'runbook'] },
    { skill: 'peaks-solo sediment', words: ['lesson', 'memory', 'sediment', 'learn from'] }
  ],
  check: [
    { skill: 'peaks-audit', words: ['red-lines', 'red lines', 'audit'] },
    { skill: 'peaks-doctor', words: ['doctor', 'health', 'health check'] },
    { skill: 'peaks-security-audit', words: ['security', 'vulnerability', 'vuln', 'secret'] }
  ],
  run: [
    { skill: 'peaks-workflow', words: ['workflow', 'pipeline', 'flow'] },
    { skill: 'peaks-job', words: ['job', 'slice', 'batch'] },
    { skill: 'peaks-dispatch', words: ['dispatch', 'sub-agent', 'sub agent', 'agent'] }
  ]
};

function envelope(command: string, data: SuperRouteData): string {
  return JSON.stringify({ ok: true, data, warnings: [], nextActions: data.nextActions });
}

function route(command: string, input: string): SuperRouteData {
  const normalized = input.trim().toLowerCase();
  const candidates = ROUTES[command] ?? [];
  const selected = candidates.find((candidate) => candidate.words.some((word) => normalized.includes(word)));
  const chosen = selected ?? candidates[0];
  if (chosen === undefined) {
    return {
      routedSkill: 'peaks-solo',
      confidence: 0,
      alternatives: [],
      rationale: 'No route candidates are configured',
      nextActions: ['LLM: dispatch peaks-solo with this goal']
    };
  }
  const alternatives = candidates.filter((candidate) => candidate !== chosen).map((candidate) => candidate.skill);
  const confidence = selected === undefined ? 0.25 : 0.92;
  const rationale = selected === undefined
    ? 'No route keyword matched; default candidate selected for LLM arbitration'
    : `Natural-language ${command} intent matches the ${chosen.skill} route`;
  return {
    routedSkill: chosen.skill,
    confidence,
    alternatives,
    rationale,
    nextActions: [`LLM: dispatch ${chosen.skill} sub-agent with this goal`]
  };
}

function registerRouted(program: Command, io: ProgramIO, name: string, argument: string): void {
  program.command(`${name} <${argument}>`).description(`Route a natural-language ${argument} to the appropriate Peaks skill`).action((value: string) => {
    const input = value.trim();
    if (!input) {
      io.stdout(JSON.stringify({ ok: false, command: `super.${name}`, code: 'MISSING_ARG', message: `${argument} must not be blank`, data: {}, warnings: [], nextActions: [] }));
      process.exitCode = 1;
      return;
    }
    const data = route(name, input);
    io.stdout(envelope(`super.${name}`, data));
  });
}

function registerFixed(program: Command, io: ProgramIO, name: string, skill: string, description: string): void {
  program.command(name).description(description).action(() => {
    const data: SuperRouteData = {
      routedSkill: skill,
      confidence: 1,
      alternatives: [],
      rationale: `Fixed operator handoff for ${skill}`,
      nextActions: [`LLM: dispatch ${skill} sub-agent`]
    };
    io.stdout(envelope(`super.${name}`, data));
  });
}

function registerAsk(program: Command, io: ProgramIO): void {
  program.command('ask <question>').description('Route a free-form question to the Peaks solo dispatcher').action((question: string) => {
    const input = question.trim();
    if (!input) {
      io.stdout(JSON.stringify({ ok: false, command: 'super.ask', code: 'MISSING_ARG', message: 'question must not be blank', data: {}, warnings: [], nextActions: [] }));
      process.exitCode = 1;
      return;
    }
    io.stdout(envelope('super.ask', { routedSkill: 'peaks-solo', confidence: 1, alternatives: [], rationale: 'Free-form question delegated to the Peaks solo dispatcher', nextActions: ['LLM: dispatch peaks-solo with this question'] }));
  });
}

export function registerSuperCommands(program: Command, io: ProgramIO): void {
  registerRouted(program, io, 'make', 'goal');
  registerRouted(program, io, 'learn', 'kind');
  registerRouted(program, io, 'check', 'target');
  registerRouted(program, io, 'run', 'workflow');
  registerFixed(program, io, 'share', 'peaks-sub-agent-share', 'Hand off a sharing operation');
  registerFixed(program, io, 'version', 'peaks-version', 'Return the current Peaks version');
  registerAsk(program, io);
  registerFixed(program, io, 'status', 'peaks-status', 'Show current Peaks workflow status');
}
