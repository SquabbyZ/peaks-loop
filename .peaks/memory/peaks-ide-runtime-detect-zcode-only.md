---
name: peaks-ide-runtime-detect-zcode-only
description: peaks ide model --current 运行时探测 z-code 当前激活 model(4-tier 优先级链),其他 8 个 IDE 暂未实现(2026-07-09)。
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-07-08-session-17918f/qa/003-add-zcode-adapter/slice-C-completion.md
---

# peaks ide model --current — z-code 运行时探测

**日期:** 2026-07-09
**RID:** 003-add-zcode-adapter (Slice C)
**Slice 范围:** 仅 z-code,其他 8 个 IDE 后续 slice 处理

## 实现要点

1. **`peaks ide` CLI 子命令面(全新)**:之前 peaks-loop 没有 `peaks ide` 子命令组。Slice C 新建 `src/cli/commands/ide-commands.ts`(80 行)+ 在 `src/cli/program.ts` 注册。
2. **`src/services/ide/current-model-detector.ts`(43 行)**:遍历 adapter registry,调每个 adapter 的 `detectCurrentModel()` 可选字段(try/catch 隔离失败)。
3. **`IdeAdapter` interface 加 optional 字段**:`detectCurrentModel?: () => Promise<string | undefined>`。已注册 8 个 adapter 无此字段,back-compat 不破。
4. **`getStrongestModelIdAsync()` 异步变体**:`getStrongestModelId(config)` 保留 sync 签名(rd-service 不破),新增 async 变体供未来 caller 用。

## z-code 4-tier 解析优先级

读 `~/.zcode/v2/config.json`,按以下顺序找当前激活 model:

| 优先级 | 来源 | 说明 |
|---|---|---|
| P1 | `PEAKS_ZCODE_ACTIVE_PROVIDER_UUID` env var | 测试 seam + user override |
| **P2** | **非 `builtin:` 前缀的 provider(UUID)** | **实测命中 — z-code active provider 总是 user 装的那条** |
| P3 | 第一个 `enabled: true` provider | fallback |
| P4 | 第一个 provider(insertion order) | fallback |

实测命中 P2:`provider.32a71410-…-19571fd16fb0` → `models.M3` → 返回 `"M3"`。

**Why 用 `builtin:` 前缀 sentinel 而不是硬编码 vendor 名**:vendor-neutrality(zai / GLM 是 builtin,如果 user 自己装的 minimax provider 没有 builtin 前缀,优先取它)。这跟 peaks-loop "no vendor verb in core" 哲学一致。

## 实测输出

```
$ node bin/peaks.js ide model --current
{
  "modelId": "M3",
  "detected": true,
  "registeredAdapters": ["claude-code", "trae", "cursor", "codex", "hermes", "openclaw", "zcode"]
}
```

## How to apply

- 未来接入新 IDE 时,adapter 加 `detectCurrentModel?()` 方法即可,无需改 core
- 其他 8 个 IDE(claude-code / trae / cursor / codex / qoder / tongyi-lingma / hermes / openclaw)的探测待后续 slice / dogfood 补
- `getStrongestModelId()` sync 变体不动(rd-service compat),`getStrongestModelIdAsync()` 异步变体供新 caller

## 关联

- PRD: `.peaks/_runtime/2026-07-08-session-17918f/prd/003-add-zcode-adapter.md` §3
- RD: `.peaks/_runtime/2026-07-08-session-17918f/rd/003-add-zcode-adapter/rd-report.md` §2.5
- Slice C completion: `.peaks/_runtime/2026-07-08-session-17918f/qa/003-add-zcode-adapter/slice-C-completion.md`
- prior: [[peaks-loop-install-model-getstrongestmodelid-fallback]] (back-compat fallback 设计)
- prior: [[desktop-application-ide-adapter-z-code-cli]] (zcode-adapter 字段降级)