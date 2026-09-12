// tests/unit/services/prd/project-scan-bootstrap-service.test.ts
//
// Guards the SECTION PLACEMENT of the `Frontend-only` row in the generated
// `.peaks/project-scan/project-scan.md`. The three parties that must agree:
//   - generator: src/services/prd/project-scan-bootstrap-service.ts (this test)
//   - template:  skills/peaks-code/references/project-scan-checklist.md §6
//   - reader:    skills/peaks-code/references/swarm-dispatch-contract.md
//                §"Swarm gate" step 3
// All three say `## Project mode`. Before this guard the generator wrote the
// row under `## Archetype` and nothing noticed.
//
// Dimensions:
//   - render: the generated markdown's section shape (covered)
//   - behavior: omitted — no return-value transition is under test
//   - integration: omitted — the only boundary is a real temp dir; no
//     network / subprocess / clock is controlled
//   - a11y: omitted — no user-visible text or exit code

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { bootstrapProjectScan } from '~/src/services/prd/project-scan-bootstrap-service';

declareDimensions(
  'tests/unit/services/prd/project-scan-bootstrap-service.test.ts',
  ['render'],
  [
    { dim: 'behavior', reason: 'asserts generated markdown shape, not a return-value transition' },
    { dim: 'integration', reason: 'real temp dir only; no network / subprocess / clock control' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' },
  ],
);

const tempRoots: string[] = [];

function makeRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** Body of `## <heading>`, up to the next `## ` heading. */
function section(markdown: string, heading: string): string {
  const marker = `## ${heading}`;
  const start = markdown.indexOf(marker);
  if (start === -1) throw new Error(`section not found: ${marker}`);
  const rest = markdown.slice(start + marker.length);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

function readScan(projectRoot: string): string {
  return readFileSync(join(projectRoot, '.peaks', 'project-scan', 'project-scan.md'), 'utf8');
}

/** Markdown table row whose first cell is exactly `label`. */
function rowPattern(label: string): RegExp {
  return new RegExp(`^\\| ${label} \\|`, 'm');
}

describe('Scenario: render — generated project-scan.md section placement', () => {
  it('when the project is 0-1, should place Frontend-only under ## Project mode and not under ## Archetype', async () => {
    // given: a 0-1 project root (no package.json, no source files)
    const root = makeRoot('peaks-scan-0to1-');

    // when: the bootstrap runs (0-1 stub path)
    await bootstrapProjectScan({ projectRoot: root });

    // then: the row is present under ## Project mode, absent from ## Archetype
    const scan = readScan(root);
    const projectMode = section(scan, 'Project mode');
    expect(projectMode).toMatch(rowPattern('Frontend-only'));
    expect(projectMode).toMatch(/\| Frontend-only \|[^\n]*\n\| Reason \|/);
    expect(section(scan, 'Archetype')).not.toContain('Frontend-only');
  });

  it('when the project has package.json and source, should place Frontend-only under ## Project mode and not under ## Archetype', async () => {
    // given: an existing project root
    const root = makeRoot('peaks-scan-real-');
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { react: '^18.0.0' } }),
      'utf8',
    );
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'main.tsx'), 'export const x = 1;\n', 'utf8');

    // when: the bootstrap runs (real archetype-report path)
    const envelope = await bootstrapProjectScan({ projectRoot: root });

    // then: the real path was taken and the row is present under ## Project mode only
    expect(envelope.archetype).not.toBe('unknown');
    const scan = readScan(root);
    const projectMode = section(scan, 'Project mode');
    expect(projectMode).toMatch(rowPattern('Integration mode'));
    expect(projectMode).toMatch(rowPattern('Frontend-only'));
    expect(projectMode).toMatch(/\| Frontend-only \|[^\n]*\n\| Reason \|/);
    expect(section(scan, 'Archetype')).not.toContain('Frontend-only');
  });

  it('when a scan is generated, should keep Type and Confidence under ## Archetype', async () => {
    // given: a 0-1 project root
    const root = makeRoot('peaks-scan-archetype-');

    // when: the bootstrap runs
    await bootstrapProjectScan({ projectRoot: root });

    // then: ## Archetype is not gutted — it still carries the classification rows
    const archetype = section(readScan(root), 'Archetype');
    expect(archetype).toMatch(rowPattern('Type'));
    expect(archetype).toMatch(rowPattern('Confidence'));
  });

  it('when the scan docs are read, should bind frontendOnly to ## Project mode in every party', () => {
    // given: the template, the reader, and the writer-guidance that describe the scan
    const parties = [
      'skills/peaks-code/references/project-scan-checklist.md',
      'skills/peaks-code/references/swarm-dispatch-contract.md',
      'skills/peaks-code/references/frontend-only-mode.md',
    ];

    // when: each file is scanned for a frontendOnly ↔ ## Archetype binding
    // then: none exists — the boolean belongs to ## Project mode everywhere
    for (const rel of parties) {
      const body = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(body).not.toMatch(/frontendOnly[^\n]*## Archetype/);
    }
  });
});
