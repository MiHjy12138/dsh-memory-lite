# 发布到 GitHub

这份清单把「上传前该填什么」一次性列全，照着抄即可。

---

## 1. 仓库设置

| 项 | 建议值 |
|---|---|
| **Repository name** | `dsh-memory-lite` |
| **Description**（About） | `On-demand memory for AI agents: distill session logs into layered markdown; queries return only matched snippets. Zero dependencies.` |
| **Website** | 留空 |
| **Visibility** | Public |
| **Init with README** | 不要勾——本地已有完整仓库 |
| **License** | MIT（选完 GitHub 会读 `LICENSE`，不冲突） |

中文描述（如需）：

> 给 AI agent 的按需记忆库：会话日志提炼成分层记忆，查询只回命中片段，省 90%+ 上下文。零依赖。

---

## 2. Topics（标签）

GitHub 仓库页右上角 ⚙ → Topics，最多 20 个。建议填：

```
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
typescript-free
prompt-engineering
mcp
dsh
```

> 前 6 个是主要流量入口（搜的人多、竞争也大）；`token-efficiency` 和 `context-engineering` 是这个项目最独特的定位。

---

## 3. 首次推送

```bash
cd dsh-memory-lite

git init -b main
git add .
git commit -m "feat: initial release v0.1.0"

git remote add origin https://github.com/<你的用户名>/dsh-memory-lite.git
git push -u origin main
```

推送前**务必确认这两件事**：

```bash
git status --short          # 确认没有 .staging/ extracts/ topics/ 等私人数据被加入
git ls-files                # 逐条过一遍实际入库的文件清单
```

`.gitignore` 已经把记忆数据全排除了。若你**有意**公开自己的记忆库，先用 grep 自查一遍再 `git add -f`：

```bash
# 自查有无泄露（按需增删模式）
grep -rn -E "(token|api[_-]?key|secret|password|sk-[A-Za-z0-9]{16,}|[A-Z]:\\\\Users\\\\|/home/[a-z]+/)" . \
  --include="*.md" --include="*.json"
```

---

## 4. 发布后（可选）

**Release**：`v0.1.0` → 描述填 `CHANGELOG.md` 的对应段落即可。

**README 徽章**：已用 shields.io 静态徽章（不依赖 CI）。若日后接入 GitHub Actions，可换成动态：

```markdown
![CI](https://github.com/<user>/dsh-memory-lite/actions/workflows/test.yml/badge.svg)
```

**package.json**：把 `repository.url` 与 `bugs.url` 里的 `OWNER` 换成你的用户名。

```bash
# 改完再提交
git add package.json && git commit -m "chore: set repository url"
```

---

## 5. 上传前自检

- [ ] `git status --short` 里没有 `.staging/`、`extracts/`、`topics/`、`*.json` 记忆数据
- [ ] `README.md` 里的截图/示例不含真实主机名、用户名、绝对路径
- [ ] `LICENSE` 的年份与署名已确认（默认 `dsh-memory-lite contributors`）
- [ ] `package.json` 的 `OWNER` 已替换
- [ ] 三条命令能跑通：`node src/mem.mjs query`、`node src/build.mjs`、`node src/verify.mjs examples/extracts-example.json --staging examples/staging`
- [ ] 示例数据是合成的，不是从真实记忆库里拷的
