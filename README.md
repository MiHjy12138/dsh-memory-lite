# dsh-memory-lite

### 记忆插件都在比「记得多」，它只比「查得省」。

你的 agent 不是记性差，是记忆太贵：**每轮注入记忆，就是每轮重发计费；读一次索引，就是上万字符全程占位。**

这个项目只优化一个数——**查一次记忆 11,819 → 738 字符（省 92%）**。
为此它刻意**不做**那些要你每轮付钱、或每轮维护的东西：

> 不自动注入 · 不建向量库 · 不起后台进程 · 不做知识图谱 · 不做侧栏面板 · 零依赖

留下的只有三样：**本地 markdown · 一个查询工具 · 一份能人工核对的溯源**。

[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)

作者的话：DSH本身的架构极其轻便：
一 · 基线上下文：`~\.dsh\AGENTS.md`，系统提示中出现 `Instructions from: ~/.dsh/AGENTS.md`
| 二 · 引用快照：`@deepseek-ai/dsh-session-reference`，输入框 `@` 可选历史会话
| 三 · 索引查询：`session-query-sqlite` + `dsh-tool-session-query`，搜「记忆」跨会话命中
本插件只是在此基础上做了个小扩展。让记忆和索引更加顺畅，全程DSH自己搞的，我只负责提灵感。所以有什么问题即时反馈，会改的(๑˃ᴗ˂)ﻭ

## 框架核心：三条不变量

整套设计只为守住这三条。功能可以加，**这三条破了就不成立**。

| # | 不变量 | 具体含义 |
|---|---|---|
| 1 | **零常驻** | 记忆不进系统提示。要查才查，只回命中片段。（插件版唯一的常驻是一个工具 schema，约 50–100 token） |
| 2 | **零依赖** | 只用 Node 内置模块——没有数据库、没有服务端、没有后台进程、没有 `npm install` |
| 3 | **可溯源** | 每条记忆都指得回「哪次会话的哪句话」，`verify` 能把原文拉出来。**不可核对的经验不是记忆，是猜测** |

于是有了那句推论，也是它便宜的全部原因：**读多少，由调用方决定**。
记忆库从不主动往上下文里塞东西，只在你问的时候，递回最近的那几条。

## 一眼看完

| 卖点 | 数字与事实 |
|---|---|
| **查询省 92%** | 查一次记忆 11,819 → 738 字符（12 组真实关键词实测） |
| **不注入记忆** | 不往系统提示里塞记忆内容；要查才查 |
| **两种用法** | 装成 DSH 插件（agent 自己会查）／当 CLI 用（不装任何东西） |
| **零依赖** | 只用 Node 内置模块，没有 `npm install`，没有后台进程 |
| **700 行** | 五个 `.mjs`／`.js`，一小时内能读完并改成你要的样子 |
| **条条可溯源** | 每条记忆带 `source`，`verify` 能把它拉回原文逐条核对 |
| **30 秒上手** | 用 `examples/` 的合成数据就能跑通全流程 |

记忆就是本地 markdown 文件——随时能读、能改、能 diff、能删。

---

## 两种用法，挑一个（也可以都用）

| | **方式 A：装成 DSH 插件** | **方式 B：当 CLI 用** |
|---|---|---|
| **适合** | 想让 agent 自己会查记忆 | 想完全手动，或不使用 DSH |
| **装什么** | 一条命令（不发 npm，直装 GitHub） | 什么都不装，下载即用 |
| **agent 怎么用** | 直接调用 `mem_query` 工具 | 自己敲 `node src/mem.mjs query "…"` |
| **每轮常驻成本** | 工具 schema 约 50–100 token | **0**（连 schema 都没有） |
| **记忆库放哪** | 工作区下的 `memory/`（或设 `MEM_HOME`） | 任意目录 |
| **采集** | 仍需跑一次 `mem.mjs collect`（见下） | 同左 |

> 两条入口共用 `src/lib.mjs` —— **一份实现，不会各改各的走偏**。

### 方式 A：装成插件

```bash
dsh plugin --profile web add github:MiHjy12138/dsh-memory-lite
```

装完**重启一次后端**（新增 bundle 不会热加载——这是 DSH 的装配规则）。

之后 agent 的工具表里会多出 `mem_query`，它的描述里写着「优先用它，别整份读记忆文件」。于是你不需要在 `AGENTS.md` 里写任何提示——**工具自己会说话**。

记忆库放在当前工作区的 `memory/` 下即可；也可以设 `MEM_HOME` 指向别处。

### 方式 B：当 CLI 用

```bash
git clone https://github.com/MiHjy12138/dsh-memory-lite
cd dsh-memory-lite

node src/mem.mjs query "powershell bom" --n 5   # 查
node src/mem.mjs collect                        # 采集
node src/build.mjs                              # 汇总
```

CLI 版跨平台（Windows / macOS / Linux），不依赖 DSH 的任何东西——**采集器**才需要读 DSH 的会话日志，其余环节与平台无关。

---

## 它凭什么便宜

| 常见做法 | 隐含代价 |
|---|---|
| 每轮自动注入记忆 | 注入一次，之后 **每轮随上下文重发、每轮计费** |
| 每次全量读记忆文件 | 一份索引动辄上万字符，读一次就永久占位 |
| 上向量库 / 记忆服务 | 引入依赖与运维，而且检索结果难以人工核对 |

第四条路：**分层 markdown + 关键词检索**——上面三种代价，它一样都不付。

省下的其实不是「存储」（记忆本来也没多大），而是**每一轮都要重发的那堆中间量**：
索引、总览、你只是为了找一条而读进来的整份文件。查询只在被问到时发生一次，
返回的也只有一小段命中片段。

---

## 和市面上的记忆插件比

DSH 插件市场里的记忆类插件，绝大多数属于「自动注入派」：auto-recall、pre-step
injection、injected every turn。功能确实全，代价是**每一轮都在为它付钱**。

| | 常见记忆插件 | dsh-memory-lite |
|---|---|---|
| 每轮注入 | 有（有人实测过约 2.7 KB/轮） | **0 字符**（不注入记忆内容） |
| 形态 | 插件进程 + npm 依赖 | 四个 `.mjs` ＋ 一个 72 行的插件入口（共 700 行） |
| 存储 | SQLite / 服务端 / 自有格式 | markdown + 一个 `index.json` |
| 查询 | 自动召回（你事先不知道召回了什么） | 显式 `mem_query`，回了什么一眼看得见 |
| 核对 | 多为「自动捕获后直接入库」 | `verify` 把每条拉回素材原文 |
| 卸载 | 改多处配置 + 卸依赖 | 删目录 |

**所以，什么时候该选别人？** 当你需要语义召回（搜「硬盘不认」也得命中「掉盘」）、
跨机器同步、知识图谱、或者一个可视化面板时——这些项目里都有现成的，本项目不做，也不打算做。

它只解决一个很具体的问题：**你已经知道自己要查什么，只是不想为了查它而读进一万个字符。**

---

## 特点

- **零依赖**：只用 Node 内置模块（`fs` / `zlib` / `path`），插件版也只用到宿主自带的 `dsh-tools`
- **摘要税只有 0.9%**：常驻的只有「一句话摘要」，正文按需加载（实测样本：全文 271,295 字符，摘要合计 2,461 字符）
- **查询省 91–94%**：只回命中的 3–5 条（实测 12 组，平均 738 字符/次）
- **每条可溯源**：记忆条目带 `source` 标记，`verify.mjs` 能把它拉回素材原文逐条核对
- **分层不膨胀**：SUMMARY（提炼句）/ INDEX（条目名）/ topics（正文）三层，每层都有体量上限
- **采集先过滤**：按 `source.kind` 只留真人输入与助手回复，实测滤掉约 68% 的注入噪音
- **人工提炼在环**：顶层那句话由人或 agent 提炼，不靠自动摘要——**质量上限来自这一步，不是来自脚本**
- **一份实现两条入口**：CLI 与插件共用 `src/lib.mjs`；插件坏了不影响 CLI，反之亦然

---

## 快速开始（CLI 路线）

```bash
# 1) 采集：扫会话日志 → 素材文件（.staging/*.md）
node src/mem.mjs collect

# 2) 提炼：读素材，写成 extracts/*.json
#    格式：[{ "kind": "lesson", "topic": "...", "text": "...", "source": "session-xxxxxxxx#123" }]
#    这一步由人或 agent 完成，是整套流程质量的来源

# 3) 汇总：extracts → SUMMARY.md / INDEX.md / topics/*.md / index.json
node src/build.mjs

# 4) 查询：只回命中的那几条
node src/mem.mjs query "powershell bom" --n 5

# 5) 核对：抽出来的条目能否对回原文
node src/verify.mjs examples/extracts-example.json --staging examples/staging
```

### 不碰真实日志，先跑一遍 demo

```bash
mkdir -p extracts
cp examples/extracts-example.json extracts/00.json
cp examples/memory.config.example.json memory.config.json

node src/build.mjs                    # 生成 SUMMARY / INDEX / topics / index.json
node src/mem.mjs query "BOM"          # 只回命中的那几条
node src/mem.mjs query "单元格" --n 3
node src/verify.mjs examples/extracts-example.json --staging examples/staging
```

`examples/SUMMARY.example.md` 就是上面这几步的产物。

---

## 架构

```
会话日志（jsonl + zstd 分帧）
        │
        │  mem.mjs collect        ← 只留真人输入 / 助手回复 / 压缩点，滤掉注入
        ▼
   .staging/*.md                  ← 素材：一条一行，行尾带 `#seq` 便于溯源
        │
        │  人 或 agent 提炼        ← 这一步是质量的来源，不自动化
        ▼
   extracts/*.json                ← [{kind, topic, text, source}]
        │
        │  build.mjs              ← 分类归并、生成 id、硬卡顶层规模
        ▼
┌─────────────────────────────────────────────────┐
│ SUMMARY.md   顶层：一句话提炼                     │ ← 定方向用
│ INDEX.md     索引：全库条目名，按主题分家          │ ← 找条目用
│ topics/*.md  明细：按主题分家，文件头写「何时翻它」 │ ← 取正文用
│ index.json   机读索引                            │
└─────────────────────────────────────────────────┘
        │
        ├── mem_query 工具（插件入口 index.js）  ← agent 自己查
        └── mem.mjs query "关键词"（CLI 入口）   ← 人手动查
                │
                ▼
        约 700 字符命中片段（而不是上万字符）
        ↑ 两条入口共用 src/lib.mjs
```

---

## 三层记忆模型

| 层 | 文件 | 什么时候读 | 体量约束 |
|---|---|---|---|
| 顶层 | `SUMMARY.md` | 会话开始定方向、或查询没命中时 | 只有提炼句，条数固定 |
| 索引 | `INDEX.md` | 找具体条目（**推荐用 `mem_query` 代替**） | 一行一条，全库 |
| 明细 | `topics/*.md` | 只读命中的那一个主题文件 | 按主题分家，各自独立 |

设计意图：**越往上越贵，所以越往上越短**。顶层是唯一「可能每会话都读」的东西，因此它只装一句话；正文全部下沉到按需层。

---

## 命令参考

| 命令 | 作用 | 常用参数 |
|---|---|---|
| `dsh plugin --profile web add github:MiHjy12138/dsh-memory-lite` | 装成插件，得到 `mem_query` 工具 | — |
| `node src/mem.mjs collect` | 扫会话日志产出素材 | `--all` 扫全部工作区｜`--force` 忽略增量判重 |
| `node src/mem.mjs list` | 列出待处理素材 | — |
| `node src/mem.mjs mark <id>` | 把素材标为已处理 | — |
| `node src/mem.mjs query "词 [词2]"` | 按关键词检索，只回命中片段 | `--n 8` 调整条数（默认 5） |
| `node src/build.mjs` | extracts → 分层记忆库 | — |
| `node src/verify.mjs <extract.json>` | 条目溯源核对 | `--staging <素材目录>` |

匹配规则（坦白说明能力边界）：

- 子串匹配，**不分词、无同义词**——搜不到就换词
- 词长加权：`词长 × (1 + log2(命中次数))`，多词累加
- 单字词被忽略（噪音太大）
- 多词之间是「或」：谁中算谁，靠得分排序
- 只在 `SUMMARY.md` 与 `topics/*.md` 里找，不碰 `INDEX.md`（避免索引与正文重复计分）

---

## Token 账（实测，不是估算）

| 量 | 实测值 |
|---|---|
| 常驻摘要（技能/索引一句话） | 2,461 字符，占全文 **0.91%** |
| 一次「读索引 + 读主题正文」 | 约 11,819 字符 |
| 一次查询输出 | 约 738 字符（**省 92%**） |
| 插件版新增常驻 | 工具 schema 约 50–100 token/轮 |

关键在复利：**读进上下文的内容会留驻**，之后每轮请求都随上下文重发。所以一次查询省下的 11,081 字符，要按「剩余轮数」放大：

| 会话场景 | 旧做法（读索引+正文） | 本方案（查询） |
|---|---|---|
| 30 轮会话，第 5 轮查 1 次 | 307,294 字符累计输入 | 21,798 字符累计输入 |

详见 [`docs/TOKEN-ECONOMY.md`](docs/TOKEN-ECONOMY.md)。

---

## 接入 agent

**插件版**：不用写任何提示。`mem_query` 的工具描述里已经写明「优先用它，别整份读记忆文件」，agent 看得到工具表。

**CLI 版**：在 `AGENTS.md`（或 `CLAUDE.md` / 系统提示）里加一行：

```markdown
- 记忆：有 `memory/` 时**先跑** `node memory/src/mem.mjs query "关键词 [关键词2]"`，
  只回命中片段；命中不够再按主题翻 `topics/<主题>.md`。
  **SUMMARY.md / INDEX.md 整份不读**。
```

**为什么是「先跑查询」而不是「先读 SUMMARY」**：读 SUMMARY 是「先花 2,864 字符买一个方向」，而查询是「直接拿命中结果」。命中就赚，不命中再退回去读导航——只有落空时才付那笔钱。

---

## 目录结构

```
dsh-memory-lite/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── package.json             # 同时声明 CLI（bin）与插件（main + dsh.bundle.patch）
├── index.js                 # 插件入口：注册 mem_query（72 行）
├── cordis.patch.yml         # 插件装配 patch（4 行）
├── marketplace-entry.json   # 提交到插件市场的条目
├── .gitignore               # 默认忽略你本地的记忆数据
├── .gitattributes           # 统一换行符（LF）
├── docs/
│   ├── ARCHITECTURE.md      # 数据流、文件格式、设计取舍
│   ├── TOKEN-ECONOMY.md     # 上下文成本的实测方法与账
│   └── GITHUB-SETUP.md      # 仓库描述 / topics / 发布步骤
├── src/
│   ├── lib.mjs              # 共享核心：解析 + 打分（CLI 与插件共用）
│   ├── mem.mjs              # CLI：采集 + 查询
│   ├── build.mjs            # 提炼汇总（分类可配置）
│   └── verify.mjs           # 溯源核对
└── examples/
    ├── staging/
    │   └── session-1a2b3c4d.md   # 素材长什么样（合成）
    ├── extracts-example.json     # 提炼输入长什么样
    ├── SUMMARY.example.md        # 输出长什么样
    ├── memory.config.example.json # 分类与顶层场景的配置示例
    └── plugin-smoke-test.mjs     # 插件冒烟测试：不装进 DSH 也能验 mem_query
```

---

## 设计取舍

**为什么要两个入口？**
因为「谁来查记忆」有两种真实场景：agent 自己查（插件），和人手动查/脚本里用（CLI）。两者共享同一份核心逻辑，代价是多了一层 `lib.mjs`——换来的是不必维护两份会走偏的实现。

**为什么不用向量库 / embedding？**
记忆条目通常是「结论型」的短句，条数在几百量级，关键词检索已经够用；而且**检索结果必须能被人一眼核对**——向量相似度做不到这一点。当记忆上万条、或必须做语义召回时，这个项目就不合适了。

**为什么顶层要人工提炼？**
自动摘要会把「能救命的那个细节」压成「一般的经验」。顶层只有二十几条，值得人写——这是整套流程里唯一无法自动化的部分，也是它有价值的部分。

**为什么用文件而不是数据库？**
可 diff、可读、可直接编辑、坏不了、删得掉。代价是没有事务与并发——对「单人 + 单 agent」的记忆场景不是问题。

**为什么采集时要按 `source.kind` 过滤？**
因为日志里大部分是注入内容（系统提示、插件消息、子 agent 回执）。在真实样本里，真人输入只占 32%——不滤掉，素材会被噪音淹掉。

---

## 适用边界

- **插件版**面向 DSH，安装后需要重启一次后端
- **CLI 版**跨平台；其中 `collect` 面向 DSH 会话日志（zstd 分帧的 jsonl），换平台需替换 `lib.mjs` 里的 `decodeFrames` / `filterEvents`，其余环节无关平台
- **Windows 上写 PowerShell 脚本时注意编码**：`.ps1` 必须带 UTF-8 BOM，否则 PowerShell 5.1 按 GBK 解码会崩（本项目脚本不受影响，但用的人会遇到）
- 记忆是**本地文件**，没有云端同步、没有加密——敏感内容请自行决定是否入库

---

## License

MIT © dsh-memory-lite contributors
