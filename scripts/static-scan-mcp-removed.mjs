#!/usr/bin/env node
// Slice #016 static scan: assert the peaks-loop MCP subsystem is fully removed.
//
// Walks:
//   - skills/peaks-*/*.md           (SKILL.md bodies for the 12 peaks-* skills)
//   - skills/peaks-*/references/*.md (reference docs cited by SKILL.md files)
//   - src/cli/program.ts            (CLI registration surface)
//
// Asserts the four invariants from the tech-doc (Change1):
//   1. No SKILL.md / reference file contains the deleted `peaks mcp *` verbs.
//   2. No SKILL.md file contains a baked MCP prefix that bypasses the tool list.
//   3. src/cli/program.ts does NOT import from ./commands/mcp-commands.js.
//   4. src/services/mcp/ directory does NOT exist on disk.
//
// Exits 0 on success, 1 on any violation. Output is plain text so the test
// wrapper can re-assert on the same data.
//
// This is a delete-side counterpart to slice #007-007's MCP-decouple scan
// (asserts the residue is gone rather than asserts the prefix is in use).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// scripts/ lives at <repo>/scripts/; the repo root is one level up.
const REPO_ROOT = resolve(__dirname, '..');

const SKILL_DIR = join(REPO_ROOT, 'skills');
const PROGRAM_TS = join(REPO_ROOT, 'src', 'cli', 'program.ts');
const MCP_SERVICE_DIR = join(REPO_ROOT, 'src', 'services', 'mcp');

const FORBIDDEN_VERBS = [
  'peaks mcp plan',
  'peaks mcp apply',
  'peaks mcp call',
  'peaks mcp list',
  'peaks mcp rollback',
  'peaks mcp scan',
  // The capability install registry identifier that the deleted scan-service exported.
  'mcp-install-registry',
];

const BAKED_PREFIXES = [
  'mcp__playwright__',
  'mcp__chrome_devtools__',
  'mcp__Figma_AI_Bridge__',
  'mcp__plugin_context7_context7__',
];

/**
 * Enumerate every SKILL.md and reference doc under skills/peaks-*.
 * Defensive against non-existent dirs; returns [] for missing roots.
 */
function listSkillFiles(root) {
  if (!existsSync(root)) return [];
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = join(root, entry.name, 'SKILL.md');
    if (existsSync(skillMd)) out.push(skillMd);
    const refsDir = join(root, entry.name, 'references');
    if (existsSync(refsDir) && statSync(refsDir).isDirectory()) {
      for (const refEntry of readdirSync(refsDir, { withFileTypes: true })) {
        if (refEntry.isFile() && refEntry.name.endsWith('.md')) {
          out.push(join(refsDir, refEntry.name));
        }
      }
    }
  }
  return out;
}

function scan() {
  const violations = [];
  const files = listSkillFiles(SKILL_DIR);

  // Invariant 1: no peaks mcp * verbs in any SKILL.md or reference file.
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const verb of FORBIDDEN_VERBS) {
      if (text.includes(verb)) {
        violations.push({
          file,
          invariant: 1,
          rule: `forbidden verb ${verb}`,
        });
      }
    }
  }

  // Invariant 2: no baked MCP prefixes in any SKILL.md (references are
  // allowed to document the prefix as informational; the LLM is the one
  // supposed to be checking its own tool list, so a SKILL.md that bakes
  // the prefix bypasses the design).
  for (const file of files) {
    if (!file.endsWith(`SKILL.md`)) continue;
    const text = readFileSync(file, 'utf8');
    for (const prefix of BAKED_PREFIXES) {
      if (text.includes(prefix)) {
        violations.push({
          file,
          invariant: 2,
          rule: `baked MCP prefix ${prefix}`,
        });
      }
    }
  }

  // Invariant 3: program.ts does not import from mcp-commands.js.
  if (existsSync(PROGRAM_TS)) {
    const programText = readFileSync(PROGRAM_TS, 'utf8');
    if (programText.includes(`from './commands/mcp-commands.js'`) ||
        programText.includes(`from "./commands/mcp-commands.js"`)) {
      violations.push({
        file: PROGRAM_TS,
        invariant: 3,
        rule: 'program.ts still imports mcp-commands.js',
      });
    }
    if (programText.includes('registerMcpCommands')) {
      violations.push({
        file: PROGRAM_TS,
        invariant: 3,
        rule: 'program.ts still references registerMcpCommands',
      });
    }
  } else {
    violations.push({
      file: PROGRAM_TS,
      invariant: 3,
      rule: 'program.ts missing on disk',
    });
  }

  // Invariant 4: src/services/mcp/ directory does not exist.
  if (existsSync(MCP_SERVICE_DIR)) {
    violations.push({
      file: MCP_SERVICE_DIR,
      invariant: 4,
      rule: 'src/services/mcp/ directory still exists on disk',
    });
  }

  return { violations, filesScanned: files.length };
}

const { violations, filesScanned } = scan();
if (violations.length === 0) {
  process.stdout.write(`mcp-subsystem-removed scan OK (${filesScanned} skill files scanned, 0 violations)\n`);
  process.exit(0);
}

process.stdout.write(`mcp-subsystem-removed scan FAILED (${violations.length} violations):\n`);
for (const v of violations) {
  process.stdout.write(`  [invariant ${v.invariant}] ${v.file} — ${v.rule}\n`);
}
process.exit(1);
