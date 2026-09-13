---
name: ecc-fact-force-gate-is-first-touch-not-read
description: "ECC 的 Fact-Forcing Gate 是\"每个路径首次接触拒绝一次\"，与是否读过文件无关"
metadata:
  type: project
  node_type: memory
  originSessionId: 29601951-8e04-4525-8107-125180abe7b4
  modified: 2026-09-11T16:05:40.920Z
---

**2026-09-11 用户拿 Mac 上 4.0.39 的实际日志打回来，才查出这条。** 我先前在 22 个技能里
写的 *"Read a file BEFORE your first Edit … **Skipping that read** trips a PreToolUse gate"*
是**假的因果**。

读 `~/.claude/plugins/cache/ecc/ecc/2.2.0/scripts/hooks/gateguard-fact-force.js`（约 1278 行）实测：

```js
if (!isChecked(filePath)) {
  markCheckedAndCountDenial(filePath);   // 同一个调用里先标记，再拒绝
  return denyResult(...);
}
return rawInput;                          // 第二次直接放行
```

**它是"每个路径首次接触、拒绝一次"的减速带，不是"你有没有读过"的检查。** `state.checked`
持久化，所以同一路径**本会话（乃至跨会话，直到 prune）只会被拦一次**。

**推论（我先前搞反的）：**
- **先读并不能避免拒绝。** 拒绝由"编辑"触发，与读无关。
- **重试必然放行**（重试与"有没有列出四条事实"无关；闸门不校验事实）。
- 子代理豁免（`inSubagent` — 父会话已过闸）；`.peaks/**` 经 `GATEGUARD_EXEMPT_GLOBS` 豁免。
- 因此正确指导是**管理预期**（"每个文件会被拦一次，那不是失败，编辑未被应用，重试即可"），
  而不是**给一个错的因果**。给错因果更糟：它让模型在仍被拦时得出"我做错了什么"。

**修法**：`24fadf92`。守卫断言改成以空白归一化后再匹配（折行是排版不是语义），
并把断言换成真实机制。**证明方式有坑**：只改 1 个文件会被**漂移检查**先抓到，
要证明那条机制断言本身会失败，必须**22 个一起改**。

## 第二层（4.0.41）：真正的时间成本是"模型自己发明的仪式"

用户装完 4.0.40 后继续工作，反馈**仍然频繁被打断**。查日志发现：**被告诉"预期每个文件被拦一次"
之后，模型选择了预防** —— 每次编辑前先把四条事实念一遍，好让拒绝根本不出现。

**识别方法（重要）**：日志里两类东西长得很像，但**格式不同**：
- 模型的：`[Fact-Force Gate]` + `1. importers/callers：…` + `4. 用户原话：「…」`（它在引用用户）
- 闸门的：`Error: [Fact-Forcing Gate]` + `Before creating <路径>, present these facts:` + 不同的问题

**烧掉时间的是前者。** 修法：明确写"不要预防性复述，闸门问的时候再答"（`0c0cb6e9` / 4.0.41）。

## 结论（2026-09-12，用户明确定调）：**停止改文案**

**改了两版文案（4.0.39 修因果 → 4.0.40 修误读 → 4.0.41 禁仪式），都没止住。**
4.0.41 之后用户仍报：模型照旧复述四条，且**回合在复述后直接结束**（`done 0:02`、无工具执行）。

**用户决定：停掉改文案这条路。这条已定，不要再提议第三版措辞。**

**真正管用的是配置，不是 prose**（ECC 自己的拒绝消息最后一行就写着，只是被 UI 折进 `… +2 lines` 里了）：

```
ECC_GATEGUARD=off                                    # 或 0/false/off/disabled/disable
ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force
GATEGUARD_EXEMPT_GLOBS=**/__tests__/**,jest.setup.ts  # peaks 写入时取并集，不覆盖用户
```

**可推广的判断**：当一个**行为回路**扛过两轮 prose，第三轮 prose 大概率也不行 ——
去找**配置/开关**。prose 能改"怎么说"，改不了"模型为什么停在那里"。

## 另外两条闸门事实（先前不知道，会读成"我退步了"）

- **闲置约 30 分钟会删掉状态文件**（`SESSION_TIMEOUT_MS`），清空"已通过"清单 →
  **之前放行的文件会再次被拦**。那是闸门重置，不是模型犯错。
- 可用旋钮：`GATEGUARD_EXEMPT_GLOBS`（peaks 写入时**取并集**，不会覆盖用户写的）、
  `GATEGUARD_FACT_FORCE_FULL_DENIALS`、`GATEGUARD_DISABLED=1`。
- `denyResult` 用 `permissionDecision: 'deny'` + **exitCode 0** 真阻断；
  日志里 `Failed with non-blocking status code: No stderr output` 是**另一个 hook** 在报错，与本闸门无关。

相关：[[per-turn-obligations-belong-in-per-turn-output]]、[[peaks-loop-consumer-project-gaps]]
