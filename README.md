<div align="center">

# peaks-loop

### 你说话,它替你跑完一整条工程流水线 —— 不止写代码,跑两次就沉淀成本地战术。

[![npm](https://img.shields.io/npm/v/peaks-loop?style=for-the-badge&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/peaks-loop)
[![publish](https://img.shields.io/github/actions/workflow/status/SquabbyZ/peaks-loop/publish.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=publish)](https://github.com/SquabbyZ/peaks-loop/actions/workflows/publish.yml)
[![ci](https://img.shields.io/github/actions/workflow/status/SquabbyZ/peaks-loop/ci.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=ci)](https://github.com/SquabbyZ/peaks-loop/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A524-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://www.npmjs.com/package/peaks-loop)
[![stars](https://img.shields.io/github/stars/SquabbyZ/peaks-loop?style=for-the-badge&logo=github&github=github&logoColor=white)](https://github.com/SquabbyZ/peaks-loop/stargazers)

[English](./README-en.md) · **简体中文**

</div>

<p align="center">
  <img src="./assets/readme/hero.svg" alt="peaks-loop 4.0.3 — Loop Engineering, Engineered" width="92%"/>
</p>

---

## 它是什么

peaks-loop 是装在你已经在用的 AI 编程工具(**Claude Code** / **Z Code**)上的一个编排层。你在对话框里发一条斜杠命令,它把整条工序替你跑完:拆工序 → 一道门一道门跑 → **坏在哪道停在哪道**。

你只要做两件事:**说一句话**,或者**在一个选项里挑一个**。

- **它不是新的 AI CLI。** 不抢你的 shell、不抢你的 prompt、不抢你的 IDE,也不替换 IDE 里任何一个原生入口。
- **你不用背 CLI、不用手写 manifest、不用手填表单。** 所有 CLI 命令对外隐藏、对 LLM 开放;命令由它替你跑,你只说话。
- **它不替你拍板。** 影响你资产的决策会拿来问你;其余的它自己跑。

---

## 30 秒上手

```bash
npm i -g peaks-loop
```

> **npm 11+ 请带一个 flag**:安装时 npm 会对"未经 allowlist 覆盖"的 install 脚本打一条 `install-scripts` 警告。**当前版本(npm 11.19)仍然会执行**这些脚本,所以装完就能用;但 npm 已明说这个默认值即将翻成"默认不执行"。为了不在那一天静默装到一个"有 CLI、没有 skills"的状态,请写全:
>
> ```bash
> npm i -g --allow-scripts=peaks-loop peaks-loop
> ```
>
> 装好后如果怀疑 skills 没落上,**目前没有一条 CLI 命令报告这个状态**(`peaks skill search` 查的是包内技能池,与 IDE 目录里装了没装无关),所以只能看目录本身:
>
> ```bash
> ls ~/.claude/skills | grep '^peaks-' | head    # 或你实际在用的 IDE 目录
> ```
>
> 空目录 = skills 没装上(CLI 本身仍可用)。这个"报告不出自己装了没装"的缺口记在 `.peaks/docs/backlog.md` §2.52a。

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
```

<sub>📦 其他 AI 编程工具适配中,欢迎共建 → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues) 提适配请求 / PR。</sub>

不需要记 CLI、不需要写 manifest、不需要切到第二个终端。**斜杠命令一发,后面的活它替你跑完。**

> **装这个包会多下载多少?** 这一版把变异测试引擎(`@stryker-mutator/core` +
> `@stryker-mutator/vitest-runner`)作为**运行时依赖**带上了 —— 消费者的安装会多出 stryker 引擎闭包
> **约 2.66 MB(9 个包)**。vitest 家族那 5.30 MB **只在你的机器上还没有 vitest 时**才会被自动装上,
> 而要跑 `peaks mut` 的项目**必然已经有 vitest**。**一句话:你装 peaks-loop 多下载了约 2.7 MB。**

---

## 装上以后，文件放在哪

`npm i -g` 之后,三类资产(**skills / agents / output-styles**)的**实体只存一份**,放在你自己 home 下的
`~/.peaks/{skills,agents,output-styles}`;每个 IDE 目录里(`~/.claude/…`、`~/.trae/…` 等)的条目都是**指向它的链接**
(目录用 junction,单个 `.md` 文件用符号链接)。所以升级 `peaks-loop` 时链接目标不变、不需要重建。

两件会直接影响你的事:

- **受管入口会在升级时被覆盖。** 由 peaks-loop 装进去的入口(比如 `~/.claude/agents/karpathy-reviewer.md`)旁边有一份
  `.peaks-managed` 边车标记归属,升级时内容会被更新。**想换成你自己的版本,删掉那份额边车即可** —— 没有标记的入口
  一律视为你自己建的,**永不被替换、也永不被删除**。
- **有些 Windows 机器上会退化成实体副本。** 没有开发者模式、也不是管理员时,建不出**文件**符号链接(目录用的 junction
  不受影响),安装器会写实体副本并在 stderr 明说 `installed as REAL COPIES because this host refused a symlink`。
  内容照样跟着升级走。

真源根可用环境变量 `PEAKS_HOME` 重定向。完整的模型、从 4.1.1 升级时会发生什么、怎么验证与回退 →
[`.peaks/docs/canonical-store.md`](./.peaks/docs/canonical-store.md)。

---

## 它能为你做什么

代码、内容、项目健康、issue 修复、自定义工作流 —— **每条域都有专门编排器**,按"门禁不通过就停"的纪律一条一条跑。
你要做的只是挑一条命令发出去:

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
| 🧪 **开闸审计** | `/peaks-audit` | 6 维审计,RD/QA 前的强制入口 |
| ✅ **4 维验收** | `/peaks-final-review` | 功能/问题/不引入新 bug/不破坏 |
| 🔌 **IDE 适配** | `/peaks-ide` | hooks + statusline + handle |
| ⏯ **从断点续跑** | `/peaks-resume` | 扫最深完成的门,AskUserQuestion |
| 🔬 **切片拆解** | `/peaks-slice-decompose` | 多 pass + 跨 pass 边 + 仲裁 |

每一条路,**一条斜杠命令**就能开跑。

---

## 为什么大家会选它

- **自然语言即界面** —— 你不学 CLI、不背命令。**用一条斜杠命令(比如 `/peaks-code xxx`)** 显式触发到对应编排器,后面说什么都行。LLM 替你跟 peaks-loop 跑命令。
- **门禁真挡事,不是装饰** —— 代码审计、安全扫描、QA 闸口、review 验收默认全开。**审计不通过就停,QA 没过就停**。
- **跑过的事会变成本地战术(bee)** —— 沉淀下来的东西落到你本地的 `~/.peaks/` 池子里,跑两次稳定就自动晋升;跑翻车的会让你重新定义。**下次说"跑那只"整套流程自动就位**,你那几只战术会跟着你的口味长。
- **搭在你已经用的工具上** —— 不是新发明一个 AI CLI,而是架在 **Claude Code** 和 **Z Code** 之上。不抢你的 shell、不抢你的 prompt、不抢你的 IDE。其他工具适配中,欢迎共建。
- **你拍板,它执行** —— 影响资产的决策都给你选;其余的它自己跑。**0 学习成本,1 分钟上手。**

---

## 强烈推荐 · 三个项目组合起来用

> **0 学习成本。** 让这几个项目一起用最大的好处,是它们的接口都对齐到"自然语言 + 一个选项":你说一句话,谁替你跑命令、按什么闸门、按什么战术手册,完全不用你记。

| 角色 | 项目 | 一句话 |
| --- | --- | --- |
| **结晶与门禁** | [**peaks-loop**](https://github.com/SquabbyZ/peaks-loop) ← 你在这里 | 装上就有 PRD/RD/QA/UI/SC/TXT 一整条工程链 + 沉淀 |
| **战术手册** | [affaan-m/ECC](https://github.com/affaan-m/ECC) | Claude Code 上能拿到的最好用的战术、技能、SOP 集合 |
| **流程与纪律** | [obra/superpowers](https://github.com/obra/superpowers) | brainstorming / TDD / debugging / code-review 等流程纪律,每条都自带硬退出条件 |

**用起来就一句话**:把上面两个仓库都 clone 到本地,peaks-loop 装上,剩下的交给 LLM —— 它会按需取用、按纪律守门、按战术落地、按需求沉淀。

---

## FAQ

<details>
<summary><b>它跟 Claude Code / Z Code 是什么关系?</b></summary>

它是**搭在上面**,不是替换。它不抢你的 shell、不抢你的 prompt、不抢你的 IDE,你照常用。**其他 AI 编程工具适配中,欢迎共建** → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)。

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

**从"代码专用"扩成"多域编排":** 新增 `peaks-content`(内容生产)、`peaks-doctor`(项目健康)、`peaks-issue-fix-orchestrator`(批量修 issue)、`peaks-sop`(自定义 SOP)四条域编排链,加上 `peaks-solo` 分诊员按你说话自动判断该走哪一域。完整变更 → [`CHANGELOG.md`](./CHANGELOG.md)。

</details>

---

## 链接

- 全部技能清单 → [`skills/`](./skills/)
- 更新日志 → [`CHANGELOG.md`](./CHANGELOG.md)
- 提问 → [GitHub Issues](https://github.com/SquabbyZ/peaks-loop/issues)
- 组合推荐: [affaan-m/ECC](https://github.com/affaan-m/ECC) · [obra/superpowers](https://github.com/obra/superpowers)

---

<div align="center">

MIT License · Made by [SquabbyZ](https://github.com/SquabbyZ) · 中文版 · [English version](./README-en.md)

</div>
