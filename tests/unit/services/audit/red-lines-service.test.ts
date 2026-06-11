import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRedLinesAudit } from '../../../../src/services/audit/red-lines-service.js';

describe('red-lines-service.runRedLinesAudit', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-service-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns empty audit when no source trees exist', () => {
    const result = runRedLinesAudit({ projectRoot });
    expect(result.audit.totalRedLines).toBe(0);
    expect(result.audit.cliBacked).toBe(0);
    expect(result.audit.partial).toBe(0);
    expect(result.audit.proseOnly).toBe(0);
  });

  it('classifies red lines from skills/, .claude/rules/, openspec/changes/', () => {
    mkdirSync(join(projectRoot, 'skills/peaks-solo'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'skills/peaks-solo/SKILL.md'),
      '# peaks-solo\n\npeaks-solo is an orchestrator. One conversation = one sid. BLOCKING rule.\n',
    );
    mkdirSync(join(projectRoot, '.claude/rules/common'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.claude/rules/common/security.md'),
      '# security\n\nThis is MANDATORY for all commits.\n',
    );
    mkdirSync(join(projectRoot, 'openspec/changes/2026-06-11-foo'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'openspec/changes/2026-06-11-foo/proposal.md'),
      '# proposal\n\nYou MUST NOT skip the tech-doc.\n',
    );
    // Stub the enforcer file so the catalog match is backed.
    mkdirSync(join(projectRoot, 'src/services/audit/enforcers'), { recursive: true });
    writeFileSync(join(projectRoot, 'src/services/audit/enforcers/sub-agent-sid.ts'), '// stub');
    writeFileSync(join(projectRoot, 'src/services/audit/enforcers/tech-doc-presence.ts'), '// stub');
    writeFileSync(join(projectRoot, 'src/services/audit/enforcers/mock-placement.ts'), '// stub');

    const result = runRedLinesAudit({ projectRoot });
    expect(result.audit.totalRedLines).toBeGreaterThanOrEqual(3);
    expect(result.audit.cliBacked + result.audit.partial + result.audit.proseOnly).toBe(result.audit.totalRedLines);
  });

  it('produces a warning when sub-agent-sid enforcer finds an invalid sid', () => {
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/sid-3'), { recursive: true });
    const result = runRedLinesAudit({ projectRoot });
    const sidWarning = result.warnings.find((w) => w.file === '.peaks/_sub_agents/sid-3');
    expect(sidWarning).toBeDefined();
    expect(sidWarning?.message).toContain('invalid sub-agent sid');
  });

  it('tally: cliBacked + partial + proseOnly === totalRedLines', () => {
    mkdirSync(join(projectRoot, 'skills/peaks-solo'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'skills/peaks-solo/SKILL.md'),
      '# peaks-solo\n\nBLOCKING step here.\n',
    );
    mkdirSync(join(projectRoot, 'src/services/audit/enforcers'), { recursive: true });
    writeFileSync(join(projectRoot, 'src/services/audit/enforcers/solo-code-ban.ts'), '// stub');

    const result = runRedLinesAudit({ projectRoot });
    expect(result.audit.cliBacked + result.audit.partial + result.audit.proseOnly).toBe(result.audit.totalRedLines);
  });
});
