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

| 层 | 靠什么 | 要做什么 |
|---|---|---|
| **搜得到** | GitHub topic `dsh-plugin` | 第 2 节填上即可，**自动生效**，无需提交 |
| **看得到 · 一键装** | 策展列表 `awesome-dsh-plugin.com/plugins.json` | 需要把 `marketplace-entry.json` **PR** 给策展仓库 |

本仓库根目录已备好 `marketplace-entry.json`（名称 / owner / 分类 / 中英描述 / install 命令 / keywords）。

PR 步骤：

1. fork 并打开 `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`
2. **先看它现有条目的目录结构与字段格式**（本清单不臆测其约定），把本仓库的条目按同样格式放进去
3. 提 PR，附上仓库地址与一句说明

> 在 PR 被合并前，用户也可以用第 3 节的 install 命令直接装——市场只是「被发现」的渠道，不是「能装」的前提。

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
