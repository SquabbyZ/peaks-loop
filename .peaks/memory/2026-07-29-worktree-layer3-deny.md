---
name: 2026-07-29-worktree-layer3-deny
description: Layer 3 of Worktree Governance — write `permissions.deny: ["UseSkill(superpowers:using-git-worktrees)"]` into the IDE settings.json via `peaks hooks install`. Closes the superpowers-chain jailbreak that bypasses Layer 2 hook gate; chosen as Minimal Viable path (L3 only).
metadata:
  type: project
  createdAt: 2026-07-29
  originSessionId: 2026-07-29-session-current
  severity: architecture
  relatedRid: 2026-07-29-worktree-layer3-deny
---

# Worktree Governance — Layer 3 deny (Minimal Viable) — SHIPPED 2026-07-29

## 决策回顾

用户的 4 个原始痛点(worktree 路径、`.peaks` 不同步、diff、node_modules)经讨论后被改判为治理结构缺,worktree 价值 > 痛点。架构方案 = peaks worktree 作为 1st class,git worktree 作 2nd。

随后用户发现新场景:sub-agent 自主 invoke `superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` → `using-git-worktrees` 链路,LLM 主动找 raw `git worktree add` 路径,绕过现有 gate。

治理方案 = 3 层叠加:
- **L1** sub-agent system prompt
- **L2** hook + lifecycle (worktree auth hard gate,已 ship)
- **L3** Claude Code `permissions.deny`(本 rid)

本 rid = Minimal Viable,**只做 L3**。L1/L2 后续独立 rid。用户原话:"不用考虑老用户,因为基本上都是使用 `npm i -g peaks-loop@latest` 重新安装最新版本的时候会自动更新 skills"。

## What shipped

- `src/services/skills/hooks-settings-service.ts` 新增 L3 deny 模块:
  - `SUPERPOWERS_DENIED_SKILLS: ReadonlyArray<string>` — 当前含 `superpowers:using-git-worktrees`
  - `formatSuperpowersDenyEntry(skillId)` — 包装成 `UseSkill(<id>)`
  - `SUPERPOWERS_DENY_SENTINELS: ReadonlySet<string>` — uninstall 精删用
  - `withSuperpowersSkillDenylist(settings)` — 幂等合并,保留用户其他 deny
  - `withoutSuperpowersSkillDenylist(settings)` — 卸载精确删除,空对象自分解
  - `listSuperpowersDenyEntries()` — 给 status / dry-run 用
  - `applyHookInstall` / `removeHookInstall` 调用上述 helper,合并入既有 atomicWriteJson 路径(单写,无 partial state)
- `tests/unit/hooks-settings-service.test.ts` 新增 14 个 case 覆盖:
  - listSuperpowersDenyEntries 单源真相
  - with/without 各自的 7 个不变量(空 settings / 用户 deny 保留 / 幂等 / 非数组 deny 替换 / 不 mutate input / 空 deny 删字段 / 空 permissions 自分解)
  - install/uninstall end-to-end 在真 settings.json 上(additive / idempotent / round-trip / 空文件)

## 为什么是 L3 = 最强的一层

3 层里 L3 在 IDE 权限系统层拒绝,LLM 看不到 Skill 名:
- **L1 (sub-agent system prompt)** — LLM 可改 / 可忘 / 可被 superpowers 覆盖
- **L2 (hook + lifecycle)** — 拦得到 raw `git worktree add` bash,但 superpowers SKILL.md 是 LLM 读后执行的,hook 看得到 bash 但看不到 LLM 决策路径
- **L3 (`permissions.deny`)** — Claude Code 入口拒绝,Skill 不出现在 LLM 视野中,LLM 看不到它 → 无法选它 → 无法被它教

LLM 决策路径被 IDE 权限系统截断,这就是 L3 唯一够强的地方。

## 不变量(给后续 rids 用)

1. **单源真相**:`SUPERPOWERS_DENIED_SKILLS` 是常量数组,deny 条目从它渲染。
2. **additive 不 destructive**:`withSuperpowersSkillDenylist` 永远保留用户其他 deny 条目。
3. **精确 uninstall**:`withoutSuperpowersSkillDenylist` 只删自己写的 `UseSkill(...)`,不碰用户条目。
4. **空对象自分解**:deny 空了 → permissions 空了 → permissions 整体删除(不留 `{}`)。
5. **单 atomicWriteJson**:install 时 gate-enforce hook 和 L3 deny 一次写完,不允许半步。
6. **helper 是纯函数**:helper 不 mutate input,不写盘,原子写在 `applyHookInstall` / `removeHookInstall`。

## 后续 rid(留给以后)

- **rid-L1**:sub-agent system prompt 加"不要主动走 superpowers worktree 链路"。估计 1-2 天。
- **rid-L2-extended**:`peaks worktree spawn` 真正落地,带 lease 生命周期,sub-agent 自动接 spawn 而不是 raw git worktree。估计 1 周。
- **rid-L3-extended**:如有新越狱 skill,append 到 `SUPERPOWERS_DENIED_SKILLS` 即可。0-effort。

## 红线 / 防御

- **`useSkill` prefix**:Claude Code `permissions.deny` 的 entry 形如 `UseSkill(<id>)`,prefix 不可省;helper 强制加。
- **不 deny 整个 superpowers**:只 deny 触发 raw worktree 的那条,不 deny brainstorming/writing-plans 本身(它们是 reference material)。
- **不动 superpowers SKILL.md**:用户的"SKILL.md 是 npm 包合约"是单向的——peaks-loop 改自己的源一次,下游通过 npm install 同步;但 peaks-loop 不去改 superpowers 自己的 SKILL.md(无法做也不该做)。

## 关联 memory

- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 防线,先于本 rid ship。
- [[2026-07-29-worktree-layer3-deny-progress]] — compact 恢复锚点,ship 后归档。
- [[2026-07-24-peaks-code-bridge-002-rootcause]] — peaks-code ↔ superpowers 桥接基线。