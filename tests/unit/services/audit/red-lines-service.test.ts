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
    // (Removed in v2.11.0 Group A: tech-doc-presence.ts stub — the enforcer was deleted.)
    writeFileSync(join(projectRoot, 'src/services/audit/enforcers/mock-placement.ts'), '// stub');

    const result = runRedLinesAudit({ projectRoot });
    expect(result.audit.totalRedLines).toBeGreaterThanOrEqual(3);
    // v2.12.1 catalog governance: tallies include `informational` for
    // discovered prose-only entries (no catalog match). The invariant
    // is now `cliBacked + partial + proseOnly + informational === total`.
    const informational = result.audit.audit.filter((e) => e.informational).length;
    expect(result.audit.cliBacked + result.audit.partial + result.audit.proseOnly + informational).toBe(result.audit.totalRedLines);
  });

  it('produces a warning when sub-agent-sid enforcer finds an invalid sid', () => {
    mkdirSync(join(projectRoot, '.peaks/_sub_agents/sid-3'), { recursive: true });
    const result = runRedLinesAudit({ projectRoot });
    const sidWarning = result.warnings.find((w) => w.file === '.peaks/_sub_agents/sid-3');
    expect(sidWarning).toBeDefined();
    expect(sidWarning?.message).toContain('invalid sub-agent sid');
  });

  it('tally: cliBacked + partial + proseOnly + informational === totalRedLines (v2.12.1)', () => {
    mkdirSync(join(projectRoot, 'skills/peaks-solo'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'skills/peaks-solo/SKILL.md'),
      '# peaks-solo\n\nBLOCKING step here.\n',
    );
    mkdirSync(join(projectRoot, 'src/services/audit/enforcers'), { recursive: true });
    writeFileSync(join(projectRoot, 'src/services/audit/enforcers/solo-code-ban.ts'), '// stub');

    const result = runRedLinesAudit({ projectRoot });
    const informational = result.audit.audit.filter((e) => e.informational).length;
    expect(result.audit.cliBacked + result.audit.partial + result.audit.proseOnly + informational).toBe(result.audit.totalRedLines);
  });

  it('v2.12.1 catalog governance: discovered entries are informational and excluded from proseOnly ratio', () => {
    // Write a SKILL.md with a MANDATORY phrase that has no catalog match.
    // Pre-v2.12.1: this entry counted as prose-only (inflating the ratio).
    // v2.12.1: it's `informational: true` so the tally excludes it from
    // `proseOnly`. The total still includes it.
    mkdirSync(join(projectRoot, 'skills/peaks-zzz-test'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'skills/peaks-zzz-test/SKILL.md'),
      '# peaks-zzz-test\n\nSome MANDATORY phrase that does not match any catalog entry at all.\n',
    );

    const result = runRedLinesAudit({ projectRoot });
    const discovered = result.audit.audit.filter((e) => e.id.startsWith('rl-discovered-'));
    expect(discovered.length).toBeGreaterThan(0);
    for (const e of discovered) {
      expect(e.backing).toBe('prose-only');
      expect(e.informational).toBe(true);
    }
  });
});
