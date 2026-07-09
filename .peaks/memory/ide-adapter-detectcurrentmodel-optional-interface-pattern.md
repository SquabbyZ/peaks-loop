---
name: ide-adapter-detectcurrentmodel-optional-interface-pattern
description: IdeAdapter interface 加 optional detectCurrentModel? 字段的扩展模式 — back-compat + vendor-neutrality + 异步隔离(2026-07-09)。
metadata:
  type: technical-pattern
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/qa/003-add-zcode-adapter/slice-C-completion.md
---

# IdeAdapter optional `detectCurrentModel?` 扩展模式

**日期:** 2026-07-09
**触发:** RID 003 Slice C 新增运行时探测 model

## Pattern

```ts
// 1. interface 加 optional 字段
interface IdeAdapter {
  readonly id: IdeId;
  // ... existing fields ...
  readonly detectCurrentModel?: () => Promise<string | undefined>; // 新增
}

// 2. adapter 选择性实现
export const ZCODE_ADAPTER: IdeAdapter = {
  id: 'zcode',
  // ... existing fields ...
  detectCurrentModel: detectZcodeCurrentModel, // z-code 实现
};

// 3. core service 走 optional 检查
export async function detectCurrentIdeModel(): Promise<string | undefined> {
  for (const id of listAdapterIds()) {
    const adapter = getAdapter(id);
    if (typeof adapter.detectCurrentModel !== 'function') continue; // skip
    try {
      const modelId = await adapter.detectCurrentModel();
      if (typeof modelId === 'string' && modelId.trim().length > 0) {
        return modelId.trim();
      }
    } catch { /* best-effort, try next adapter */ }
  }
  return undefined;
}
```

## 为什么这么做

### 1. Back-compat
- 已注册的 8 个 adapter(claude-code / trae / cursor / codex / qoder / tongyi-lingma / hermes / openclaw)**无需任何改动**
- optional 字段意味着"没填就是 N/A",TypeScript 不报错
- 旧 caller 调 `adapter.detectCurrentModel()`(非 optional)会 TS 报错,但 `if (typeof ... !== 'function') continue` 兜底

### 2. Vendor-neutrality
- `current-model-detector.ts` 不 import 任何 adapter,只走 `IdeAdapter.detectCurrentModel?` 字段
- 不出现具体 vendor 命令(zcode / claude / cursor 等都不在 core)
- 适配器选择实现 `builtin:` 前缀 sentinel 区分 user-installed vs vendor-builtin

### 3. 异步隔离
- core service `detectCurrentIdeModel()` async
- 单个 adapter 失败不影响整个 chain(try/catch)
- 插入顺序遍历,first-match-wins

## 反例(不应这么做)

```ts
// ❌ 反例 1: interface 必填,迫使每个 adapter 实现
interface IdeAdapter {
  readonly detectCurrentModel: () => Promise<string | undefined>; // 必填
}
// 问题:8 个老 adapter 全部得写 stub,违反 Karpathy guideline #3 (surgical changes)

// ❌ 反例 2: core 直接判断 vendor name
if (adapter.id === 'zcode') { return await readZcodeConfig(); }
// 问题:违反 vendor-neutrality,新 vendor 接入要改 core

// ❌ 反例 3: 不隔离失败
try {
  const modelId = await adapter.detectCurrentModel();
  return modelId;
} catch (e) {
  throw e; // 一个 adapter 失败 = 整个 chain 失败
}
// 问题:claude-code adapter 失败也会导致 z-code 探测失败
```

## How to apply

- 未来给 `IdeAdapter` interface 加新字段时,**默认用 optional**
- core service 用 `if (typeof adapter.X !== 'function') continue` pattern 跳过不实现的 adapter
- 单 adapter 失败必须隔离(try/catch),不能影响整 chain
- 不在 core 出现具体 vendor 名(`if (id === 'xxx')` 是反模式)

## 关联

- 完整示例: `.peaks/_runtime/2026-07-08-session-17918f/qa/003-add-zcode-adapter/slice-C-completion.md` §C.1 / §C.2 / §C.3
- prior: [[z-code-peaks-loop-9-ide-adapter-vendor-neutrality-adapter]] (vendor-neutrality 设计哲学)
- prior: [[slim-ideadapter-shape-is-the-contract]] (slim adapter 是契约)