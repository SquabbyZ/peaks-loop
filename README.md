<div align="center">

# peaks-loop

### 你说话,它替你跑完一整条工程流水线 —— 不止写代码,跑两次就沉淀成本地战术。

[![npm](https://img.shields.io/npm/v/peaks-loop?style=for-the-badge&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/peaks-loop)
[![publish](https://img.shields.io/github/actions/workflow/status/SquabbyZ/peaks-loop/publish.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=publish)](https://github.com/SquabbyZ/peaks-loop/actions/workflows/publish.yml)
[![ci](https://img.shields.io/github/actions/workflow/status/SquabbyZ/peaks-loop/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=ci)](https://github.com/SquabbyZ/peaks-loop/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://www.npmjs.com/package/peaks-loop)
[![tests](https://img.shields.io/badge/tests-5%2C439%20passed-22c55e?style=for-the-badge&logo=vitest&logoColor=white)](#status)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=for-the-badge&logo=github&github=github&logoColor=white)](https://github.com/SquabbyZ/peaks-loop/stargazers)

[English](./README-en.md) · **简体中文**

</div>

<p align="center">
  <img
    src="https://raw.githubusercontent.com/SquabbyZ/peaks-loop/main/examples/video-demo/preview/peaks-loop-demo.gif"
    alt="peaks-loop 30 秒演示(前 18 秒 · install + 斜杠命令 + 5 域 + 沉淀成 bee)"
    width="92%"
    style="border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,0.55); display: block;"
  />
  <br>
  <sub>👆 18s 循环 GIF(完整 30s mp4 不再随 npm 包发布,见 <a href="https://github.com/SquabbyZ/peaks-loop/releases">GitHub Release</a> · 13MB · 480p)</sub>
</p>

---

## 它是什么

peaks-loop 是一个 **Loop Engineering 结晶系统**,不是工作流工具 —— 你跑过的工作里,沉淀下来的不是「流程」,是一套**可被 karpathy 风格工程化、又被 darwin 风格独立验证**的 Loop Engineering 方法资产。**Loop engineering 结晶系统** 的工程实现见 [`docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md`](./docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md)。

| 资产层 | 角色 | 一句话 |
| --- | --- | --- |
| **Loop Engineering 资产** | 方法系统,一等公民 | 回答「为什么有这条 loop、何时触发、怎样算成功、如何改进」 |
| **Bee 资产** | 可执行体,一等公民 | Loop Engineering 资产的可执行体,蜂群里的每只 bee |
| **Workflow Trace (执行轨迹)** | 证据,**不是**主资产 | 不可变的单次执行记录,供结晶与评估反查,不是用户对外的产品 |
| **Evolution Evaluation (反漂移)** | 反漂移闸门,强制项 | 每次改进都要有独立上下文的评估者 + 反方怀疑者,过了才留,不过就回滚 |

- **工程化每条规则 = karpathy 风格 · 验证每次改进 = darwin 风格** —— 两条缺一不可。砍掉 karpathy,原则没人写清;砍掉 darwin,改得对不对没人验。这一对是 co-equal 的双层结构,不是先后两步。
- `/peaks-code` 是 **code-domain** 长任务 Loop Engineering 编排器,不是通用编排器;非代码域(`peaks-content` / `peaks-doctor` / `peaks-issue-fix-orchestrator` / `peaks-sop`)都是独立的 `peaks-*` 蜂,不是 `peaks-code` 的子类。
- 跑两次稳定就沉淀成本地战术(bee);跑翻车的会让你重定义。bee 跟着你的口味长。

---

## 30 秒上手

```bash
npm i -g peaks-loop
```

装好之后,在你已经用的 **Claude Code** 或 **Z Code** 对话框里发一条**显式命令**(必须以斜杠开头,才会触发 peaks-loop):

```
/peaks-code 帮我熟悉下当前的项目
```

剩下的就交给 peaks-loop —— 它会按这条命令的语义判断该走哪一域,用对应的编排器拆工序,一道门一道门跑,**坏在哪道停在哪道**,中间不会扔半截给你。

其他常用的显式命令:

```
/peaks-content                 帮我把今天这篇推文写完发出
/peaks-doctor                  帮我体检一下这个仓库
/peaks-issue-fix-orchestrator  帮我把 upstream 的 30 个 open issue 修一批
/peaks-sop                     帮我把团队的发布流程沉淀成 SOP
/peaks-solo                    这套打法以后还会用,沉淀成本地战术
/peaks-solo                    按上次那样再跑一次
```

<sub>📦 其他 AI 编程工具适配中,欢迎共建 → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues) 提适配请求 / PR。</sub>

不需要记 CLI、不需要写 manifest、不需要切到第二个终端。**斜杠命令一发,后面的活它替你跑完。**

---

## 它能为你做什么

代码、内容、项目健康、issue 修复、自定义工作流 —— **4.x 已经覆盖五条域**,每条域都有专门编排器,按"门禁不通过就停"的纪律一条一条跑。

| 域 | 你发这条命令 | 它会做什么 |
| --- | --- | --- |
| 💻 **代码域 (code-domain) only** | `/peaks-code 帮我实现这个功能` | PRD → RD → 实现 → QA → UI → 切片,跑完交你拍板 |
| 💻 **代码域 (code-domain) only** | `/peaks-code 这个 bug 帮我修一下` | 复现 → 改 → review → 测试,同日 ship |
| 📝 **内容** | `/peaks-content 帮我把这篇推文写出来再发` | 草稿 → 编辑 → 调性检查 → 发布 → 归档,中间不跳步 |
| 🩺 **项目健康** | `/peaks-doctor 帮我体检一下这个仓库` | 红线审计 + L3 doctor 检查 + 转 OpenSpec,坏在哪道停在哪道 |
| 🐛 **批量修 issue** | `/peaks-issue-fix-orchestrator 帮我把 upstream 的 30 个 open issue 修一批` | 调研 → 分类 → 参考 PR → 逐个修复 + commit + PR 草稿 |
| 📋 **自定义工作流** | `/peaks-sop 帮我把团队的发布流程沉淀成 SOP` | 自然语言描述 → 自动生成 + 校验 + 注册成可执行的 SOP |
| 🔁 **跑过一次再来** | `/peaks-solo 按上次那样再跑一次` | 调出你已经沉淀好的战术,自动复跑 |
| 🆕 **接手陌生仓库** | `/peaks-code 这是新仓库,先带我过一遍` | 摸清结构、识别风险点、给一个上手顺序 |
| 🧠 **沉淀自己的打法** | `/peaks-solo 这套打法以后还会用,沉淀一下` | 变成你本地常驻的战术,下次说"跑那只"就行 |

每一条路,**一条斜杠命令**就能开跑。

---

## 为什么大家会选它

- **自然语言即界面** —— 你不学 CLI、不背命令。**用一条斜杠命令(比如 `/peaks-code xxx`)** 显式触发到对应编排器,后面说什么都行。LLM 替你跟 peaks-loop 跑命令。
- **门禁真挡事,不是装饰** —— 5,439 个测试用例、QA 闸口、review 验收默认全开。**审计不通过就停,QA 没过就停**。
- **跑过的事会变成本地战术(bee)** —— 沉淀下来的 loop engineering 落到你本地的 `~/.peaks/` 池子里,跑两次稳定就自动晋升;跑翻车的会让你重新定义。**下次说"跑那只"整套流程自动就位**,你那几只战术会跟着你的口味长。
- **搭在你已经用的工具上** —— 不是新发明一个 AI CLI,而是架在 **Claude Code** 和 **Z Code** 之上。不抢你的 shell、不抢你的 prompt、不抢你的 IDE。其他工具适配中,欢迎共建。
- **你拍板,它执行** —— 影响资产的决策都给你选;其余的它自己跑。**0 学习成本,1 分钟上手。**

---

## 装上以后的几道闸门

| 闸门 | 默认状态 | 用来挡什么 |
| --- | --- | --- |
| 单元测试 / 集成测试 | ✅ 开 | 代码层面的回归 |
| 代码审计 (lint / prose / type) | ✅ 开 | 写法与意图漂移 |
| 安全扫描 | ✅ 开 | 凭据、SSRF、注入、危险 IO |
| QA 复核 | ✅ 开 | 任务级闸门,坏在哪道停在哪道 |
| review 验收 | ✅ 开 | 改完不立刻出门,review 通过才出门 |

**所有闸门默认开,你想关哪一道才需要单独说。**

---

## 当前状态 · 4.x 正式版

| | |
| --- | --- |
| **最新版本** | [`4.0.0-beta.34`](https://github.com/SquabbyZ/peaks-loop/releases) — 4.x 正式版筹备中 |
| **覆盖域** | 代码(`peaks-code`) · 内容(`peaks-content`) · 项目健康(`peaks-doctor`) · 批量修 issue(`peaks-issue-fix-orchestrator`) · 自定义 SOP(`peaks-sop`) · 通用原语(`peaks-solo` 分诊 / `peaks-resume` 续 / `peaks-status` 看 / `peaks-test` 测) |
| **沉淀池** | `~/.peaks/` 本地池 · 跑两次自动晋升成 bee · 跑翻车让你重定义 · bee 跟着你的口味长 |
| **测试套件** | 5,439 passed · 19 skipped · 0 failed |
| **适配 IDE** | ✅ Claude Code · ✅ Z Code · 🚧 Codex / Cursor / Trae / Tongyi Lingma / Hermes / OpenClaw / Qoder(适配中,欢迎共建) |
| **依赖运行时** | Node ≥ 20 |
| **License** | MIT |

---

## 强烈推荐 · 四个项目组合起来用

> **0 学习成本。** 这是组合起来用最大的好处 —— 不只是效果俱佳,更是因为这四个项目的**接口对齐到了"自然语言"**,你只需要说一句话,谁替你跑命令、按什么闸门、按什么战术手册,完全不用你记。

<p align="center">
  <a href="https://github.com/affaan-m/ECC">
    <img src="https://img.shields.io/badge/ECC-affaan--m-6366f1?style=for-the-badge&logo=github&logoColor=white" alt="affaan-m/ECC" />
  </a>
  &nbsp;
  <a href="https://github.com/Egonex-AI/Understand-Anything">
    <img src="https://img.shields.io/badge/Understand--Anything-Egonex--AI-22c55e?style=for-the-badge&logo=github&logoColor=white" alt="Egonex-AI/Understand-Anything" />
  </a>
  &nbsp;
  <a href="https://github.com/obra/superpowers">
    <img src="https://img.shields.io/badge/superpowers-obra-f59e0b?style=for-the-badge&logo=github&logoColor=white" alt="obra/superpowers" />
  </a>
</p>

| 角色 | 项目 | 一句话 |
| --- | --- | --- |
| **结晶与门禁** | [**peaks-loop**](https://github.com/SquabbyZ/peaks-loop) ← 你在这里 | loop engineering 结晶系统,装上就有 PRD/RD/QA/UI/SC/TXT 一整条工程链 + 沉淀 |
| **战术手册** | [affaan-m/ECC](https://github.com/affaan-m/ECC) | everything-claude-code:Claude Code 上能拿到的最好用的战术、技能、SOP 集合 |
| **代码理解** | [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) | 任意仓库,一句话读懂 —— 让 LLM 真正"理解"项目,而不是猜 |
| **流程与纪律** | [obra/superpowers](https://github.com/obra/superpowers) | brainstorming / TDD / debugging / code-review 等流程纪律,每条都自带硬退出条件 |

**用起来就一句话**:把上面三个仓库都 clone 到本地,peaks-loop 装上,剩下的交给 LLM —— 它会按需取用、按纪律守门、按战术落地、按需求沉淀。

### 致敬

peaks-loop 的两条工程脊柱直接来自这两个项目:

- [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) — 把"工程化每一条规则"刻进我们的方法层。
- [alchaincyf/darwin-skill](https://github.com/alchaincyf/darwin-skill) — 把"演化校验每一次改进"刻进我们的反漂移闸门。

---

## FAQ

<details>
<summary><b>它跟 Claude Code / Z Code 是什么关系?</b></summary>

它是**搭在上面**,不是替换。peaks-loop 不抢你的 shell、不抢你的 prompt、不抢你的 IDE。它在 Claude Code / Z Code 这两个一等公民适配里跑,你照常用。**其他 AI 编程工具适配中,欢迎共建** → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)。

</details>

<details>
<summary><b>我需要记 CLI 命令吗?</b></summary>

不需要。你只用自然语言或选选项,LLM 替你跑命令。**所有 CLI 命令对外隐藏,对 LLM 开放**。

</details>

<details>
<summary><b>沉淀下来的战术会一直留在本地吗?</b></summary>

会。沉淀落在你本地的池子里,只对你生效。命名、复用、迭代都是你说了算;跑翻车的会让你重新定义。

</details>

<details>
<summary><b>它会自己改我的代码吗?</b></summary>

改,但过门禁。**审计不通过 = 不出门**,**QA 没过 = 不出门**,**review 不通过 = 不出门**。它替你跑,但每道门都给你审。

</details>

<details>
<summary><b>跟 3.x 比,4.x 有什么不同?</b></summary>

**最大的不同:从"代码专用"扩成"多域编排系统"。** 4.x 不再只是写代码 —— 新增了 `peaks-content`(内容生产)、`peaks-doctor`(项目健康)、`peaks-issue-fix-orchestrator`(批量修 issue)、`peaks-sop`(自定义 SOP)四条域编排链,加上 `peaks-solo` 分诊员按你说话自动判断该走哪一域。再加 9 个 IDE 适配、结晶系统重命名、post-run crystallization 机制、5,439 tests 通过。完整变更 → [`CHANGELOG.md`](./CHANGELOG.md)。

</details>

---

## 链接

- 全部技能清单 → [`skills/`](./skills/)
- 更新日志 → [`CHANGELOG.md`](./CHANGELOG.md)
- 提问 → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)
- 致敬: [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) · [alchaincyf/darwin-skill](https://github.com/alchaincyf/darwin-skill)
- 组合推荐: [affaan-m/ECC](https://github.com/affaan-m/ECC) · [Egonex-AI/Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) · [obra/superpowers](https://github.com/obra/superpowers)
- 沉淀设计 → [`docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md`](./docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md)
- Loop Engineering 结晶设计 → [`docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md`](./docs/superpowers/specs/2026-07-07-peaks-loop-loop-engineering-crystallization-design.md)

---

## 发布(Trusted Publishing · OIDC)

本仓库发布链路**不**使用 npm token,改用 **Trusted Publishing + OIDC**:

- 维护者**不需要**也不会持有 `NPM_TOKEN` —— `~/.npmrc` 已被清理,npmjs.com 已把 Publishing access 切到 disallow tokens。
- 触发方式 1:`git tag vX.Y.Z && git push --tags`(走 `.github/workflows/publish.yml` 的 `push: tags: v*.*.*` 触发器)。
- 触发方式 2:GitHub UI → Actions → publish → Run workflow(手动兜底,可用于 dry-run / 补发)。
- 每次发布跑完整链路:`install → typecheck → build → vitest → changesets version → changesets publish`,全部通过才会真正落到 npm。
- 维护者的本地动作只有两步:`pnpm changeset` 写变更说明 + 合并 PR(剩下的 CI 自动跑)。

**npmjs 侧一次性配置**(本 slice 完成后由人工做一次):

1. 登录 https://www.npmjs.com → Settings → Trusted Publishers → Add GitHub Action。
2. Owner / Org:`SquabbyZ` · Repository:`peaks-loop` · Workflow filename:`publish.yml` · Environment name:留空。
3. 保存。

**撤销** = npmjs 端删 trusted publisher,**无需** rotate token。

**常见故障**:

| 现象 | 原因 | 修法 |
|------|------|------|
| publish 步骤报 `Cannot get JWT` | 缺 `id-token: write` | 检查 `.github/workflows/publish.yml#permissions` |
| publish 步骤报 `ENEEDAUTH` 或 `404 from registry.npmjs.org` | npmjs 端没配 trusted publisher | 走上面的 3 步配置 |
| `changeset version` 把 `package.json` 改了我没想要 | 漏掉了手动 version | 提交前先本地 `pnpm changeset version`,CI 端为 no-op |
| tag 推了但 CI 没跑 | tag 格式不符 `v*.*.*` | 检查 `git tag` 输出 |

详细 RD 文档见 [`docs/superpowers/slices/slice-s1-trusted-publish.md`](./docs/superpowers/slices/slice-s1-trusted-publish.md)。

---

<div align="center">

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ) · 中文版 · [English version](./README-en.md)

</div>