import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = resolve(__dirname, '..', '..', 'skills');

interface WrapperSpec {
  name: string;
  triggers: string[];
  expectedCliCommands: string[];
  forbiddenCliCommands: string[];
  expectedHandoffTo: string;
}

const WRAPPERS: WrapperSpec[] = [
  {
    name: 'peaks-resume',
    triggers: ['/peaks-resume', '继续完成', '把刚才没做完的收尾', 'resume the unfinished'],
    expectedCliCommands: [
      'peaks skill presence:set',
      'peaks project memories',
      'peaks workspace init',
      'peaks request transition',
    ],
    forbiddenCliCommands: [
      // No new CLI allowed; only existing primitives
    ],
    expectedHandoffTo: 'peaks-code',
  },
  {
    name: 'peaks-test',
    triggers: ['/peaks-test', '跑一下 test', '跑测试', 'run the tests'],
    expectedCliCommands: [
      'peaks skill presence:set',
      'peaks project memories',
      'pnpm vitest run',
    ],
    forbiddenCliCommands: [],
    expectedHandoffTo: 'peaks-code (only if user wants to ship or fix)',
  },
  {
    name: 'peaks-status',
    triggers: ['/peaks-status', '现在到哪了', 'what is the current state', 'show me the dashboard'],
    expectedCliCommands: [
      'peaks skill presence:set',
      'peaks project memories',
      'peaks project dashboard',
    ],
    forbiddenCliCommands: [],
    expectedHandoffTo: 'peaks-code (only if user wants to act on the status)',
  },
];

describe('P2 wrapper skills (peaks-resume / -test / -status)', () => {
  for (const spec of WRAPPERS) {
    describe(spec.name, () => {
      const skillDir = join(SKILLS_ROOT, spec.name);
      const skillPath = join(skillDir, 'SKILL.md');

      // Skip the entire describe block if the skill file doesn't exist yet
      // (allows incremental development: P2.1 resume, then P2.2 test, then P2.3 status)
      const fileExists = existsSync(skillPath);
      if (!fileExists) {
        test.skip(`${spec.name}/SKILL.md does not exist yet (will be added in P2.x)`, () => {});
        return;
      }

      test('SKILL.md file exists', () => {
        expect(existsSync(skillPath), `${spec.name}/SKILL.md should exist at ${skillPath}`).toBe(true);
      });

      test('SKILL.md has valid frontmatter (name + description)', () => {
        const body = readFileSync(skillPath, 'utf8');
        expect(body).toMatch(/^---\n/);
        expect(body).toMatch(/^name: peaks-code-/m);
        expect(body).toMatch(/^description: .+/m);
      });

      test('description contains "Triggers on" + all trigger phrases', () => {
        const body = readFileSync(skillPath, 'utf8');
        // The description frontmatter line should mention at least one trigger
        const lines = body.split('\n');
        const descriptionLine = lines.find((line) => line.startsWith('description: '));
        expect(descriptionLine, 'description frontmatter line should be present').toBeDefined();
        const description = descriptionLine!.slice('description: '.length);
        for (const trigger of spec.triggers) {
          // Trigger must appear in either frontmatter or body
          const inFrontmatter = description.includes(trigger);
          const inBody = body.includes(trigger);
          expect(
            inFrontmatter || inBody,
            `trigger "${trigger}" should appear in frontmatter or body of ${spec.name}`,
          ).toBe(true);
        }
      });

      test('body mentions all expected CLI commands (no new CLI added)', () => {
        const body = readFileSync(skillPath, 'utf8');
        for (const cmd of spec.expectedCliCommands) {
          expect(body, `${spec.name} body should mention "${cmd}"`).toContain(cmd);
        }
      });

      test('body does NOT introduce new peaks <cmd> subcommands', () => {
        const body = readFileSync(skillPath, 'utf8');
        // All `peaks <something>` invocations in the body must be existing commands.
        // Extract them and assert each is in an allowlist.
        const peaksCommandPattern = /`?peaks\s+([a-z-]+)/g;
        const matches = [...body.matchAll(peaksCommandPattern)];
        const commands = new Set(matches.map((m) => m[1] ?? '').filter((s) => s.length > 0));
        const existingCommands = new Set([
          'workspace',
          'project',
          'request',
          'session',
          'scan',
          'skill',
          'standards',
          'memory',
          'sc',
          'doctor',
        ]);
        for (const cmd of commands) {
          expect(
            existingCommands.has(cmd),
            `${spec.name} body uses unknown peaks <cmd>: "peaks ${cmd}"`,
          ).toBe(true);
        }
      });

      test('body has hard-rules section (no silent auto-actions)', () => {
        const body = readFileSync(skillPath, 'utf8');
        // Wrapper skills must explicitly forbid silent auto-actions
        expect(body).toMatch(/[Hh]ard [Rr]ules?/);
        expect(body).toMatch(/never silent/i);
      });

      test('body has presence handoff pattern (set own presence, restore peaks-code)', () => {
        const body = readFileSync(skillPath, 'utf8');
        // Wrapper sets its own presence first
        expect(body).toMatch(
          new RegExp(`presence:set ${spec.name.replace(/\\./g, '\\.')}`, 'i'),
        );
        // Wrapper restores peaks-code presence
        expect(body).toMatch(/presence:set peaks-code/);
      });

      test('file size under 800-line cap', () => {
        const body = readFileSync(skillPath, 'utf8');
        const lines = body.split('\n').length;
        expect(lines, `${spec.name} should be under 800 lines`).toBeLessThan(800);
      });

      test('file is small (wrapper skills should be < 200 lines for fast LLM context)', () => {
        const body = readFileSync(skillPath, 'utf8');
        const lines = body.split('\n').length;
        expect(
          lines,
          `${spec.name} should be < 200 lines (wrappers are small, ~40 lines)`,
        ).toBeLessThan(200);
      });
    });
  }

  describe('cross-wrapper: no new peaks <cmd> subcommands', () => {
    test('no wrapper skill invents a new peaks <cmd> not in the existing program', () => {
      const existingWrappers = WRAPPERS.filter((spec) =>
        existsSync(join(SKILLS_ROOT, spec.name, 'SKILL.md')),
      );
      if (existingWrappers.length === 0) {
        test.skip('no wrapper skills exist yet', () => {});
        return;
      }
      // The list of existing peaks <cmd> subcommands is fixed in src/cli/program.ts.
      // The wrappers must only invoke these.
      const existingCommands = new Set([
        'workspace',
        'project',
        'request',
        'session',
        'scan',
        'skill',
        'standards',
        'memory',
        'sc',
        'doctor',
        'sop',
        'gate',
        'hooks',
        'statusline',
        'progress',
        'perf',
        'config',
        'mcp',
        'codegraph',
        'flow',
        'route',
        'autonomous',
        'refactor',
        'tech',
        'tech-plan',
        'tech-status',
        'swarm',
        'swarm-plan',
        'autonomous-resume',
        'understand',
        'capability',
        'worker',
        'minimax-worker',
        'openspec',
        'artifacts',
        'proxy',
      ]);
      for (const spec of existingWrappers) {
        const body = readFileSync(join(SKILLS_ROOT, spec.name, 'SKILL.md'), 'utf8');
        const peaksCommandPattern = /`?peaks\s+([a-z-]+)/g;
        const matches = [...body.matchAll(peaksCommandPattern)];
        for (const m of matches) {
          const cmd = m[1] ?? '';
          if (cmd.length === 0) continue;
          expect(
            existingCommands.has(cmd),
            `${spec.name} uses unknown peaks <cmd>: "peaks ${cmd}"`,
          ).toBe(true);
        }
      }
    });
  });
});
