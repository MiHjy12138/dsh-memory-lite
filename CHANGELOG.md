# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与语义化版本。

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
