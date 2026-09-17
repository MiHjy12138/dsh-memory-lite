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

插件市场的搜索（`find_dsh_plugin`）**就是 GitHub 搜索**：`关键词 + topic:dsh-plugin`，
只匹配**仓库名、Description、Topics** 三处。所以下面第一项是硬门槛，缺了搜不到。

```
dsh-plugin            ← 硬门槛：缺了插件市场搜不到
deepseek-harness
agent-memory
long-term-memory
context-engineering
token-efficiency
llm
ai-agent
knowledge-base
markdown
cli
zero-dependency
nodejs
```

> 定位最独特的是 `token-efficiency` 与 `context-engineering`——搜的人不多，但正是这个项目解决的问题。

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
