# 架构

## 一句话

**四段流水线 + 三层记忆**：日志进、素材出；素材进、提炼出；提炼进、分层库出；查询只取命中片段。

```
①采集 ────────► ②提炼 ────────► ③汇总 ────────► ④检索
mem.mjs collect   人 / agent      build.mjs        mem.mjs query
`.

日志 → 素材         素材 → JSON       JSON → 分层库      库 → 命中片段
```

---

## 阶段 ①：采集（`mem.mjs collect`）

**输入**：DSH 会话日志 `<DSH_HOME>/sessions/<cwd-hash>/<session-id>/session.*.jsonl.zstd`

日志是 **多 frame 串联的 zstd 流**，不是单个压缩块——所以 `decodeFrames()` 先按 zstd magic（`28 B5 2F FD`）扫描切分，再逐段解压。直接整包解压会失败，这是踩过的坑。

**过滤是这一步的核心**。一条日志里绝大部分消息不是人说的：

| 消息来源 | `source.kind` | 处理 |
|---|---|---|
| 真人输入 | `user` | 保留 |
| 系统注入（system-reminder、runtime context） | 其他 kind / 无 source | 丢弃 |
| 插件消息 | `plugin` | 丢弃 |
| 子 agent 回执 | `subagent-settled` 等 | 丢弃 |
| 助手回复 | —（`assistant/message`） | 保留 |

实测样本：`user/message` 共 1,139 条，真人只有 365 条（**32%**）。靠内容前缀（`<system-reminder` 这类正则）只能识别 7%，所以主判据是 `source.kind`，前缀正则只用于没有 `source` 字段的老格式兜底。

**输出**：`.staging/<session-id>.md`

```markdown
# session-1a2b3c4d
- 工作区：`/path/to/project`
- 时间跨度：2026-01-15 09:12 → 2026-01-15 11:40
- 事件 412 条（frame 9，解压失败 0）→ 保留 138 条
- 排掉注入型 274 条：skill-catalog 96、plugin 88、agent-instructions 90

---

- [用户] 这个脚本在中文路径下会崩，帮我看看 `#118`
- [助手] 原因是 PowerShell 5.1 按 GBK 解码了无 BOM 的文件…… `#120`
- [压缩点] （此处发生过上下文压缩）
```

两条硬约束：单条截断 800 字符（`MAX_ENTRY`），单会话上限 48,000 字符（`MAX_TOTAL`，超出丢最早的）。

**增量**：按 `size + mtimeMs` 判重，重复运行不重扫；`.state.json` 存这个映射。

---

## 阶段 ②：提炼（人或 agent，不自动化）

读 `.staging/*.md`，把有价值的东西写成 `extracts/NN.json`：

```json
[
  {
    "kind": "lesson",
    "topic": "ps1 无 BOM 崩溃",
    "text": "PowerShell 5.1 把无 BOM 的 .ps1 按 GBK 解码，中文注释会吞掉行尾换行……",
    "source": "session-1a2b3c4d#120"
  }
]
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `kind` | 是 | `lesson` 教训 / `decision` 决定 / `fact` 事实 / `state` 状态 |
| `topic` | 是 | 短标签，同一 topic 会互相覆盖（用于顶层勾连） |
| `text` | 是 | 结论本身。**写结论，不要写过程** |
| `source` | 是 | `session-<8位短id>#<事件序号>`，用于溯源核对 |
| `date` | 否 | 缺省时从素材文件头的「时间跨度」推断 |

**为什么这步不自动化**：自动摘要会把「能救命的那个细节」压成「一般的经验」。提炼的质量上限决定了整个记忆库的质量上限——这是唯一值得人工介入的地方。

写完用 `verify.mjs` 核一遍：每条记忆能不能在素材里找到出处、说的是不是同一件事。

---

## 阶段 ③：汇总（`build.mjs`）

**输入**：`extracts/*.json`
**输出**：四件套

### SUMMARY.md —— 顶层（唯一可能每会话都读的东西）

只装**人工提炼的一句话**，条数由 `memory.config.json` 的 `scenes` 决定：

```markdown
## 动手之前先过一遍
*改配置 / 装插件 / 大改动前*

- 改 preset 别把 subagent 一族一起禁——工具表会整个空掉；「切换没报错」≠ 组装成功。
```

设计意图：**越往上越贵，所以越往上越短**。顶层只放「一句话就能救命」的东西，细节全部下沉。

### INDEX.md —— 索引

全库条目名，按主题分组，一行一条（`id` + 类型 + 主题名，顶层条目带 ★ 标记）。**推荐用 `query` 代替读它**。

### topics/&lt;主题&gt;.md —— 明细

```markdown
# 脚本与编码

> **何时翻它**：写 PowerShell / bat / shell，处理编码与换行时
> 8 条｜总览见 ..\SUMMARY.md，索引见 ..\INDEX.md｜来源标注 session-短id#事件序号

- **[教训]** PowerShell 5.1 把无 BOM 的 .ps1 按 GBK 解码…… `session-1a2b3c4d#120`
```

文件头的「何时翻它」是给读的人（或 agent）判断「要不要打开这个文件」用的——省掉一次盲读。

主题改名后，旧文件会被自动移进 `.archive/`（否则会留下永远没人读的孤立文件）。

### index.json —— 机读索引

供 `query` 之外的工具消费：`{version, project, updated, total, topCount, categories[], entries[]}`。

---

## 阶段 ④：检索（`mem.mjs query`）

扫 `SUMMARY.md` + `topics/*.md`，**不扫 `INDEX.md`**（索引与正文会重复计分）。

打分公式：

```
score = Σ_词 [ min(词长, 6) × (1 + log2(命中次数)) ]
```

- 长词权重更高（「合并单元格」比「单元」有信息量）
- 同一行里出现多次会加权，但对数压制，不会让复读机霸榜
- 多词之间是**或**：谁中算谁，按总分排序
- 单字词被忽略（噪音太大）
- 结果按「内容前 26 字（去掉标点与 source）」去重，SUMMARY 与 topics 里的同一条只留分数高的

只输出前 N 条（默认 5），每条截断 200 字符。**这就是这套设计省 token 的全部秘密**：不让调用方读整份文件。

---

## 分类机制

三级决策，由强到弱：

1. `cats.json`（`topic → 分类 key` 的显式覆盖表）——最准，给重要条目用
2. `memory.config.json` 的 `cats[].kw` 正则列表——自定义分类
3. 内置通用分类的 `kw` 匹配——兜底
4. 都不中 → `misc`（其他零散结论）

内置通用分类：`script` 脚本与编码 / `env` 环境与沙箱 / `tool` 工具与插件 / `model` 模型与成本 / `data` 数据与自动化 / `method` 协作与验收 / `misc`。

---

## 扩展点

| 想做的事 | 改哪里 |
|---|---|
| 换平台（Claude Code / Cursor 日志） | 替换 `mem.mjs` 的 `decodeFrames` + `filterEvents`，其余不动 |
| 加语义检索 | 在 `query()` 前加一层 embedding 召回，命中后再走现有打分重排 |
| 接 MCP / 工具调用 | 把 `query()` 包成一个工具，schema 描述「返回命中片段」 |
| 自动采集 | 会话结束时触发 `collect`（用 hook，不要每轮注入） |
| 记忆可视化 | 消费 `index.json`：`categories[]` + `entries[]` 已够画主题分布图 |

---

## 反模式（别这么做）

- **把记忆内容做成每轮注入** —— 注入一次，之后每轮重发、每轮计费。这是这类工具最常见的失败模式。
- **让 agent 每轮自己读 SUMMARY + INDEX 找东西** —— 上万字符读进来就全程占位，查询成本就此固化。
- **自动摘要顶层** —— 顶层是「救命信息」的栖息地，压缩过度等于删库。
- **不经核对就入库** —— 记忆里的错误比没有记忆更贵：它会被当成事实反复引用。
