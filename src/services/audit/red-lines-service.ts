/**
 * red-lines-service — main entry. Orchestrates the three tree scanners,
 * the classifier, and the backing detector, then assembles the final
 * RedLineAudit envelope.
 *
 * Pipeline (per openspec/changes/2026-06-11-l2-1-redlines-audit/design.md):
 *   1. Run all 3 scanners in parallel (skills, rules, openspec)
 *   2. Classifier turns MarkdownLine[] into RedLineEntry[]
 *   3. Backing detector re-classifies each entry (cli-backed vs partial vs prose-only)
 *   4. Tally + return RedLineAudit
 *
 * Sub-agent-sid enforcer (Task 2) is also invoked here: it dogfoods Slice 0.5
 * sid-naming-guard and adds any invalid sids as warnings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { classifyFiles } from './classifier.js';
import { classifyBackingBatch } from './backing-detector.js';
import { scanSkillsTree } from './scanners/skills-tree-scanner.js';
import { scanRulesTree } from './scanners/rules-tree-scanner.js';
import { scanOpenSpecTree } from './scanners/openspec-scanner.js';
import { findInvalidSubAgentSids, findInvalidRuntimeSids } from './enforcers/sub-agent-sid.js';
import { checkTechDocPresence } from './enforcers/tech-doc-presence.js';
import { findStubMarkers } from './enforcers/prototype-fidelity.js';
import { checkDesignDraftConfirmation } from './enforcers/design-draft-confirm.js';
import { checkPreRdScan } from './enforcers/pre-rd-scan.js';
import {
  readSkillFiles,
  lintSectionShape,
  lintSectionOrder,
  lintFrontmatterShape,
  lintReferenceLoadStrategy,
} from './enforcers/lint-style.js';
import {
  lintRefPathResolves,
  lintNoBrokenMkdir,
  lintNoPwdSymlinkJumps,
  lintNoRelativeArchivePaths,
} from './enforcers/lint-reference-integrity.js';
import {
  lintCliBackMandatorText,
  lintCliBackNoOrphanBlocking,
  lintCliBackNoOrphanMustNot,
} from './enforcers/lint-cli-back.js';
import {
  lintNoFluff,
  lintNoClosingPrompt,
  lintStatusHeader,
} from './enforcers/lint-output-style.js';
import {
  lintOpenSpecAcceptanceBullets,
  lintOpenSpecSpecReference,
  lintTechDocPresenceShape,
  lintPeaksDoctorAcknowledged,
} from './enforcers/lint-workflow-shape.js';
import {
  lintCatalogSize,
  lintCatalogProseOnlyRatio,
} from './enforcers/lint-catalog-governance.js';
import {
  lintH1TitleRequired,
  lintApplicableTaskLevels,
  lintSeeAlsoSection,
  lintCrossRefResolves,
  lintNoSelfReference,
  lintNoOrphanLink,
  lintLineCountLe800,
  lintH2CountLe12,
  lintOverviewNearTop,
  lintLoadStrategyOnDemandFallback,
  lintLoadStrategyAlwaysCacheable,
  lintNoBashHeredoc,
  lintNoSudo,
  lintNoCurlPipeBash,
  lintCodeBlockLanguage,
  lintNoFakePrompt,
  lintNoAbsolutePaths,
  lintNoChmod777,
  lintNoMagicNumbers,
  lintSkillCitesEveryReference,
  lintLoadStrategyMatchesSize,
  readReferenceFiles,
} from './enforcers/lint-reference-shape.js';
import {
  lintCatalogStability,
  lintNoOrphanEnforcer,
  lintNoOrphanCatalog,
  lintRuntimeBudget,
  readCatalogHistory,
} from './enforcers/lint-audit-regression.js';
import type { ClassifyFileInput } from './classifier.js';
import type { EnforcerFinding, RedLineAudit, RedLineEntry, ScanWarning } from './types.js';

export interface RedLinesServiceInput {
  readonly projectRoot: string;
}

export interface RedLinesServiceResult {
  readonly audit: RedLineAudit;
  readonly warnings: readonly ScanWarning[];
}

function buildFileInputs(
  skills: { lines: readonly { file: string; line: number; text: string }[] },
  rules: { lines: readonly { file: string; line: number; text: string }[] },
  openspec: { lines: readonly { file: string; line: number; text: string }[] },
): readonly ClassifyFileInput[] {
  const grouped = new Map<string, string[]>();
  for (const line of [...skills.lines, ...rules.lines, ...openspec.lines]) {
    const existing = grouped.get(line.file);
    if (existing) {
      // line numbers are 1-based; pad to ensure the right slot
      while (existing.length < line.line) existing.push('');
      existing[line.line - 1] = line.text;
    } else {
      const arr: string[] = [];
      while (arr.length < line.line - 1) arr.push('');
      arr.push(line.text);
      grouped.set(line.file, arr);
    }
  }
  return Array.from(grouped.entries()).map(([file, lines]) => ({ file, lines }));
}

function tally(entries: readonly RedLineEntry[]): {
  totalRedLines: number;
  cliBacked: number;
  partial: number;
  proseOnly: number;
} {
  let cliBacked = 0;
  let partial = 0;
  let proseOnly = 0;
  for (const entry of entries) {
    if (entry.backing === 'cli-backed') cliBacked++;
    else if (entry.backing === 'partial') partial++;
    else proseOnly++;
  }
  return {
    totalRedLines: entries.length,
    cliBacked,
    partial,
    proseOnly,
  };
}

export function runRedLinesAudit(input: RedLinesServiceInput): RedLinesServiceResult {
  // Capture the audit start time. The P2-b runtime-budget enforcer
  // uses this to assert that peaks audit red-lines completes in
  // < 2 seconds on a 100-reference project.
  const auditStartMs = Date.now();

  const skills = scanSkillsTree({ projectRoot: input.projectRoot });
  const rules = scanRulesTree({ projectRoot: input.projectRoot });
  const openspec = scanOpenSpecTree({ projectRoot: input.projectRoot });

  const fileInputs = buildFileInputs(skills, rules, openspec);
  const classified = classifyFiles(fileInputs);

  const backed = classifyBackingBatch(classified.entries, input.projectRoot);

  // Sub-agent-sid enforcer (Task 2): dogfoods Slice 0.5 sid-naming-guard.
  const subAgentSids = findInvalidSubAgentSids(input.projectRoot);
  const runtimeSids = findInvalidRuntimeSids(input.projectRoot);

  const warnings: ScanWarning[] = [
    ...skills.warnings,
    ...rules.warnings,
    ...openspec.warnings,
    ...classified.warnings.map((message) => ({ file: '(classifier)', message })),
    ...backed.warnings.map((message) => ({ file: '(backing-detector)', message })),
  ];

  if (subAgentSids.scanned && subAgentSids.invalid.length > 0) {
    for (const sid of subAgentSids.invalid) {
      warnings.push({
        file: '.peaks/_sub_agents/' + sid,
        message: `invalid sub-agent sid: "${sid}" (does not match isValidSessionId)`,
      });
    }
  }
  if (runtimeSids.scanned && runtimeSids.invalid.length > 0) {
    for (const sid of runtimeSids.invalid) {
      warnings.push({
        file: '.peaks/_runtime/' + sid,
        message: `invalid runtime sid: "${sid}" (does not match isValidSessionId)`,
      });
    }
  }

  const counts = tally(backed.entries);

  // L2.4 P2-b: invoke the 5 P0/P1 file-system enforcers during the scan.
  // Each enforcer function returns a structured result; we convert to
  // EnforcerFinding[] and add to the audit output. The audit scanner
  // actually CALLS the enforcers, not just catalogs them.
  const enforcerFindings: EnforcerFinding[] = [];

  // 1. sub-agent-sid (already partially handled via warnings; here we
  //    add a structured finding for the same data).
  if (subAgentSids.scanned && subAgentSids.invalid.length > 0) {
    for (const sid of subAgentSids.invalid) {
      enforcerFindings.push({
        enforcerId: 'rl-sub-agent-sid-001',
        rule: 'Sub-Agent SID Isolation',
        severity: 'fail',
        file: `.peaks/_sub_agents/${sid}`,
        detail: `invalid sub-agent sid: "${sid}" (does not match isValidSessionId)`,
      });
    }
  }
  if (runtimeSids.scanned && runtimeSids.invalid.length > 0) {
    for (const sid of runtimeSids.invalid) {
      enforcerFindings.push({
        enforcerId: 'rl-sub-agent-sid-001',
        rule: 'Sub-Agent SID Isolation',
        severity: 'fail',
        file: `.peaks/_runtime/${sid}`,
        detail: `invalid runtime sid: "${sid}" (does not match isValidSessionId)`,
      });
    }
  }

  // 2. tech-doc-presence — check the current session's tech-doc.md.
  //    The sessionId comes from the canonical session binding file
  //    (.peaks/_runtime/session.json) when present.
  const sessionJsonPath = `${input.projectRoot}/.peaks/_runtime/session.json`;
  if (existsSync(sessionJsonPath)) {
    try {
      const sessionData = JSON.parse(require('node:fs').readFileSync(sessionJsonPath, 'utf8')) as { peakSessionId?: string };
      if (typeof sessionData.peakSessionId === 'string' && sessionData.peakSessionId.length > 0) {
        const techDoc = checkTechDocPresence({ projectRoot: input.projectRoot, sessionId: sessionData.peakSessionId });
        if (!techDoc.exists) {
          enforcerFindings.push({
            enforcerId: 'rl-tech-doc-presence-001',
            rule: 'Tech-Doc Presence',
            severity: 'fail',
            file: techDoc.path,
            detail: 'tech-doc.md missing (rd → spec-locked transition will refuse)',
          });
        } else if (techDoc.isEmpty) {
          enforcerFindings.push({
            enforcerId: 'rl-tech-doc-presence-001',
            rule: 'Tech-Doc Presence',
            severity: 'fail',
            file: techDoc.path,
            detail: 'tech-doc.md is 0 bytes',
          });
        }
      }
    } catch {
      // skip malformed session.json
    }
  }

  // 3. pre-rd-scan — check whether project-scan.md and standards-preflight.json exist
  //    for the current session.
  if (existsSync(sessionJsonPath)) {
    try {
      const sessionData = JSON.parse(require('node:fs').readFileSync(sessionJsonPath, 'utf8')) as { peakSessionId?: string };
      if (typeof sessionData.peakSessionId === 'string' && sessionData.peakSessionId.length > 0) {
        const preRd = checkPreRdScan({ projectRoot: input.projectRoot, sessionId: sessionData.peakSessionId });
        if (!preRd.archetypeScanned) {
          enforcerFindings.push({
            enforcerId: 'rl-pre-rd-scan-001',
            rule: 'Pre-RD Scan: Archetype Detected',
            severity: 'warn',
            file: preRd.archetypeReportPath,
            detail: 'project-scan.md not produced; rd work has no archetype context',
          });
        }
        if (!preRd.standardsPreflightDone) {
          enforcerFindings.push({
            enforcerId: 'rl-pre-rd-scan-002',
            rule: 'Pre-RD Scan: Standards Preflight',
            severity: 'warn',
            file: preRd.standardsReportPath,
            detail: 'standards-preflight.json not produced; rd work has no project standards context',
          });
        }
      }
    } catch {
      // skip
    }
  }

  // 4. design-draft-confirm — check the current change-id's design-draft.md.
  //    The change-id is the .peaks/<changeId>/ui/design-draft.md path.
  //    For the audit, we look for any .peaks/*/ui/design-draft.md.
  const peaksDir = `${input.projectRoot}/.peaks`;
  if (existsSync(peaksDir)) {
    try {
      const entries = require('node:fs').readdirSync(peaksDir) as string[];
      for (const entry of entries) {
        if (entry === '_archive' || entry === '_runtime' || entry === '_sub_agents' || entry.startsWith('.')) continue;
        const designCheck = checkDesignDraftConfirmation({
          projectRoot: input.projectRoot,
          sessionId: '',
          changeId: entry,
        });
        if (designCheck.draftExists && !designCheck.confirmed) {
          enforcerFindings.push({
            enforcerId: 'rl-design-draft-confirm-002',
            rule: 'Design-Draft Confirm: Confirmed State',
            severity: 'warn',
            file: designCheck.draftPath,
            detail: 'design-draft.md exists but is not confirmed (no "confirmed" marker)',
          });
        }
      }
    } catch {
      // skip
    }
  }

  // 5. prototype-fidelity — scan recent src/ files for stub markers
  //    (TODO/FIXME/XXX). Limit to 50 most-recently-modified files
  //    to keep scan fast.
  try {
    const srcDir = `${input.projectRoot}/src`;
    if (existsSync(srcDir)) {
      const allFiles: string[] = [];
      const walk = (dir: string) => {
        const ents = require('node:fs').readdirSync(dir, { withFileTypes: true });
        for (const e of ents) {
          const full = `${dir}/${e.name}`;
          if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === 'dist') continue;
            walk(full);
          } else if (e.isFile() && /\.(ts|tsx|js|mjs)$/.test(e.name)) {
            const rel = full.slice(input.projectRoot.length + 1).split('\\').join('/');
            allFiles.push(rel);
          }
        }
      };
      walk(srcDir);
      const sample = allFiles.slice(0, 50);
      const stubHits = findStubMarkers({ projectRoot: input.projectRoot, filePaths: sample });
      for (const hit of stubHits.stubMarkers.slice(0, 10)) {
        enforcerFindings.push({
          enforcerId: 'rl-prototype-fidelity-001',
          rule: 'Prototype Fidelity: No Stub Markers',
          severity: 'warn',
          file: hit.filePath,
          detail: `stub marker "${hit.pattern}" at line containing: ${hit.snippet.slice(0, 50)}`,
        });
      }
    }
  } catch {
    // skip
  }

  // 6. P2-a enforcers (Slice #6 L2.3) — 18 lint-style enforcers
  //    across Themes A (section), B (frontmatter), C (output
  //    style), D (CLI-back gaps), E (reference integrity),
  //    F (workflow shape), G (catalog governance). Each enforcer
  //    is a pure pattern scan; we walk `skills/` + `references/`,
  //    call the helpers, and convert LintHit[] into
  //    EnforcerFinding[]. Failures here are WARN, not FAIL —
  //    P2-a is the lint layer, not the structural gate layer.
  try {
    const skillsRoot = join(input.projectRoot, 'skills');
    if (existsSync(skillsRoot)) {
      const skillNames: string[] = [];
      for (const entry of readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        if (!existsSync(join(skillsRoot, entry.name, 'SKILL.md'))) continue;
        skillNames.push(entry.name);
      }
      const skillFiles = readSkillFiles(skillsRoot, skillNames);

      for (const skill of skillFiles) {
        const refsDir = join(skillsRoot, skill.name, 'references');
        const refs: string[] = existsSync(refsDir)
          ? readdirSync(refsDir).filter((f) => f.endsWith('.md'))
          : [];

        const lintHits = [
          ...lintSectionShape(skill),
          ...lintSectionOrder(skill),
          ...lintFrontmatterShape(skill),
          ...lintRefPathResolves(skillsRoot, skill.name, refs),
          ...lintNoBrokenMkdir(skill),
          ...lintNoPwdSymlinkJumps(skill),
          ...lintNoRelativeArchivePaths(skill),
          ...lintReferenceLoadStrategy(refsDir, refs),
          ...lintCliBackMandatorText(skill),
          ...lintCliBackNoOrphanBlocking(skill),
          ...lintCliBackNoOrphanMustNot(skill),
          ...lintNoFluff(skill),
          ...lintNoClosingPrompt(skill),
          ...lintPeaksDoctorAcknowledged(skill),
        ];
        for (const hit of lintHits) {
          enforcerFindings.push({
            enforcerId: hit.catalogId,
            rule: hit.rule,
            severity: 'warn',
            file: hit.file,
            detail: `line ${hit.line}: ${hit.matchedText}`,
          });
        }

        // 7. P2-b enforcers (Slice #7 L2.4) — references/*.md
        //    shape enforcers (Themes H-K, M-P). Each enforcer
        //    walks the reference files of this skill and reports
        //    per-file hits.
        try {
          const refFiles = readReferenceFiles(skillsRoot, skill.name, refs);
          for (const ref of refFiles) {
            const refHits = [
              ...lintH1TitleRequired(ref),
              ...lintApplicableTaskLevels(ref),
              ...lintSeeAlsoSection(ref),
              ...lintCrossRefResolves(ref, refsDir, refs),
              ...lintNoSelfReference(ref),
              ...lintNoOrphanLink(ref),
              ...lintLineCountLe800(ref),
              ...lintH2CountLe12(ref),
              ...lintOverviewNearTop(ref),
              ...lintLoadStrategyOnDemandFallback(ref),
              ...lintLoadStrategyAlwaysCacheable(ref),
              ...lintNoBashHeredoc(ref),
              ...lintNoSudo(ref),
              ...lintNoCurlPipeBash(ref),
              ...lintCodeBlockLanguage(ref),
              ...lintNoFakePrompt(ref),
              ...lintNoAbsolutePaths(ref),
              ...lintNoChmod777(ref),
              ...lintNoMagicNumbers(ref),
              ...lintSkillCitesEveryReference(ref, skill),
              ...lintLoadStrategyMatchesSize(ref),
            ];
            for (const hit of refHits) {
              enforcerFindings.push({
                enforcerId: hit.catalogId,
                rule: hit.rule,
                severity: 'warn',
                file: hit.file,
                detail: `line ${hit.line}: ${hit.matchedText}`,
              });
            }
          }
        } catch {
          // skip — P2-b enforcers are best-effort per reference file
        }
      }
    }
  } catch {
    // skip — P2-a enforcers are best-effort; a failure here must
    // not break the audit pipeline
  }

  // 8. P2-b Theme L — audit regression enforcers. These check
  //    the audit framework's own integrity (catalog stability,
  //    no orphan enforcers, no orphan catalog entries, runtime
  //    budget). They are the gating layer that `peaks slice check`
  //    asserts in its 5th stage.
  try {
    const catalogSize = backed.entries.length;
    const proseOnlyCount = counts.proseOnly;
    const observedMs = Date.now() - auditStartMs;

    const auditRegressionHits = [
      ...lintCatalogStability({
        currentSize: catalogSize,
        sizeNinetyDaysAgo: readCatalogHistory(input.projectRoot),
      }),
      ...lintNoOrphanEnforcer(input.projectRoot),
      ...lintNoOrphanCatalog(),
      ...lintRuntimeBudget(input.projectRoot, observedMs),
    ];
    for (const hit of auditRegressionHits) {
      enforcerFindings.push({
        enforcerId: hit.catalogId,
        rule: hit.rule,
        severity: 'warn',
        file: hit.file,
        detail: `line ${hit.line}: ${hit.matchedText}`,
      });
    }
  } catch {
    // skip — audit-regression enforcers are best-effort
  }

  // P2-a Theme F (project-level): openspec proposals + tech-doc shape.
  try {
    const openspecHits = [
      ...lintOpenSpecAcceptanceBullets(input.projectRoot),
      ...lintOpenSpecSpecReference(input.projectRoot),
      ...lintTechDocPresenceShape(input.projectRoot),
    ];
    for (const hit of openspecHits) {
      enforcerFindings.push({
        enforcerId: hit.catalogId,
        rule: hit.rule,
        severity: 'warn',
        file: hit.file,
        detail: `line ${hit.line}: ${hit.matchedText}`,
      });
    }
  } catch {
    // skip
  }

  // P2-a Theme C (session log): status header presence. Reads
  // .peaks/_runtime/<sid>/session.log. Soft check: if no session
  // log is present (e.g. dogfood on a fresh project), the enforcer
  // returns an empty array.
  try {
    let peakSessionId = '';
    if (existsSync(sessionJsonPath)) {
      const sessionData = JSON.parse(readFileSync(sessionJsonPath, 'utf8')) as { peakSessionId?: string };
      if (typeof sessionData.peakSessionId === 'string') {
        peakSessionId = sessionData.peakSessionId;
      }
    }
    if (peakSessionId.length > 0) {
      const statusHits = lintStatusHeader(input.projectRoot, peakSessionId);
      for (const hit of statusHits) {
        enforcerFindings.push({
          enforcerId: hit.catalogId,
          rule: hit.rule,
          severity: 'warn',
          file: hit.file,
          detail: `line ${hit.line}: ${hit.matchedText}`,
        });
      }
    }
  } catch {
    // skip
  }

  // P2-a Theme G: catalog governance. Two checks: catalog size and
  // prose-only ratio. Both are static checks on the catalog itself,
  // not on the project.
  try {
    const catalogSize = backed.entries.length;
    const proseOnlyCount = counts.proseOnly;
    const catalogSizeHits = lintCatalogSize(catalogSize);
    const ratioHits = lintCatalogProseOnlyRatio(catalogSize, proseOnlyCount);
    for (const hit of [...catalogSizeHits, ...ratioHits]) {
      enforcerFindings.push({
        enforcerId: hit.catalogId,
        rule: hit.rule,
        severity: 'warn',
        file: hit.file,
        detail: `line ${hit.line}: ${hit.matchedText}`,
      });
    }
  } catch {
    // skip
  }

  const audit: RedLineAudit = {
    totalRedLines: counts.totalRedLines,
    cliBacked: counts.cliBacked,
    partial: counts.partial,
    proseOnly: counts.proseOnly,
    audit: backed.entries,
    enforcerFindings,
  };

  return { audit, warnings };
}
