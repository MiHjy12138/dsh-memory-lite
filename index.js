/**
 * dsh-memory-lite — DSH 插件入口
 *
 * 注册 `mem_query` 工具：在本地分层记忆库（SUMMARY.md + topics/*.md，外加长文层
 * manual/*.md 与 procedures/*.md）里检索，只回命中片段 —— 实测 915~963 字符，
 * 而不是整份索引的上万字符。
 *
 * 与 CLI（src/mem.mjs）共用 src/lib.mjs：一份实现，两条入口，不会各改各的走偏。
 * 零依赖：除宿主提供的 @deepseek-ai/dsh-tools 之外不引入任何包。
 */

import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { pickMemDir, parseTerms, queryDir, formatHits, freshnessLine, statsReport } from './src/lib.mjs'

export const name = 'dsh-memory-lite'
export const inject = ['tools']

const DEFAULT_SUBDIR = 'memory'   // 约定：记忆库就在工作区的 memory/ 下
const MAX_N = 20
const NOT_FOUND_TEXT = `mem_query: 没找到记忆库。把库放在会话工作区的 ${DEFAULT_SUBDIR}/ 下（需含 SUMMARY.md 或 topics/），或用环境变量 MEM_HOME 指定目录。`

// 记忆库定位顺序：MEM_HOME 环境变量 → <会话工作区>/memory → 会话工作区本身
// 刻意不把插件自身目录当候选：那是只读的 node_modules，而且会把 A 工作区的记忆
// 串给 B 工作区（这个 bug 就是离线仿真跑出来的）。
function resolveMemDir(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  const candidates = [process.env.MEM_HOME]
  if (typeof cwd === 'string' && cwd) candidates.push(join(cwd, DEFAULT_SUBDIR), cwd)
  return pickMemDir(candidates)
}

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'mem_query',
    description:
      'Search the local dsh-memory-lite memory library and return ONLY the matched entries. ' +
      'Scope: SUMMARY.md + topics/*.md (full weight) plus the long-form layers manual/*.md and procedures/*.md ' +
      '(scored at x0.6 and marked "长文" in the output). ' +
      'Prefer this over reading memory files directly: a typical query returns under about 1,000 characters ' +
      '(measured 915-963) instead of the full index (over 12,000). ' +
      'Matching is plain substring with an ASCII word boundary, no stemming or synonyms — if nothing matches, try different words. ' +
      '中文关键词同样可用，空格分隔多个词；stats=true 时忽略 query，只回记忆库概览。',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Keywords, space-separated, each at least 2 characters — e.g. "powershell bom" or "excel 合并单元格"',
      },
      n: {
        type: 'number',
        description: `Max entries to return (default 5, max ${MAX_N})`,
      },
      stats: {
        type: 'boolean',
        description: 'Set true to skip the query and return a library overview: counts, characters, token estimate, longest entries, staleness',
      },
    },
    timeoutMs: 30_000,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
    },
    execute: async (args, exec) => {
      try {
        const dir = resolveMemDir(exec) || null
        if (args?.stats === true) {
          if (!dir) return { ok: false, dir: null, total: 0, hits: 0, terms: [], text: NOT_FOUND_TEXT }
          return { ok: true, dir, total: 0, hits: 0, terms: [], text: statsReport(dir) }
        }
        const terms = parseTerms(args?.query)
        if (!terms.length) {
          return { ok: false, dir, total: 0, hits: 0, terms: [], text: 'mem_query: 至少给一个 ≥2 字符的关键词，例如 "powershell bom"。' }
        }
        if (!dir) return { ok: false, dir: null, total: 0, hits: 0, terms, text: NOT_FOUND_TEXT }
        const n = Math.max(1, Math.min(Number(args?.n) || 5, MAX_N))
        const { picked, total } = queryDir(dir, terms, n)
        const fresh = freshnessLine(dir)
        const text = formatHits(picked, total, terms) + (fresh ? `\n\n${fresh}` : '')
        return { ok: true, dir, total, hits: picked.length, terms, text }
      } catch (err) {
        // 任何失败路径都必须回一个完整对象：返回值里出现 undefined 会让 DSH 的
        // lossless-JSON 校验把整次工具调用判废。
        return { ok: false, dir: null, total: 0, hits: 0, terms: [], text: `mem_query 出错：${err instanceof Error ? err.message : String(err)}` }
      }
    },
  }))
}
