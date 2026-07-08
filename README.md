# Peaks Loop

[English](./README-en.md) | **简体中文**

[![npm](https://img.shields.io/npm/v/peaks-loop?style=flat-square&logo=npm)](https://www.npmjs.com/package/peaks-loop)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=flat-square&logo=github)](https://github.com/SquabbyZ/peaks-loop/stargazers)

<p align="center">
  <a href="https://raw.githubusercontent.com/SquabbyZ/peaks-loop/main/examples/video-demo/preview/peaks-loop-demo.mp4">
    <img src="https://raw.githubusercontent.com/SquabbyZ/peaks-loop/main/examples/video-demo/out/zh-closing-960.png" alt="peaks-loop demo (点击播放)" width="100%" style="border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.55);">
  </a>
  <br>
  <sub>👆 点击图片播放 60s 演示</sub>
</p>

## 它是什么

### loop engineering 的工程实现

**peaks-loop 是你的 Loop Engineering 结晶系统 —— 不是工作流工具。** 它从真实完成的工作里把 loop engineering 资产结晶出来,只通过被验证的改进让它们进化。你只用自然语言和选择操作系统,所有结构化操作由 LLM 代办。

产品遵循四层资产模型与 karpathy × darwin 双层纪律,两者缺一不可:

- **四层资产模型**:Loop Engineering 资产(方法体系,一等公民)+ Bee 资产(可执行体,一等公民)+ Workflow Trace(执行轨迹,只作证据,不作资产)+ Evolution Evaluation(反漂移闸门,变更必经)。
- **karpathy × darwin 双层纪律**:karpathy 工程化每一条规则(failure modes + imperative→declarative rewrite + self-check + out-of-scope);darwin 校验每一次改进(单对象 + 单维度 + 独立上下文评估 + ratchet 防回退)。两层是平行的伙伴,谁都不是谁的子集 —— 详见 `.peaks/standards/loop-engineering-guidelines.md` 与上游参考 `multica-ai/andrej-karpathy-skills`、`alchaincyf/darwin-skill`。
- **post-run crystallization**:`loop_release` 与 `bee_release` 只在一次真实任务跑完后才写入;pre-run 永远是 scratch。沉淀触发支持四种,user explicit 优先级最高。
- **Human-NL-Choice-Only**:你只说话或选择,LLM 替你跑 CLI;禁止手写 JSON / manifest / form field。

### peaks-code 是 code-domain 唯一的入口

`peaks-code` 是 loop engineering 在 **代码域** 的长任务编排器,管 PRD、RD、QA、UI、SC、TXT 这一长串工序的主调度,也是你日常跟 peaks-loop 说话时最常打交道的那个角色。它**不是通用编排器** —— 研究 / 内容 / 产品等其他域各自是独立的 `peaks-*` 技能,复用同一份 Loop Engineering 准则。详见 Loop Engineering 设计 `docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md` §0.4 + RL-8,以及 sediment 设计 `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md`。

召之即来,事完收队,**不跳步,不半截扔给你**。它不是新发明一个 AI CLI,而是架在你已有的 Claude Code / Codex / Copilot 之上,把它们都调成同一支团队,只对你这一个开发者的口味。

### peaks-solo 是分诊员(新增,4.0.0-beta.5)

如果**你不知道该用哪个 peaks-* 技能**,直接用 `/peaks-solo` 描述你的诉求就行。它会替你分诊:有合适的 leaf 就透明转交,没合适的就自己规划 + 跑(deep-search / WebSearch / Bash / Edit markdown),跑完回头问你要不要沉淀。`/peaks-code` / `/peaks-content` / `/peaks-doctor` 等老入口照常可用,**0 breaking**。

**每一步都有强退出条件**:审计不通过就停,QA 没过就停,任何一道门失败 = 全流程停。你不必追着它催、也不必替它补,它跑完一道再交你拍板,拍完再走下一道。

#### 门禁不是装饰 —— 5439 tests passed · 19 skipped · 0 failed

每一行代码都过自己的门:测试套件 5,420 个用例真挡得住事,不是装饰。门禁不是写给用户看的,是写给自己看的。

#### 做这个项目的只有一个人,工程师口味:

- **极客精神。**
- **你跟 AI 之间只该用自然语言讲话,没有 CLI 表面给你。**
- **单测覆盖率和门禁审计真挡得住事,不是装饰。**
- **严于律己,宽以待人 —— 自己写的代码过自己的门,使用者随便怎么说都能跑通。**
- **AI 使用水平的下限平权:你不需要懂 prompt engineering,就跟说话一样用。**

这套项目级硬规则也写进了 `~/.peaks/memory/`,不是口号,是被工具链守住的红线。

## 装了你有什么战术角色

先给你上的是 `peaks-code`,主官。它是 peaks-loop 默认入口,管 PRD、RD、QA、UI、SC、TXT 这一长串工序的主调度,也是你日常跟 peaks-loop 说话时最常打交道的那个角色。

它能做的:
- 写长任务代码(端到端需求 → PRD → 实现 → QA),一道门一道门跑,坏在哪道停在哪道
- 修 bug 当天发,改完顺手过审 + 测试,不是改完就完
- 帮你做 / 接 / 拆长跑的需求,把一个模糊需求一路剥到能落地的实现

它一句话能扛完的活,你都不必开第二个终端。它对测试覆盖率、审计门、卡点阻断一视同仁:跑不到位的活不交付,跑歪的活直接退回重跑。

它既是装好就立刻能用的那个入口,也是后面要长出来的内建角色的调度口;它内部有一套连续审计、QA 闸口、review 验收,默认打开,你想关哪一道才需要单独说。

其他内置 loop engineering,敬请期待。

## 你也能沉淀自己的 loop engineering

跑过一次还想跑,说一句话让它永久驻场。

你沉淀的是 loop engineering(战术套路),不是简单的 skill(动作招式)。下次说"跑那只",整套流程自动就位。

它落到你本地的一个池子里,只对你生效。命名、复用、迭代都是你说了算:跑过两遍稳定的会被抬高,跑翻车的会让你重新定。决策影响资产的,你拍板。

这套机制关键不是"工具给你造了多少只 bee",而是你那几只 bee 一直在跟着你的口味长 —— 你提一句,它长一点。

## 上号

```bash
npm i -g peaks-loop
```

装完一句话接活。

## 顺便说一句

这个仓库以前叫 [`peaks-cli`](https://github.com/SquabbyZ/peaks-cli),现在叫 `peaks-loop`。

里面的技能从 `peaks-code`(单角色)演化到 `peaks-code`(带门禁的代码域).两边都还在,只是分工不同:`peaks-code` 如今是给单任务跑流程用的那个老入口,`peaks-code` 接管了端到端的主路径。

事情一直没换过:你说话,它替你排工程门禁,坏哪道停哪道,你来拍板。

你只需要把这一个仓库装好,后面每次跑新需求,都有现成的战术角色等你点。

---

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ)

- 全部技能清单 → [`skills/`](./skills/)
- 设计文档 → [`docs/`](./docs/)
- 更新日志 → [`CHANGELOG.md`](./CHANGELOG.md)
- 提问 → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)
