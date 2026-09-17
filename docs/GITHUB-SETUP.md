# 发布到 GitHub

这份清单把「上传前该填什么」一次性列全，照着抄即可。

---

## 1. 仓库设置

| 项 | 建议值 |
|---|---|
| **Repository name** | `dsh-memory-lite` |
| **Description**（About） | `On-demand memory for DSH agents: layered markdown memory, a mem_query tool that returns only matched snippets (~700 chars instead of 12,000). Zero dependencies, no per-turn injection. Also works as a standalone CLI.` |
| **Website** | 留空 |
| **Visibility** | Public |
| **Init with README** | 不要勾——本地已有完整仓库 |
| **License** | MIT（GitHub 会读 `LICENSE`，不冲突） |

中文描述（如需）：

> 给 agent 的按需记忆库：会话日志提炼成分层 markdown 记忆，`mem_query` 只回命中片段（约 700 字符，而不是上万字符）。零依赖、不每轮注入、条条可溯源。既是 DSH 插件，也是独立 CLI。

---

## 2. Topics（标签）—— **必看**

插件市场的搜索（`find_dsh_plugin`）**就是 GitHub 搜索**：`关键词 + topic:dsh-plugin`。
拆开看这两半：**`topic:dsh-plugin` 是硬过滤；关键词那半走仓库的全文匹配（仓库名 ＋ Description ＋ Topics）**。

所以 topic 分三层填 —— 一个仓库最多能打 20 个，不必取舍：

| 层 | 作用 | 填什么 |
|---|---|---|
| 门槛 | 缺了搜不到 | `dsh-plugin` |
| 宽词 | 覆盖泛搜的人 | `memory`、`markdown`、`cli`、`nodejs`、`llm` |
| 垂直 | 命中明确意图 | `agent-memory`、`long-term-memory`、`context-engineering`、`token-efficiency`、`ai-agent`、`knowledge-base`、`deepseek-harness` |

```
dsh-plugin
memory
agent-memory
long-term-memory
context-engineering
token-efficiency
deepseek-harness
ai-agent
knowledge-base
llm
markdown
cli
nodejs
```

### 「简单词更好找吗」—— 实测答案：差别很小，所以都打

同一时刻在市场里实测：

| 查询 | 返回 |
|---|---|
| `memory` | ruflo ★72656、OpenViking ★37824、EverOS ★13014、MemOS ★11490、honcho ★7211 … |
| `agent-memory` | **前 8 名与上面完全一致**，只有后面几条顺序不同 |

原因是记忆类仓库的 Description 里普遍同时出现 `memory` 与 `agent`，GitHub 的全文匹配对两个词都能命中。
**所以纠结宽词还是精准词是白费力气 —— 两个都打上就行。**

### 真正决定「被不被看见」的是排序，不是 topic 宽窄

`find_dsh_plugin` **按 star 数排序**。搜 `memory` 的前 20 名全在几百到几万星之间：
dsh-mnemon ★382、dsh-memory-evolve ★314、dsh-memory ★214、dsh-noema ★128、
dsh-mneme ★110、dsh-meow-memory ★106、StrataGate-AgentMemory ★85、dsh-auto-memory ★70 …
新仓库（0 星）无论怎么选 topic 都会排在后面。能改变这件事的只有三样：

1. **Description 里写清差异** —— 搜索权重最高、也最常被忽略的一处
2. **精准长尾词**：`dsh-memory-lite` 这种独特名字，搜它的人一定找得到你
3. **策展列表**（见第 4 节）：`awesome-dsh-plugin.com` 的 Memory 分类由人工策展，**不看 star**

> 这批插件的定位几乎都是「记得更多」—— 图谱、SQLite、语义召回、侧栏面板、后台自动整理。
> 本项目只有一句差异：**别人管「记得多」，它管「查得省」**（不注入、不建库、不起进程）。
> Description 就该说这一句。

---

## 3. 首次推送

```bash
cd dsh-memory-lite

git init -b main
git add .
git commit -m "feat: initial release"

git remote add origin https://github.com/MiHjy12138/dsh-memory-lite.git
git push -u origin main
```

推送前**务必确认这两件事**：

```bash
git status --short          # 确认没有 .staging/ extracts/ topics/ 等私人数据被加入
git ls-files                # 逐条过一遍实际入库的文件清单
```

`.gitignore` 已经把记忆数据全排除了。若你**有意**公开自己的记忆库，先用 grep 自查一遍再 `git add -f`：

```bash
grep -rn -E "(token|api[_-]?key|secret|password|sk-[A-Za-z0-9]{16,}|[A-Z]:\\\\Users\\\\|/home/[a-z]+/)" . \
  --include="*.md" --include="*.json"
```

---

## 4. 上架插件市场（两层，别混）

| 层 | 靠什么 | 状态 |
|---|---|---|
| **搜得到** | GitHub topic `dsh-plugin` | ✓ 已生效（实测：搜精准名排第 2 位） |
| **看得到 · 一键装** | 策展列表 `awesome-dsh-plugin.com/plugins.json` | ⏳ PR 已备好，待提（见 4.3） |

> 补充一句：本仓库根的 `marketplace-entry.json` 是给工具侧消费的备用元数据；
> **真正投给策展列表的，是下面这种 YAML 文件**——两者用途不同，别搞混。

### 4.1 策展仓库的规则（2026-09-17 实测）

结构是**一个插件一个 YAML**，放在 `data/plugins/<owner>__<repo>.yml`。
两个 README 由脚本从这些 YAML 生成——**不要手改 README**（这也正是别人的 PR 永远不会和你冲突的原因）。

```yaml
url: https://github.com/owner/repo        # 必须与仓库完全一致
name: owner/repo                          # 列表里显示的链接文字
category: memory                          # 取值见 contributing.md 的分类表
description:
  en: '一句话说明，以句号结尾。'              # 必填；描述里含「: 」时必须加引号
  zh: "中文描述"                             # 可选——不写，维护者会补
```

PR 自查清单（来自它的 `PULL_REQUEST_TEMPLATE.md`）与本仓库状态：

| # | 要求 | 状态 |
|---|---|---|
| 1 | 新增一个 `data/plugins/<owner>__<repo>.yml` | ✓ 已备好 |
| 2 | 仓库 `package.json` 声明 **`dsh.bundle`**（只有 `dsh.client` 不可安装） | ✓ `dsh.bundle.patch` |
| 3 | **仓库创建满 1 天** | ⏳ 创建于 2026-09-17 15:19 → **09-18 15:19 后可提** |
| 4 | `category` 取值正确 | ✓ `memory` |
| 5 | 描述只说功能、不带营销词 | ✓ 已按此写（没写「省 92%」这类卖点） |
| 6 | 仓库带 `dsh-plugin` topic | ✓ 已设 |

### 4.2 已经备好的（不用重做）

| 项 | 值 |
|---|---|
| fork | `MiHjy12138/awesome-dsh-plugin` |
| 分支 | `add-dsh-memory-lite`（commit `2433d58`），已推到该 fork |
| 文件 | `data/plugins/MiHjy12138__dsh-memory-lite.yml` |

### 4.3 明天要做的：一条命令

> 前提：距仓库创建满 24 小时（**09-18 15:19 之后**）。`gh` 已用账号 `MiHjy12138` 认证明。

先写一份 PR 正文（`pr-body.md`）：

```markdown
Adds one entry file: `data/plugins/MiHjy12138__dsh-memory-lite.yml`

- [x] one file at `data/plugins/<owner>__<repo>.yml` — that single file is the whole submission
- [x] `package.json` declares `dsh.bundle` (patch: `./cordis.patch.yml`)
- [x] repo is at least 1 day old
- [x] `category` is `memory`
- [x] description states what the plugin does, no superlatives
- [x] repo carries the `dsh-plugin` topic

On-demand memory for DeepSeek Harness: session logs are distilled into layered
markdown, and a `mem_query` tool returns only the matched entries instead of the
whole index. Zero dependencies; nothing is injected per turn; every entry keeps a
source pointer back to the conversation it came from.
```

然后提：

```bash
gh pr create \
  --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --head MiHjy12138:add-dsh-memory-lite \
  --title "Add MiHjy12138/dsh-memory-lite (memory)" \
  --body-file pr-body.md
```

合并之后：策展清单更新 → `awesome-dsh-plugin.com` 与 DSH 里的**市场面板**同步出现本插件，别人可一键装。
这条路**不看 star**，所以对新仓库是关键一步。

> 在 PR 被合并前，用户仍可用第 3 节的 install 命令直接装——市场只是「被发现」的渠道，不是「能装」的前提。

---

## 5. 发 npm？不必需

`dsh plugin add github:<用户>/<仓库>` 直接从 GitHub 拉取，pnpm 会按 `package.json` 解析装配。
只有当你希望别人 `npm i dsh-memory-lite` 时才需要发布：

```bash
npm publish        # files 字段已配好：index.js / cordis.patch.yml / src / docs / examples
```

发之前把 `package.json` 里的 `repository`、`bugs` 与 `marketplace-entry.json` 里的 `owner` 换成你的账号。

---

## 6. 上传前自检

- [ ] Topics 里有 `dsh-plugin`（硬门槛）
- [ ] `git status --short` 里没有 `.staging/`、`extracts/`、`topics/`、`*.json` 记忆数据
- [ ] README 与示例里没有真实主机名、用户名、绝对路径
- [ ] `LICENSE` 年份与署名已确认
- [ ] `package.json` / `marketplace-entry.json` 里的 owner 已确认
- [ ] 三条命令能跑通：
      `node src/mem.mjs query "BOM"`、`node src/build.mjs`、
      `node src/verify.mjs examples/extracts-example.json --staging examples/staging`
- [ ] 插件入口可加载、工具能注册、工作区无库时正确报错：
      `node examples/plugin-smoke-test.mjs .`
      （需在能解析 `@deepseek-ai/dsh-tools` 的目录下运行，例如 DSH 的 profile 目录）
      —— 期望以 `✓ 冒烟测试通过` 结尾、退出码 0
- [ ] 示例数据是合成的，不是从真实记忆库里拷的
