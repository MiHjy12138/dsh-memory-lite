# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

## [0.3.0] - 2026-10-15

### Added

- **第二检索面：`manual/*.md` 与 `procedures/*.md`** —— 以前只扫 `SUMMARY.md` + `topics/*.md`（约 4.6 万字符，占全库 15.7%），用户最详细的那 24.7 万字符一个字都查不到
  - 粒度是**文件行**（不是 `- ` 条目行）：只认非空且长度 ≥ 10 的行
  - 层级权重 `LONG_WEIGHT = 0.6`：长文噪声大，整层打折，与 SUMMARY/topics（×1）混排后按分排序
  - 结果标 `manual/xxx.md#行号`、`procedures/xxx.md#行号`，并带 `长文` 标记区分层级
  - 目录不存在 / 读不动（含 `manual` 是普通文件这种 ENOTDIR）→ 静默跳过，绝不报错
  - 实测：`回环 --n 5` 由「4 条命中全在 topics」变成 27 条命中、第 2/3 条就是 procedures 里的处置卡；查询多花约 10.7 毫秒（含读盘）
- **库新鲜度**：每次查询末尾一行「库建于 YYYY-MM-DD HH:mm（N 天前），共 N 条」
  - 数据源是 `index.json` 的 `updated` / `total`；`updated` 只写日期（无时分）时退回 `SUMMARY.md` 的 mtime 当时间戳；库文件缺失则不打这一行
  - 起因：采集已停更 5 天（`.state.json` 停在 10-10），agent 却完全看不到，得靠人绕到文件系统才发现
- **stats 概览**：CLI 新增 `node mem.mjs stat` —— 总条数 / 正文总字符 / 粗估 token（字符 ÷ 3.2）/ 最长条目前 3 条 / 主题分布 / 采集停更天数（`.state.json` 的 mtime）
  - 插件侧给 `mem_query` 加**一个**可选布尔参数 `stats`：`stats=true` 时忽略 query、只回概览
- **泛词降权**：`GENERIC_WORDS = {不可用, 索引, 情况, 内容}` 表内词的贡献 ×0.5

### Changed

- **ASCII 词边界加固**：命中位置外侧的字符不得是 `[A-Za-z0-9_]`（CJK 词保持原子串匹配，大小写仍统一 lowercase）
  - 修掉查 `com` 咬进 `ascii_composer` / `npmmirror.com`、查 `doc` 咬进 `autoDoctor` / `doctor` 这类子串误召回（`com` 命中 20 → 4，`doc` 9 → 2，中文查询逐行不变）
  - 另加一条「左侧黏点守卫」：命中片段左侧紧贴的 `.` 若它左边还黏着字母（`npmmirror.com` 里的 `.com`、`cordis.patch.yml` 里的 `.yml`）按词内处理、不命中
  - **取舍**：域名不再污染结果，代价是单查扩展名（`yml` / `mjs`）不再命中对应文件；`build.mjs`、`127.0.0.1`、`dsh-mem` 这类整体词查询不受影响
- `mem_query` 的工具描述改成实测口径：检索面写明「SUMMARY.md + topics/*.md（×1）＋ manual/*.md、procedures/*.md 长文层（×0.6，带『长文』标记）」，长度从「roughly 700 characters」改为「under about 1,000 characters（measured 915-963）」
- 插件工具加 `timeoutMs: 30_000`

### Fixed

- `--n` 的参数值不再被当成查询词：以前 `--n 20` 会把 `20` 也算作关键词（`--n 3` 因长度 < 2 被过滤，所以只在大数值上暴露）
- 文件系统失败路径不再可能抛未捕获异常：目录列举统一走 `mdFiles()`（目录缺失 / ENOTDIR / EACCES → 空数组），插件 `execute` 外层加 try/catch，任何失败路径都返回 `{ok:false, text:'…'}` 的完整对象，返回值里不会出现 `undefined`

## [0.2.0] - 2026-09-17

### Added

- `index.js` + `cordis.patch.yml` —— DSH 插件入口，注册 `mem_query` 工具
  - 工具描述里写明「优先用它，别整份读记忆文件」，所以**不需要**在 `AGENTS.md` 里补约定
  - 记忆库定位：`MEM_HOME` → `<会话工作区>/memory` → 会话工作区本身
  - 刻意不把插件自身目录当候选：那是只读的 `node_modules`，而且会把 A 工作区的记忆串给 B 工作区（这个 bug 是离线仿真跑出来的）
  - 只读：插件不注册采集/写入工具，有副作用的动作仍由人显式执行
- `src/lib.mjs` —— 共享核心，CLI 与插件共用同一份解析与打分实现
- `marketplace-entry.json` —— 插件市场条目（供 PR 到策展列表）
- `package.json` 新增 `main` / `dsh.bundle.patch` / `exports` / `peerDependencies`（`@deepseek-ai/dsh-tools`，标为 optional，纯 CLI 用户不受影响）

### Changed

- `src/mem.mjs` 改为引用 `src/lib.mjs`：行为与输出格式不变，只是把共享逻辑抽出去（302 → 135 行）
- markdown 生成物里的路径分隔符统一为正斜杠（`topics/...`、`../SUMMARY.md`），跨平台一致

## [0.1.0] - 2026-09-17

### Added

- `src/mem.mjs` —— 会话日志采集与检索
  - 解析 zstd 分帧压缩的 jsonl 会话日志（Node 内置 `zlib`，无第三方依赖）
  - 按 `source.kind` 过滤注入型消息，只保留真人输入、助手回复与压缩点
  - 增量采集：以文件 size + mtime 判重，重复运行不重扫
  - `query` 子命令：扫 `SUMMARY.md` + `topics/*.md`，按「词长 × (1 + log2(命中次数))」打分，只回前 N 条
- `src/build.mjs` —— 提炼汇总
  - `extracts/*.json` → `SUMMARY.md` / `INDEX.md` / `topics/*.md` / `index.json`
  - 分类规则可配置（`memory.config.json`），未配置时用内置通用分类兜底
  - 顶层场景人工提炼后写进配置，硬卡规模，避免自动摘要把细节抹平
  - 主题改名后自动归档孤立文件
- `src/verify.mjs` —— 溯源核对：把每条记忆拉回素材原文，标出「对得上 / 弱相关 / 不相关」
- `docs/ARCHITECTURE.md` —— 数据流、文件格式与设计取舍
- `docs/TOKEN-ECONOMY.md` —— 上下文成本的实测方法与复利模型
- `docs/GITHUB-SETUP.md` —— 仓库描述、topics 与推送步骤
- `examples/` —— 合成示例数据（不含任何真实环境信息）

### Notes

- 零运行时依赖，Node ≥ 18
- 记忆数据默认被 `.gitignore` 忽略，仓库只承载**框架**不承载**内容**
