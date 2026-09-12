---
name: preparefinalreview-is-evidence-less
description: prepareFinalReview 把 successCriteria 喂给 LLM 却不给任何证据，人工验收闸结构性失效
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff.md
---

`src/services/final-review/final-review-service.ts` 的 `prepareFinalReview(rid, opts)` 只做三件事：读 `.peaks/_runtime/<sessionId>/audit-goal/<rid>.json` 的 `successCriteria`，把这一串 JSON 拼成 userPrompt（`Approved goal's success criteria: ...\n\nPrepare the 4-dim review evidence.`），然后用 `opts.llmRunner.call(SYSTEM_PROMPT, userPrompt, {maxTokens: 3000})` 问一次 LLM。**没有工具、没有 diff、没有测试结果、没有 artifact 内容、没有任何 `artifactPaths` 注入** —— `LlmRunner` 接口本身也只有 `call(systemPrompt, userPrompt, opts)`。systemPrompt 却要求每条 dimension 产出 `verdict (pass | fail | inconclusive)` + `evidence (list of {kind, description, [artifact], [link]})` + `confidence (high | medium | low)`。

必然结局：模型手上只有"标准"，没有任何"事实"，于是要么诚实回答 `inconclusive` + `confidence: low`（本次实测 4/4 dimension 全 `inconclusive`、全 `low`），要么**编造 `pass`**。而 SKILL.md 把 `allPass === true` 当作"干净交接"信号 —— 于是这个闸只有两种结局：诚实但无用，或伪造的干净交接，且失败方向偏向"看起来通过"。

**Why:** 一个要求 evidence-graded verdict 的 gate 却不给它证据，等于让人凭空气判案；而且它不会报错、不会红，只会输出一份格式完全合法的 JSON。

**How to apply:** (a) 给这个 service 注入真实证据（测试计数、AC→test 映射、pre/post diff、artifact 路径），或 (b) 明确把它降级为"只汇总、不作裁决"并在文档里写死。**在任何流程里都不要把它的 `allPass` 当放行依据** —— 人工验收要读 `dimensions[].summary` 与真实证据文件，不能读 `allPass`。修的时候优先改 prompt 的输入侧，而不是改 systemPrompt 的措辞。
