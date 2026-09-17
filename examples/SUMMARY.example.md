# 记忆总览 · demo-project

> 顶层是**提炼后的一句话**；全部 4 条明细按 3 个主题分家，见 INDEX.md。
> 要深入某一块时，按下面的主题导航去读对应的 topics/<主题>.md —— **不要整份载入**。

## 写脚本、改配置时

*PowerShell / bat / 编码*

- 写 .ps1 一律存 UTF-8 BOM：PowerShell 5.1 按 GBK 解码无 BOM 文件，中文一乱就整段崩。
- bat 必须用 CRLF 换行：LF 会被 cmd.exe 吃掉每行行首，脚本静默出错，最难查。

## 验收与协作

*验收他人交付、和人对齐口径时*

- 验收不能只读报告：换一套口径重算异常项，再查它没报的那几项。

## 主题导航（要深入时去这里）

| 主题 | 条数 | 何时翻 |
|---|---|---|
| topics/脚本与编码.md | 2 | 写 PowerShell / bat / shell，处理编码与换行时 |
| topics/协作与验收.md | 1 | 规划任务、验收他人成果、和人对齐口径时 |
| topics/数据与自动化.md | 1 | 批量处理表格、文档、文件时 |

---

> 这是 `node src/build.mjs` 的输出示例（输入为 `examples/extracts-example.json`
> ＋ `examples/memory.config.example.json`）。实际文件由脚本生成，不要手改。
>
> 想复现：

```bash
mkdir -p extracts
cp examples/extracts-example.json extracts/00.json
cp examples/memory.config.example.json memory.config.json
node src/build.mjs
node src/mem.mjs query "BOM"
```
