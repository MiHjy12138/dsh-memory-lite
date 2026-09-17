# dsh-memory-lite

**给 AI agent 的按需记忆库** —— 把会话历史提炼成分层记忆；查的时候只回命中片段，不读整份索引，不每轮重发。

[![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-blue)](package.json)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)

零依赖、纯 CLI、记忆是本地的 markdown 文件——随时能读、能改、能 diff、能删。

---

## 它解决什么问题

给 agent 加长期记忆，常见三种做法，都不便宜：

| 常见做法 | 隐含代价 |
|---|---|
| 每轮自动注入记忆 | 注入一次，之后**每轮随上下文重发，每轮计费** |
| 每次全量读记忆文件 | 一份索引动辄上万字符，读一次就永久占位 |
| 上向量库 / 记忆服务 | 引入依赖与运维，而且检索结果难以人工核对 |

本项目走第四条路：**分层 markdown 文件 + 关键词检索**。

一句话概括它的取舍：**把「读多少」的决定权交还给调用方**——记忆库不主动往上下文里塞东西，只在被问到时递回最近的那几条。

---

## 特点

- **零依赖**：只用 Node 内置模块（`fs` / `zlib` / `path`），没有 `npm install`
- **摘要税只有 0.9%**：常驻的只有「一句话摘要」，正文按需加载（实测样本：全文 271,295 字符，摘要合计 2,461 字符）
- **查询省 91–94%**：`query` 只回命中的 3–5 条（实测 12 组，平均 738 字符/次）
- **每条可溯源**：记忆条目带 `source` 标记，`verify.mjs` 能把它拉回素材原文逐条核对
- **分层不膨胀**：SUMMARY（提炼句）/ INDEX（条目名）/ topics（正文）三层，每层都有体量上限
- **采集先过滤**：按 `source.kind` 只留真人输入与助手回复，实测滤掉约 68% 的注入噪音
- **人工提炼在环**：顶层那句话由人或 agent 提炼，不靠自动摘要——**质量上限来自这一步，不是来自脚本**
- **可退化**：删掉整个目录就回到普通工作区，不污染原有结构

---

## 快速开始

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

预期输出（查询）：

```
  命中 7 处 → 取前 5 条（关键词：powershell / 编码）

  1. [7.8] topics\脚本与编码.md#6
     **[教训]** PowerShell 5.1 会把无 BOM 的 .ps1 按 GBK 解码，中文注释吞掉行尾换行，
     把下一行代码并进注释，导致变量为 null。脚本必须写 UTF-8 BOM。 `session-1a2b3c4d#318`
```

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
│ SUMMARY.md   顶层：一句话提炼（约 26 条）         │ ← 定方向用
│ INDEX.md     索引：全库条目名，按主题分家          │ ← 找条目用
│ topics/*.md  明细：按主题分家，文件头写「何时翻它」 │ ← 取正文用
│ index.json   机读索引（供 query 与外部工具）       │
└─────────────────────────────────────────────────┘
        │
        │  mem.mjs query "关键词"   ← 扫 SUMMARY + topics，只回前 N 条
        ▼
   进上下文：约 700 字符（而不是上万字符）
```

---

## 三层记忆模型

| 层 | 文件 | 什么时候读 | 体量约束 |
|---|---|---|---|
| 顶层 | `SUMMARY.md` | 会话开始定方向、或 `query` 没命中时 | 只有提炼句，条数固定 |
| 索引 | `INDEX.md` | 找具体条目（**推荐用 `query` 代替**） | 一行一条，全库 |
| 明细 | `topics/*.md` | 只读命中的那一个主题文件 | 按主题分家，各自独立 |

设计意图：**越往上越贵，所以越往上越短**。顶层是唯一「可能每会话都读」的东西，因此它只装一句话；正文全部下沉到按需层。

---

## 命令参考

| 命令 | 作用 | 常用参数 |
|---|---|---|
| `node src/mem.mjs collect` | 扫会话日志产出素材 | `--all` 扫全部工作区｜`--force` 忽略增量判重 |
| `node src/mem.mjs list` | 列出待处理素材 | — |
| `node src/mem.mjs mark <id>` | 把素材标为已处理 | — |
| `node src/mem.mjs query "词 [词2]"` | 按关键词检索，只回命中片段 | `--n 8` 调整条数（默认 5） |
| `node src/build.mjs` | extracts → 分层记忆库 | — |
| `node src/verify.mjs <extract.json>` | 条目溯源核对 | — |

`query` 的匹配规则（坦白说明其能力边界）：

- 子串匹配，**不分词、无同义词**——搜不到就换词
- 词长加权：`词长 × (1 + log2(命中次数))`，多词累加
- 单字词被忽略（噪音太大）
- 多词之间是「或」：谁中算谁，靠得分排序
- 只在 `SUMMARY.md` 与 `topics/*.md` 里找，不碰 `INDEX.md`（避免索引与正文重复计分）

---

## Token 账（实测，不是估算）

一组真实运行数据，供你判断这套东西值不值：

| 量 | 实测值 |
|---|---|
| 常驻摘要（skill/索引一句话） | 2,461 字符，占全文 **0.91%** |
| 一次「读索引 + 读主题正文」 | 约 11,819 字符 |
| 一次 `query` 输出 | 约 738 字符（**省 92%**） |
| 12 组查询平均输出 | 624 字符/次 |

关键在复利：**读进上下文的内容会留驻**，之后每轮请求都随上下文重发。所以一次查询省下的 11,081 字符，要按「剩余轮数」放大：

| 会话场景 | 旧做法（读索引+正文） | 本方案（query） |
|---|---|---|
| 30 轮会话，第 5 轮查 1 次 | 307,294 字符累计输入 | 21,798 字符累计输入 |

详见 [`docs/TOKEN-ECONOMY.md`](docs/TOKEN-ECONOMY.md)。

---

## 接入 agent

在 `AGENTS.md`（或 `CLAUDE.md` / 系统提示）里加一行即可：

```markdown
- 记忆：有 `memory/` 时**先跑** `node memory/src/mem.mjs query "关键词 [关键词2]"`，
  只回命中片段；命中不够再按主题翻 `topics/<主题>.md`。
  **SUMMARY.md / INDEX.md 整份不读**。
```

**为什么是「先跑 query」而不是「先读 SUMMARY」**：读 SUMMARY 是「先花 2,864 字符买一个方向」，而 query 是「直接拿命中结果」。命中就赚，不命中再退回去读导航——只有落空时才付那笔钱。

---

## 目录结构

```
dsh-memory-lite/
├── README.md
├── LICENSE
├── CHANGELOG.md
├── package.json
├── .gitignore               # 默认忽略你本地的记忆数据
├── docs/
│   ├── ARCHITECTURE.md      # 数据流、文件格式、设计取舍
│   ├── TOKEN-ECONOMY.md     # 上下文成本的实测方法与账
│   └── GITHUB-SETUP.md      # 仓库描述 / topics / 推送步骤
├── src/
│   ├── mem.mjs              # 采集 + 查询
│   ├── build.mjs            # 提炼汇总（分类可配置）
│   └── verify.mjs           # 溯源核对
└── examples/
    ├── staging-example.md   # 素材长什么样
    ├── extracts-example.json# 提炼输入长什么样
    ├── SUMMARY.example.md   # 输出长什么样
    └── memory.config.example.json  # 分类与顶层场景的配置示例
```

---

## 设计取舍

**为什么不用向量库 / embedding？**
因为记忆条目通常是「结论型」的短句，条数在几百量级，关键词检索已经够用；而且**检索结果必须能被人一眼核对**——向量相似度做不到这一点。当你的记忆上万条、或者必须做语义召回时，这个项目就不合适了。

**为什么顶层要人工提炼？**
自动摘要会把「能救命的那个细节」压成「一般的经验」。顶层只有二十几条，值得人写——这是整套流程里唯一无法自动化的部分，也是它有价值的部分。

**为什么用文件而不是数据库？**
可 diff、可读、可直接编辑、坏不了、删得掉。代价是没有事务与并发——对「单人 + 单 agent」的记忆场景不是问题。

**为什么采集时要按 `source.kind` 过滤？**
因为日志里大部分是注入内容（系统提示、插件消息、子 agent 回执）。在真实样本里，真人输入只占 32%——不滤掉，素材会被噪音淹掉。

---

## 适用边界

- **采集器面向 DSH 会话日志**（zstd 分帧的 jsonl）——换平台需要替换 `collect` 部分，`build` / `query` / `verify` 与平台无关
- **Windows 上写 PowerShell 脚本时注意编码**：`.ps1` 必须带 UTF-8 BOM，否则 PowerShell 5.1 按 GBK 解码会崩（这个坑本项目的脚本不背，但用的人会遇到）
- 记忆是**本地文件**，没有云端同步、没有加密——敏感内容请自行决定是否入库

---

## License

MIT © dsh-memory-lite contributors
