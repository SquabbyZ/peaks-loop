---
requestId: 2026-06-27-verdict-aggregator-fixes
sessionId: 2026-06-27-session-83acf5
changeId: _runtime\2026-06-27-session-83acf5
schemaVersion: 2
sha256: 78b7c71e8a8b79f51a7fb401ffeaaec47d810e844d2c7c5deea45488f5585132
handoffHash: 78b7c71e8a8b79f51a7fb401ffeaaec47d810e844d2c7c5deea45488f5585132
writtenAt: 2026-06-27T16:00:54.727Z
goals: []
acceptanceCriteria: []
preservedBehavior: []
handoffPath: C:/Users/<REDACTED-user>/Desktop/peaks-loop/.peaks/_runtime/2026-06-27-session-83acf5/prd/handoff.md
---
# PRD Request 2026-06-27-verdict-aggregator-fixes

- session: 2026-06-27-session-83acf5
- change-id: v2-12-independent-security-perf-audit
- type: feature
- source: verbal (用户中文需求 + v2.13.1 dogfood findings)
- raw input (sanitized): 2.13.1 已经发完；dogfood 暴露 1 个 BLOCKER bug（`aggregateVerdict()` 的 `pushFix` key 误含 `source` 导致跨 source dedup 失效，违反 audit-output-schema.md:73）+ v2.14 carry-forward 4 项要在 2.13.2 一并解决。用户原话 "2.13.1 我发完了" + "把 2.14 要做的部分做到 2.13.1 版本里" → 2.13.2 PATCH bump。

## Goals

1. **Bug fix (BLOCKER 优先)**: `src/services/verdict/verdict-aggregator.ts` `pushFix` 的 dedup key 改为 `${file}|${line}|${hint}`（去掉 `source`）；`VerdictReason` 加可选 `sources: ReadonlyArray<string>` 字段，跨 source 命中时合并为同条 entry 并列出所有 source。修复违反 `.peaks/project-scan/audit-output-schema.md:73` 的 "(file,line,hint) 去重" 规则
2. **跨 source dedup 单测补齐**: `tests/unit/services/verdict/verdict-aggregator.test.ts` 加 ≥ 3 case（security+perf 同处 / karpathy+security 同处 / 单 source 不合并）
3. **CLI surface**: 新增 `peaks verdict aggregate --from-rid <rid>`，从 5 个 envelope 文件读入 + 调 `aggregateVerdict()` + 打印 verdict + reasons
4. **Envelope unification**: `src/services/verdict/envelopes.ts` 新增 discriminated-union type `AnyEnvelope` + 5 个 parser funcs (`parseSecurityEnvelope` / `parsePerfEnvelope` / `parseKarpathyEnvelope` / `parseMutEnvelope` / `parseQaEnvelope`)；`aggregateVerdict` 改用 union type
5. **prd/handoff.md auto-regen**: `peaks request transition --role prd --state handed-off` 触发 peaks-prd 写 `prd/handoff.md` (schemaVersion: 2 + sha256)
6. **MUT_REPORT back-compat 软阻断窗口**: 仿 v2.12.0 audit 模式，给 1 minor release 软阻断（缺 mut-report → 警告而非 fail；2.14.0 hard-fail）

## Non-goals

1. **不**撤回 2.13.1（已 publish，CHANGELOG/release notes 保持历史）
2. **不**改 5 个 verdict 字符串
3. **不**做 RFC 投票 / weighted scoring
4. **不**重写 micro-cycle.md（已 89 行满足 AC-3）
5. **不**接 peaks-final-review 4-dim 到 CLI
6. **不**加重 peaks-mut 5-pattern rule
7. **不**改 v2.12.0 audit envelope schema

## Preserved behavior

1. `peaks-security-audit` / `peaks-perf-audit` 输出 envelope 形态不变
2. `karpathy-reviewer` `{passed, violations, gateAction}` 形态不变
3. `peaks-mut` `mut-report.json` schema 不变
4. `peaks-qa` `test-reports/<rid>.md` 8 节格式不变
5. 2.13.1 micro-cycle.md `## Verdict reasoning (v2.13.1)` 段保持（仅修 aggregator，micro-cycle 文档不动）
6. peaks-final-review 4-dim 不动
7. 3-cycle repair cap 不动

## Acceptance criteria

### AC-1: BLOCKER bug fix（最高优先）
- 给定: `aggregateVerdict({ security: {verdict:'warn', violations:[{file:'a.ts', line:1, hint:'same', severity:'HIGH'}]}, perf: {verdict:'warn', violations:[{file:'a.ts', line:1, hint:'same', severity:'HIGH'}]} })`
- 期望: `verdict: 'warn'`，`reasons.length === 1`，`reasons[0].sources === ['security-audit', 'perf-audit']`（or equivalent 字段名）
- 测试: `tests/unit/services/verdict/verdict-aggregator.test.ts` 新增 ≥ 3 case (cross-source-dedup / single-source-no-merge / single-source-unique-no-merge)
- 行为: `git show HEAD -- src/services/verdict/verdict-aggregator.ts` 显示 `pushFix` key 已改；`tests/unit/services/verdict/verdict-aggregator.test.ts` 总 case ≥ 16 (原 13 + 新 3)

### AC-2: CLI surface `peaks verdict aggregate`
- 给定: 在 `.peaks/_runtime/<sid>/` 有 5 个 envelope 文件（`audit/security.md` / `audit/perf.md` / `rd/karpathy-review.md` / `mut/mut-report.json` / `qa/test-reports/<rid>.md`）
- 当: 跑 `peaks verdict aggregate --from-rid <rid> --project <repo> --json`
- 那么: 返回 `{ verdict, reasons[] }` JSON envelope
- 测试: `tests/unit/cli/commands/verdict-aggregate-command.test.ts` ≥ 4 case (5 inputs present / 缺一个 envelope 仍能跑 / 全部缺返回 pass / JSON envelope shape)

### AC-3: Envelope unification
- 新增 `src/services/verdict/envelopes.ts`：export `type AnyEnvelope = SecurityEnvelope | PerfEnvelope | KarpathyEnvelope | MutEnvelope | QaEnvelope` (discriminated union by `kind` field) + 5 parser funcs
- `aggregateVerdict()` 改用 union type 入参（保持向后兼容：现有 call site 用 `{security, perf, ...}` shape 仍 work；parser funcs 是新加的）
- 测试: `tests/unit/services/verdict/envelopes.test.ts` ≥ 6 case (5 parsers happy path + 1 malformed rejection)

### AC-4: prd/handoff.md auto-regen
- 给定: `peaks request transition <rid> --role prd --state handed-off` 成功
- 当: `prd/handoff.md` 不存在
- 那么: peaks-prd 自动写 `prd/handoff.md` (schemaVersion: 2 + sha256) 后 transition 才放行
- 测试: `tests/unit/...` ≥ 3 case (handoff 缺失 → auto-write / 已存在 → 不覆盖 / sha256 校验通过)

### AC-5: MUT_REPORT 软阻断窗口
- 改 `src/services/artifacts/artifact-prerequisites.ts` 的 `MUT_REPORT` 常量加 `backCompat: true` 标记（or 等效）
- 在 `checkPrerequisites()` 路径里给 `MUT_REPORT` 软处理：缺失 → `warnings: ['mut-report-missing-recommended-in-v2.14.0']` 而非 throw
- `audit/security.md` 的 v2.12.0 软阻断模式参考（同样 1 minor release window）
- 测试: ≥ 2 case (v2.13.2 缺 mut-report → warning not throw / 2.14.0 hard-fail 占位)

### AC-6: 零回归
- 2.13.1 90/90 测试 + 2.13.2 新 ≥ 12 case (3+4+6+3+2) = ≥ 102 测试全 pass
- `tsc --noEmit` 0 错
- `git show 571f92b -- src/services/verdict/verdict-aggregator.ts` 的 pushFix key bug 已修（diff 显示）

### AC-7: 文档同步
- `CHANGELOG.md` v2.13.2 段: 5 条 bullet (BLOCKER fix / CLI surface / envelope unification / handoff auto-regen / MUT 软阻断)
- `.peaks/memory/2026-06-27-v2-13-2-verdict-aggregator-fixes.md` ship state
- `package.json` + `src/shared/version.ts` 2.13.1 → 2.13.2
- README 一句说明 CLI surface

## Frontend delta (only when target is frontend)

N/A — 此切片纯 CLI 改动，无前端。

## Risks and open questions

1. **风险**: AC-1 dedup key 改了，原 13 case 单测可能误伤。**缓解**: 改 key 之前先 audit 现有 13 case：原 key 含 source → 同 source 重复 (file,line,hint) 本来就 dedup 了；改 key 后效果相同。所以 13 case 应当全过。RD 实施时先跑原 13 case 确认。
2. **风险**: AC-2 CLI 命令的 envelope 文件路径约定散落 5 处，可能漏一个。**缓解**: RD 实施时统一走一个 `peaks-scan.ts` 现有 reader（如 `loadMutReport`），不发明新 IO
3. **风险**: AC-4 handoff auto-regen 改 prd transition 路径，可能影响既有 slices。**缓解**: 仅在 `prd:handed-off` 时写，不在 `prd:handed-off` 之外的 transition 触发
4. **风险**: AC-5 软阻断 vs v2.12.0 audit 软阻断 1-minor window 周期重叠可能混乱。**缓解**: 在 v2.13.2 软阻断加显式 deprecationNotice 字段 + 2.14.0 hard-fail 的 TODO
5. **开放**: AC-3 union type 加 `kind: 'security' | 'perf' | ...` 字段时，**不**改 envelope 文件内容（schema 仍 in-file 自描述），仅在 TS type 层 union。同意。

## Handoff

- to peaks-rd: .peaks/_runtime/change/v2-12-independent-security-perf-audit/rd/requests/2026-06-27-verdict-aggregator-fixes.md
- to peaks-qa: .peaks/_runtime/change/v2-12-independent-security-perf-audit/qa/requests/2026-06-27-verdict-aggregator-fixes.md

## Status

- created: 2026-06-27T14:40:07.631Z
- last update: 2026-06-27T16:00:54.674Z
- state: handed-off


## Embedded JSON

```json
{
  "verdict": "warn",
  "violations": [
    {
      "dimension": "embed",
      "severity": "HIGH",
      "file": "embed.ts",
      "line": 1,
      "hint": "embedded json"
    }
  ],
  "summary": "embedded json inside markdown"
}
```
