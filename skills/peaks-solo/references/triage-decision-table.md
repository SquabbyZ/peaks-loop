# peaks-solo — Triage Decision Table

> 关键词 → leaf skill 快速映射。peaks-solo 在 §3 triage 决策流里先扫本表做"启发式预判",再用 `peaks skill search --query "<NL>"` 做精确匹配。
> 匹配规则:case-insensitive substring(命中即行;同 NL 多行命中 → AskUserQuestion 多选)。

| keyword | → | leaf skill |
|---|---|---|
| code / 代码 / 改 bug / 写功能 / 全流程 / 端到端 / PR / 测试覆盖 / 改 src | → | /peaks-code |
| 文档 / article / blog / 内容 / 写稿 / 内容工作流 / 公众号 / 长文 | → | /peaks-content |
| 健康 / health / 体检 / audit / 报告 / doctor report / 项目诊断 | → | /peaks-doctor |
| issue / 修 issue / sweep / 批量修 / open issue 处理 | → | /peaks-issue-fix-orchestrator |
| SOP / 流程 / 工作流 / 审批 / 门禁 / 标准操作 | → | /peaks-sop |
| 性能 / perf / 慢 / 优化 / latency / 响应时间 | → | /peaks-perf-audit (or 自规划) |
| 安全 / security / 漏洞 / vulnerability / OWASP | → | /peaks-security-audit (or 自规划) |
| 状态 / status / 进度 / 现在到哪 / 当前在哪一步 | → | /peaks-status |
| 跑测试 / test / vitest / unit test | → | /peaks-test |
| 恢复 / resume / 继续 / 接上次 | → | /peaks-resume |
| 不知道 / 随便 / 帮我 / 你帮我决定 / 我想做点东西 | → | peaks-solo triage (this skill) |
| 切片 / slice / 拆解任务 / 大任务拆小 | → | /peaks-slice-decompose |
| 想法 / brain-storm / 创意 / 探索思路 | → | /peaks-ide |
| 最终审查 / final review / 验收 / 4-dim evidence | → | /peaks-final-review |
| 研究 / research / 信息查询 / GitHub trending / top 10 / 调查 | → | (no leaf) → 自规划(deep-search / WebSearch) |
| 一句话需求 / 一次性 / 单次性 | → | peaks-solo 自规划兜底 |

## 使用说明

1. **先扫表,再跑 search。** 表是 O(N) 的 substring 命中;跑 `peaks skill search` 是兜底。两者结果不一致时,以 search 为准(search 读的是 live frontmatter)。
2. **多行命中 → AskUserQuestion 多选,**模板见 SKILL.md §3.1。
3. **(e) "都不对" → 自规划兜底。** 走 SKILL.md §4。
4. **空表条目:** "研究 / 信息查询 / GitHub trending / top 10" 等一次性信息查询,**当前 skill 池没有专属 leaf**,peaks-solo 直接走自规划(deep-search / WebSearch)。
5. **本表是 opportunistic 表,**不是 exhaustive 表。S2/S3 后续可在 dogfood 中发现新关键词补行。