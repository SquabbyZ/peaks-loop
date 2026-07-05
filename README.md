# ⛰️ Peaks Loop

[English](./README-en.md) | **简体中文**

[![npm](https://img.shields.io/npm/v/peaks-loop?style=flat-square&logo=npm)](https://www.npmjs.com/package/peaks-loop)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=flat-square&logo=github)](https://github.com/SquabbyZ/peaks-loop/stargazers)

## 它是什么

loop engineering 的工程实现。

peaks-loop 就是你的 AI 战术小队,24 小时待命,随时接活。它把一套工程门禁、编排、回放都装进你本地的 AI CLI 里,装好之后,你说一句话,它替你把整套流程跑完再交还给你。

召之即来,事完收队,不跳步,不半截扔给你。它不是新发明一个 AI CLI,而是架在你已有的 Claude Code / Codex / Copilot 之上,把它们都调成同一支团队,只对你这一个开发者的口味。

每一步都有强退出条件:审计不通过就停,QA 没过就停,任何一道门失败 = 全流程停。你不必追着它催、也不必替它补,它跑完一道再交你拍板,拍完再走下一道。

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
npx peaks-loop install
```

装完一句话接活。

顺手看一段 30 秒 walk-through:[`examples/video-demo/`](./examples/video-demo/)

## 顺便说一句

这玩意儿以前叫 `peaks-solo`,后来改 `peaks-code`,现在叫 `peaks-loop`——一只小队,要长成你机器上天天替你出力的那群战术角色。

名字一直在变,事情一直没变:你说话,它替你跑完整套工程流程,坏哪道停哪道,你来拍板。

最早版本只有一个角色,所以叫 solo。后来内建角色一只一只多起来,沉淀的 bee 也开始成池,它才真正是一支小队,改名 loop。字面每次都丢一点过去的故事,内核却没换过:你不必替它排流程,它替你排。

今天装的还是那一套工程实现,只是旁边多了一些名字像队友的角色、几只你随时能叫起来的 bee、和一个你拍板它才走的门禁次序。你只需要把这一个仓库装好,后面每次跑新需求,都有现成的队伍等你点。

---

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ)

- 全部技能清单 → [`skills/`](./skills/)
- 设计文档 → [`docs/`](./docs/)
- 更新日志 → [`CHANGELOG.md`](./CHANGELOG.md)
- 提问 → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)
