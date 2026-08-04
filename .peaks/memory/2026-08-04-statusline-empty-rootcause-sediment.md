---
name: 2026-08-04-statusline-empty-rootcause-sediment
description: 状态栏 empty 根因 — peaks-loop 4.0.8 项目本体 `.peaks/_runtime/active-skill.json` 不存在 + UserPromptSubmit bootstrap 修复方向(spec/plan 已 ship,4.0.9 planned)
metadata:
  type: project
---

# Statusline `Peaks o empty` 根因 sediment(2026-08-04)

## 1. Symptom

在 peaks-loop 4.0.8 项目**本体**跑 `/peaks-code` 后,Claude Code 状态栏显示:

```
Peaks o empty → peaks-loop
```

替代期望的:

```
Peaks ● peaks-code [full-auto] → peaks-loop
```

下游 peaks-loop 消费项目(ice-cola 等)状态栏显示正常。

## 2. Root cause

peaks-loop 项目本体**从来没有**运行过 `peaks skill presence:set peaks-code`,因此 `.peaks/_runtime/active-skill.json` 这个 marker 文件**不存在**。`peaks statusline`(被 IDE 每次 turn 调用)在 `src/services/skills/skill-statusline-service.ts:82-112` 读这个文件,读到 `presence === null` → renderer 走 `renderIdle` 分支(`skill-statusline-renderer.ts:301-303`)→ 输出 `${idle-glyph} empty`。

`peaks hooks install` 在所有 IDE 适配下**只装 1 个 hook entry**(`PreToolUse Bash → peaks gate enforce`)。`peaks hook handle` 协议 dispatcher 内部的 4 个 enforcer(`code-ban` / `gate-enforce` / `root-pollution` / `login-gate`)以及 `presence-marker-detector` post-tool hook **都是只读诊断器,从不写入** marker。4.0.8 slice D6 加的 `setSkillPresenceForCaller` 只写 per-caller 的 `.peaks/_runtime/<sid>/active-skill-<caller>.json`,**不写** legacy `.peaks/_runtime/active-skill.json`(读者优先取 legacy 路径)。

净结果:在没有 LLM 主动跑 `peaks skill presence:set` 的项目里,marker 永远不存在。**没有任何 harness 组件在写这个文件**。

## 3. Why "other downstream projects" appear normal

**历史偶然,不是 hooks 在工作**。

那些下游项目里某次早期 LLM 主动跑过 `peaks skill presence:set peaks-code`,marker 文件就被留在磁盘上,之后 4.0.x 一直存在。peaks-loop 项目本体的常规诊断场景里 LLM 走 "grep/README" 直答模式,从来没触发过"LLM 主动跑 CLI verb"这一步(项目本身的根因 brief 也走 prose 直答通道)——结果就是项目本身**唯一**踩到这个 bug。

**误判警告**:看到"下游 OK + 本体 bug"很容易推断"是不是 hook 没装对/是不是 IDE 配置有问题"。这个推断**错**。下游 OK 不是 hooks 工作,是历史偶然。判断证据必须是 `ls .peaks/_runtime/active-skill.json` 存不存在 —— 这个 check 比"看 hook 配置"精确 100 倍。

未来任何 peaks-loop 4.0.8 项目跑 `peaks hooks install` 后状态栏仍然 empty,**第一动作是看 marker 文件是否存在**,不是猜 hook。

## 4. Data flow table(写入链 vs 读取链 vs 哪个组件不写)

| 组件 | 职责 | 关键文件 | 是否写 marker |
|---|---|---|---|
| `peaks statusline` (IDE 每次 turn 调) | 只读 `.peaks/_runtime/active-skill.json` | `src/services/skills/skill-statusline-service.ts:82-112` | 只读 |
| `peaks gate enforce` PreToolUse hook | gate 检查,验证 Bash 调用 | `src/services/hooks/hooks-settings-service.ts:306-311` | **不写** |
| `peaks skill presence:set peaks-code` (CLI verb) | 双写 canonical lease + legacy marker | `src/services/skills/skill-presence-service.ts:417-423` | **写**(但 LLM 从不主动跑) |
| `setSkillPresenceForCaller` (4.0.8 D6) | 只写 per-caller `.peaks/_runtime/<sid>/active-skill-<caller>.json` | `src/services/skills/skill-presence-service.ts:262-296` | **不写 legacy** |
| `presence-marker-detector` post-tool hook | 只读诊断,告警 presence 缺失 | `src/services/hooks/presence-marker-detector.ts` | 只读 |
| `peaks hook handle` 4 enforcers | gate-enforce / code-ban / root-pollution / login-gate | `src/services/hooks/hook-handle-*.ts` | **不写** |
| `CLAUDE.md:36` 引导句 | 指示 LLM "读 presence 然后显示 status header" | `CLAUDE.md:36` | **未指示 LLM 写** |
| `peaks-code/SKILL.md` Step 0 | 项目内流程入口 | `skills/peaks-code/SKILL.md` | **没有 "先写 presence" 硬指令** |

**Gap 在哪**:`peaks skill presence:set peaks-code` 是唯一写入器,但没有任何 harness 组件在 user prompt 之前自动调用它。Marker 的写入必须 LLM 主动跑 CLI verb 才发生 —— 违反 Human-NL-Choice-Only(LLM 跑 CLI 是 user 行为,L1 prompt 引导不可依赖)。

## 5. Immediate workaround

**用户**在自己的会话里跑一次(等价操作,LLM 可代跑):

```bash
peaks skill presence:set peaks-code --mode full-auto --gate step-N-startup
```

或 LLM 在会话开头读一次 `peaks skill presence --json` 后立刻 `peaks skill presence:set peaks-code --mode <当前 mode>` 回灌(同 self-bootstrap 语义)。

注意:**这不是 prompt 引导**,而是 harness 缺失的兜底。Long-term 必须靠 spec/plan 的 UserPromptSubmit bootstrap 修。

## 6. Permanent fix direction

**Spec**:`docs/superpowers/specs/2026-08-04-statusline-empty-fix-design.md`(393 行,已 ship)。

**Plan**:`docs/superpowers/plans/2026-08-04-statusline-empty-fix.md`(345 行,5 task × 5 slice,已 ship)。

**RD brief**:`.peaks/_runtime/2026-08-03-session-1b6cf3/rd/requests/001-statusline-empty-fix-spec-plan.md`。

**QA brief**:`.peaks/_runtime/2026-08-03-session-1b6cf3/qa/requests/001-statusline-empty-spec-plan-qa-brief.md`。

### Fix 核心:Option B(`UserPromptSubmit` bootstrap hook)

`peaks hooks install` 在 `PreToolUse Bash → peaks gate enforce` 之外**追加 1 条** `UserPromptSubmit` hook(Claude Code)/ `beforeSubmitPrompt` hook(Trae),命令是 `peaks skill presence:set peaks-code --mode <mode> --gate <gate>`。Hook 对 LLM 完全透明 —— marker 在 LLM 看到 user prompt 之前就被 harness 写好。

### 5 个关键约束(spec 已 ship)

1. **5 分钟 rate-limit**(per `(sessionId, skill)`),防止 fs thrash。
2. **`--upgrade` opt-in** 默认关闭,legacy 项目不破;fresh install 默认两条 entry 都装。
3. **零新 npm dep**,复用 `setSkillPresence` writer。
4. **不改 `presence-lease-service.ts`**(4.0.8 canonical lease 路径 lock)。
5. **不改 statusline renderer**,仅 reader 侧目标文件对齐。

### AC1-AC9 已有

- AC1: 全新 git clone + `hooks install` + `run-presence-bootstrap` → marker 文件被写。
- AC4: 已有项目 `hooks install --upgrade` 才升两条 entry,默认不破。
- AC7: 8 个现有 hooks-install integration test 全部 green(byte-level install shape 保留)。

**4.0.9 计划 ship**(spec/plan 末尾已注明,本 sediment 不含 ship 事实)。

## 7. Why user instructions OVERRIDE skill defaults

`CLAUDE.md` 中已上升为项目级硬规则的 2 条:

- **Human-NL-Choice-Only**(2026-07-04):User 只能"自然语言多选"或"自然语言描述"参与 peaks-loop,LLM 代 user 跑 CLI。意味着 **L1 prompt 引导(Option A)在 prompt-only 层修,违反这条红线** —— 用户不敲 CLI,L1 prompt 也不能隐含要求 LLM 帮 user 跑 CLI verb。Option B 的 hook-driven 修复才是正道。
- **Two-Forms-Only,desktop 是 UI 加速**(2026-07-04):User 跟 peaks-loop 的所有交互只两种形式。Bootstrap hook 装在 harness 层,user 看不到 CLI verb,完全合规。

**Option A vs Option B 的本质差别**:Option A 让 LLM 在每个 /peaks-code 调用的 Step 0 前主动跑 `peaks skill presence:set`(prompt-only 引导),违反 Human-NL-Choice-Only —— LLM 因为 prompt 强制而跑 CLI 是把 CLI 行为转嫁到 LLM 身上,user 仍然间接被要求触发 CLI 路径。Option B 让 harness 在 user 看不到的地方自动写 marker,user 不参与 CLI 调用 —— 合规。

**判断准则**:任何"prompt 引导 LLM 跑 presence CLI"的修复提案必须升级到 hook 层,否则违反项目硬规则。spec/plan 的 Option B + Option A 组合(把 Option A 留作 LLM 显式 override 通道)是符合规则的最小变更。

## 8. Carry-forward lesson

**在 4.0.8+ 检查 statusline empty 时,第一动作是 `ls .peaks/_runtime/active-skill.json` 看 marker 是否存在,不是猜 hooks 没装。**

判断口诀:**"marker 缺 = presence 没写 = harness 不写 = 历史偶然或 fix 未 ship;不要往 IDE hook 配置上找根因。"**

修好之后:Bootstrap hook 部署 + `--upgrade` 跑过的项目,marker 永远在;Bootstrap hook **未部署**的项目,如果 LLM 从未主动跑过 `peaks skill presence:set`,marker 仍然缺(这就是 peaks-loop 项目本体此刻的状态)。未来 LLM 看到 statusline empty,**先 ls marker 文件**,再决定是建议 user 跑 workaround 还是升级到 4.0.9+。

---

## 相关 memory 引用

- [[2026-08-04-capability-baseline-design-plan-shipped]] — 同 session(2026-08-03-session-1b6cf3)sibling,capability-baseline 5-slice ship;本 sediment 是 rid-001 根因沉淀,与 capability-baseline 是同一 session 的双 sediment。
- [[2026-08-03-presence-lease-graph-shipped]] — 4.0.8 ship-day sediment(presence lease + workflow graph + ack protocol),本 bug 的"修了一半"基线 —— 4.0.8 canonical lease 路径已 lock,statusline reader 仍走 legacy marker,所以 slice D6 的 per-caller 路径不修这个 bug。
- [[2026-07-30-nightshift-test-failures-fix]] — fix 类 sediment 风格参考(中文 + 表格 + 根因 cluster + carry-forward lesson);本 sediment 仿其 8-section 结构。
- [[2026-08-04-4.0.8-freeze-sediment]] — 4.0.8 capability baseline frozen sediment;同 4.0.8 release wave,本 sediment 是 4.0.9 planned fix 的根因锚。
- [[memory-md-ghost-sediment-finding]] — auto-memory 引用 3 个不存在的 sediment 文件的事实;本 sediment 引用 `[[peaks-loop-publishing-critical-hard-rules]]` 也属同类 ghost link(MEMORY.md 索引存在,物理文件不存在),下游 LLM 看到 link 时按 ghost sediment drift 同样的方式处理即可。
- [[human-nl-choice-only-tenet]] — 本 sediment §7 引用的硬规则全文。
- [[two-forms-only-rule]] — 本 sediment §7 引用的硬规则全文。
- [[peaks-loop-publishing-critical-hard-rules]] — *(ghost link,MEMORY.md 索引存在但物理文件不存在;按 [[memory-md-ghost-sediment-finding]] 模式处理)* 本 bug 的 4.0.8 release wave 背景知识 publish 链上 critical rules(若该文件重建则补全)。

## 不在 sediment 范围内

- 不预测"将来所有 peaks-loop 用户都会遇到"(过度承诺,无数据)。
- 不在 sediment 写 commit message(spec/plan 由 RD/QA 在自己的 commit 里写)。
- 不复制整段 spec/plan/brief(浓缩 30%,加自身洞察)。
- 不引用未来 4.0.9 还没 ship 的具体 fix commit;只引用 spec/plan 路径,spec/plan 自己注明 "4.0.9 planned"。