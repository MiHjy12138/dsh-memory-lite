/**
 * lib.mjs — dsh-memory-lite 共享核心
 *
 * CLI（mem.mjs）与 DSH 插件（index.js）共用这里的解析与检索逻辑：
 * 一份实现，两条入口，不会各改各的走偏。
 *
 * 零依赖：只用 Node 内置模块。
 * 这里全是纯函数与常量，没有顶层副作用 —— 可以被自由 import。
 */

import { zstdDecompressSync } from 'node:zlib'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── 常量 ──────────────────────────────────────────────────
export const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])  // zstd frame magic
export const MAX_ENTRY = 800      // 素材单条截断（字符）
export const MAX_TOTAL = 48000    // 单会话素材上限（字符），超出丢最早的
export const INJECT_PREFIXES = [  // 无 source 的老格式兜底
  /^=====\s*长期记忆/,
  /^<system-reminder/,
  /^<referenced-sessions/,
  /^## Referenced sessions/,
  /^Instructions from:/,
  /^Current runtime context\./,
  /^The approval policy changed/,
]

// ── 采集侧：解压 ──────────────────────────────────────────
// 会话日志是多 frame 串联的 zstd 流，按 magic 切分后逐段解。
export function decodeFrames(buf) {
  const idx = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.compare(ZSTD_MAGIC, 0, 4, i, i + 4) === 0) idx.push(i)
  }
  if (!idx.length) return { text: '', frames: 0, failed: 0 }
  let text = '', frames = 0, failed = 0
  for (let k = 0; k < idx.length; k++) {
    try {
      text += zstdDecompressSync(buf.subarray(idx[k], idx[k + 1] ?? buf.length)).toString('utf8')
      frames++
    } catch { failed++ }
  }
  return { text, frames, failed }
}

export function readHead(file) {
  const buf = readFileSync(file)
  return decodeFrames(buf.subarray(0, Math.min(buf.length, 8192))).text.split('\n').filter(Boolean)
}

// ── 采集侧：取文本与过滤 ──────────────────────────────────
// user 消息正文在 data.content，assistant 在 data.message.content（实测差异）。
// 只取 type==="text" 的块：reasoning 与 tool-call 一律不要。
export function textOf(e) {
  const blocks = e?.data?.content ?? e?.data?.message?.content
  if (Array.isArray(blocks)) {
    return blocks
      .map(b => (typeof b === 'string' ? b : (b?.type === 'text' ? b.text : '')))
      .filter(Boolean)
      .join('\n')
  }
  if (typeof blocks === 'string') return blocks
  if (typeof e?.data?.text === 'string') return e.data.text
  return ''
}

// 真人输入带 data.source.kind === "user"；其余（plugin / agent-message /
// subagent-settled / skill-catalog / agent-instructions）都是注入。
// 实测样本里真人输入只占 32%，所以主判据用 source.kind。
export function filterEvents(events) {
  const out = []
  const dropped = {}
  const bump = k => { dropped[k] = (dropped[k] ?? 0) + 1 }
  for (const e of events) {
    const t = e.type ?? ''
    if (/checkpoint|compact/i.test(t)) { out.push({ kind: '压缩点', seq: e.seq, time: e.time }); continue }
    if (t !== 'user/message' && t !== 'assistant/message') continue
    const txt = textOf(e).trim()
    if (!txt) continue
    if (t === 'user/message') {
      const src = e?.data?.source
      if (src === undefined) {
        if (INJECT_PREFIXES.some(r => r.test(txt))) { bump('无source·前缀命中'); continue }
      } else if (src.kind !== 'user') {
        bump(src.plugin ?? src.kind ?? '(kind缺失)')
        continue
      }
    }
    out.push({ kind: t === 'user/message' ? '用户' : '助手', text: txt, seq: e.seq, time: e.time })
  }
  return { kept: out, dropped }
}

export function formatTime(t) {
  if (!t) return '—'
  const d = new Date(t), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── 采集侧：渲染素材 md ───────────────────────────────────
export function renderSession(sid, head, kept, totalEvents, dropped, frames, failed) {
  const picked = []
  let total = 0, omitted = 0
  for (let i = kept.length - 1; i >= 0; i--) {
    const k = kept[i]
    const body = k.kind === '压缩点' ? '（此处发生过上下文压缩）' : k.text.slice(0, MAX_ENTRY)
    const line = `- [${k.kind}] ${body}${k.seq != null ? `  \`#${k.seq}\`` : ''}`
    if (total + line.length > MAX_TOTAL) { omitted = i + 1; break }
    picked.unshift(line)
    total += line.length + 1
  }
  const dn = Object.values(dropped).reduce((a, b) => a + b, 0)
  const detail = Object.entries(dropped).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('、')
  const span = `${formatTime(kept[0]?.time ?? head?.createdAt)} → ${formatTime(kept[kept.length - 1]?.time)}`
  const L = []
  L.push(`# ${sid}`)
  L.push('')
  L.push(`- 工作区：\`${head?.cwd ?? '?'}\``)
  L.push(`- 时间跨度：${span}`)
  L.push(`- 事件 ${totalEvents} 条（frame ${frames}，解压失败 ${failed}）→ 保留 ${kept.length} 条`)
  if (dn) L.push(`- 排掉注入型 ${dn} 条：${detail}`)
  if (omitted) L.push(`- ⚠ 因体积上限省略了最早的 ${omitted} 条`)
  L.push('')
  L.push('---')
  L.push('')
  L.push(...picked)
  L.push('')
  return L.join('\n')
}

// ── 目录定位 ──────────────────────────────────────────────
// 脚本在 <memory>/src/ 下时上溯一级；直接放在库里则用脚本所在目录。
export function memDirFromScript(metaUrl) {
  const here = dirname(fileURLToPath(metaUrl))
  return basename(here) === 'src' ? dirname(here) : here
}

// 候选目录里挑第一个「像记忆库」的（有 SUMMARY.md 或 topics/）
export function pickMemDir(candidates) {
  const seen = new Set()
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue
    const key = c.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (existsSync(join(c, 'SUMMARY.md')) || existsSync(join(c, 'topics'))) return c
  }
  return null
}

// ── 检索侧 ────────────────────────────────────────────────
// 拆词：空白分隔，丢掉单字（噪音太大）
export function parseTerms(input) {
  return String(input ?? '').trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2)
}

// ── 泛词降权（2026-10-15）──────────────────────────────────
// 背景：权重取的是词长，「不可用」3 字（6 分）压过「磁盘」2 字（4 分），于是查
//   「磁盘 不可用」首条给的是只讲到「不可用」的记录。
// 为什么不用 df：本库短层只 213 条，实测 df 反而救不了这个案例——「不可用」df 0.5%、
//   「磁盘」0.9%，都远低于任何阈值；倒是「插件」df 17.8%、「文件」14.6% 会被 df 规则误伤。
//   所以用一张极小的泛词表，表内词的贡献 ×0.5，表外恒 ×1。要调口径只动这两行。
export const GENERIC_WEIGHT = 0.5
export const GENERIC_WORDS = new Set(['不可用', '索引', '情况', '内容'])
export const termWeight = t => (GENERIC_WORDS.has(t) ? GENERIC_WEIGHT : 1)

// 命中计数：纯 ASCII 词加词边界，CJK 词保持子串
// 背景（2026-10-15 加固）：原用纯 indexOf 子串匹配，查 "com" 会咬进
//   ascii_composer / npmmirror.com，查 "doc" 会咬进 autoDoctor —— 英文缩写必然误召回。
// 规则：纯 ASCII 的词命中位置的前后字符都不得是 [A-Za-z0-9_]；CJK 词（含任何非
//   ASCII 字符的词）保持原样，中文没有词边界。
// 边界之外再加一条「左侧黏点守卫」：命中片段左侧紧贴的 '.' 若它左边还黏着**字母**
//   （registry.npmmirror.com 里的 .com、cordis.patch.yml 里的 .yml），说明查询词只是
//   某个域名/标识符的尾巴，算词内、不命中；点开头而前面是空格/行首的独立记号（.doc、.json）
//   不受影响，照旧命中。点左边是数字的不设守卫——0.3.20、10.0.0.1 里的点仍算边界，
//   免得查 "20" 之类连版本号/网段的数字都搜不到。
//   右侧故意不放守卫：术语后跟 ".bak" 这类是用户要的前缀命中
//   （查 cordis.patch.yml 仍该命中 cordis.patch.yml.bak-p2-… 那条）。
// 注意：边界只看命中片段**之外**的字符，所以 build.mjs、127.0.0.1、dsh-mem 这类
//   含点/连接符的整体词照旧命中（前面的 / 或空格、后面的空格都算边界）。
const isAsciiTerm = t => /^[\x00-\x7F]+$/.test(t)
const isWordChar = c => c !== undefined && /[A-Za-z0-9_]/.test(c)
const isLetter = c => c !== undefined && /[A-Za-z_]/.test(c)

// 左侧边界：外侧不是词字符即算边界；外侧是 '.' 时，要求该点左边也不是字母
function edgeLeftOk(text, i) {
  const c = text[i]
  if (c === '.') return !isLetter(text[i - 1])
  return !isWordChar(c)
}
// 右侧边界：外侧不是词字符即算边界
const edgeRightOk = c => !isWordChar(c)

function countHits(lowText, term) {
  let n = 0, at = 0
  if (!isAsciiTerm(term)) {                                  // CJK / 含非 ASCII：原逻辑
    while ((at = lowText.indexOf(term, at)) !== -1) { n++; at += term.length }
    return n
  }
  while ((at = lowText.indexOf(term, at)) !== -1) {
    if (edgeLeftOk(lowText, at - 1) && edgeRightOk(lowText[at + term.length])) n++
    at += term.length
  }
  return n
}

// 打分：命中词长 × (1 + log2(命中次数))，多词累加；长词权重更高
export function scanFile(file, label, terms, out) {
  let lines
  try { lines = readFileSync(file, 'utf8').split('\n') } catch { return }
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw.startsWith('- ') || raw.length < 10) continue   // 只认条目行，跳过标题/表格/导航
    const text = raw.slice(2), low = text.toLowerCase()
    let score = 0, hits = 0
    for (const t of terms) {
      const n = countHits(low, t)
      if (n) { hits++; score += Math.min(t.length, 6) * (1 + Math.log2(n + 1)) * termWeight(t) }
    }
    if (!hits) continue
    out.push({ score: Math.round(score * 10) / 10, hits, file: label, ln: i + 1, text })
  }
}

// ── 长文层：manual/ 与 procedures/（第二检索面）────────────────
// 背景（2026-10-15）：原来只扫 SUMMARY + topics，合计约 4.6 万字符；manual/（51 份）
//   与 procedures/（24 份）那 24.7 万字符一个字都查不到，覆盖率仅 15.7%。实测把这两层
//   接进来只多花 ~15 毫秒（含读盘），缺的不是性能，是没接线。
// 粒度：**文件行**（不是 `- ` 条目行），只认非空且长度 ≥ 10 的行。
// 权重：长文噪声大，整层乘 LONG_WEIGHT=0.6（SUMMARY/topics 恒 ×1），两层混排后按分排序。
// 位置：标 `manual/xxx.md#行号` / `procedures/xxx.md#行号`，并带 `长文` 标记以区别层级。
// 回给调用方的仍是**片段**（formatHits 照旧 200 字符截断），要看全文让它自己 read。
export const LONG_WEIGHT = 0.6

export function scanLongFile(file, label, terms, out) {
  let lines
  try { lines = readFileSync(file, 'utf8').split('\n') } catch { return }
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim()
    if (!text || text.length < 10) continue                  // 空行与太短的行（标题/分隔）不认
    const low = text.toLowerCase()
    let score = 0, hits = 0
    for (const t of terms) {
      const n = countHits(low, t)
      if (n) { hits++; score += Math.min(t.length, 6) * (1 + Math.log2(n + 1)) * termWeight(t) }
    }
    if (!hits) continue
    out.push({ score: Math.round(score * LONG_WEIGHT * 10) / 10, hits, long: true, file: label, ln: i + 1, text })
  }
}

// 列目录里的 .md；目录不存在 / 读不动（ENOTDIR / EACCES…）→ 返回空数组，绝不抛
function mdFiles(dir) {
  try { return readdirSync(dir).filter(f => f.endsWith('.md')) } catch { return [] }
}

// 扫一个长文目录下的所有 .md；目录不存在 / 读不动 → 静默跳过，绝不报错
export function scanLongDir(dir, prefix, terms, out) {
  for (const f of mdFiles(dir)) scanLongFile(join(dir, f), `${prefix}/${f}`, terms, out)
}

// 扫 SUMMARY.md + topics/*.md（不扫 INDEX.md，避免索引与正文重复计分）
// + 长文层 manual/（记忆库下）与 procedures/（工作区根 = 记忆库的上一级，二者都 ×0.6）
export function queryDir(memDir, terms, n = 5) {
  const out = []
  const summ = join(memDir, 'SUMMARY.md')
  if (existsSync(summ)) scanFile(summ, 'SUMMARY.md', terms, out)
  const tdir = join(memDir, 'topics')
  for (const f of mdFiles(tdir)) scanFile(join(tdir, f), `topics/${f}`, terms, out)
  scanLongDir(join(memDir, 'manual'), 'manual', terms, out)            // 长文层 · ×0.6
  scanLongDir(join(dirname(memDir), 'procedures'), 'procedures', terms, out) // 长文层 · ×0.6
  out.sort((a, b) => b.score - a.score || b.hits - a.hits)
  const seen = new Set(), picked = []
  for (const r of out) {
    const key = r.text.replace(/`[^`]*`/g, '').replace(/[\s*[\]（）()，,。；;、.]/g, '').slice(0, 26)
    if (seen.has(key)) continue                        // SUMMARY 与 topics 同条重复，只留分数高的
    seen.add(key); picked.push(r)
    if (picked.length >= n) break
  }
  return { picked, total: out.length }
}

// 统一的命中片段文本（CLI 与插件共用同一份排版）
export function formatHits(picked, total, terms, maxLen = 200) {
  if (!picked.length) {
    return `  没命中：${terms.join(' / ')}\n  换个词；或看 SUMMARY.md 的主题导航表（每个主题都标了「何时翻」）`
  }
  const lines = [`  命中 ${total} 处 → 取前 ${picked.length} 条（关键词：${terms.join(' / ')}）`, '']
  picked.forEach((r, i) => {
    const body = r.text.length > maxLen ? r.text.slice(0, maxLen) + '…' : r.text
    lines.push(`  ${i + 1}. [${r.score}${r.long ? ' 长文' : ''}] ${r.file}#${r.ln}`)
    lines.push(`     ${body}`)
    lines.push('')
  })
  return lines.join('\n').replace(/\n+$/, '')
}

// ── 库新鲜度 / stats 概览（2026-10-15）───────────────────────
// 为什么要有：这次 agent 完全看不到「采集已停更 5 天」（.state.json 停在 10-10），
//   全靠人绕到文件系统才发现；两条数字必须随时可复算。
// 新鲜度：查询末尾一行「库建于 …（N 天前），共 N 条」。数据源优先 index.json 的
//   updated / total；updated 只写日期（无时分）时用 SUMMARY.md 的 mtime 当时间戳
//   （那是真时间，不编造时分）；两者都没有 → 返回空串，调用方不打这一行。
export const TOKEN_DIVISOR = 3.2      // 粗估：字符 ÷ 3.2 ≈ token
const DAY_MS = 86400000

// 本地时间 yyyy-MM-dd HH:mm
export function fmtTime(ms) {
  const d = new Date(ms), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function daysAgo(ms, now = Date.now()) {
  return Math.max(0, Math.floor((now - ms) / DAY_MS))
}

// 日历天差（跨零点就算一天，和「10-10 停在 10-15」这种口语口径对得上）
export function calendarDaysAgo(ms, now = Date.now()) {
  const a = new Date(ms), b = new Date(now)
  const d0 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const d1 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.max(0, Math.round((d1 - d0) / DAY_MS))
}

// 读 JSON；缺失 / 坏了 → null（不抛）
function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return null }
}

// 文件 mtime；读不到 → null（不抛）
function mtimeMs(file) {
  try { return statSync(file).mtimeMs } catch { return null }
}

// 读文本；读不到 → null（不抛）
function readText(file) {
  try { return readFileSync(file, 'utf8') } catch { return null }
}

// 一个目录里 .md 的「份数 + 总字符」（读不动的文件跳过）
function layerSize(dir) {
  let files = 0, chars = 0
  for (const f of mdFiles(dir)) {
    const t = readText(join(dir, f))
    if (t === null) continue
    files++; chars += t.length
  }
  return { files, chars }
}

// 短层条目行（`- ` 开头且 ≥10 字符），用于算实际条数与最长条目
function entryRows(memDir) {
  const rows = []
  const add = (file, label) => {
    const txt = readText(file)
    if (txt === null) return
    const lines = txt.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim()
      if (raw.startsWith('- ') && raw.length >= 10) rows.push({ label, ln: i + 1, text: raw.slice(2) })
    }
  }
  add(join(memDir, 'SUMMARY.md'), 'SUMMARY.md')
  for (const f of mdFiles(join(memDir, 'topics'))) add(join(memDir, 'topics', f), `topics/${f}`)
  return rows
}

// 查询末尾那一行；库文件都缺失时返回 ''（调用方据此不打）
export function freshnessLine(memDir) {
  const idx = readJson(join(memDir, 'index.json'))
  const upd = typeof idx?.updated === 'string' ? idx.updated : ''
  const summMs = mtimeMs(join(memDir, 'SUMMARY.md'))
  let ts = null
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(upd)) ts = Date.parse(upd)
  else if (summMs !== null) ts = summMs
  else if (/^\d{4}-\d{2}-\d{2}$/.test(upd)) ts = Date.parse(`${upd}T00:00:00`)
  if (ts === null || !Number.isFinite(ts)) return ''
  const total = Number.isFinite(idx?.total) ? idx.total : entryRows(memDir).length
  return `  库建于 ${fmtTime(ts)}（${daysAgo(ts)} 天前）${total ? `，共 ${total} 条` : ''}`
}

// 一次给出：总条数 / 正文总字符 / 粗估 token / 最长条目 / 主题分布 / 采集停更天数
export function statsReport(memDir) {
  const idx = readJson(join(memDir, 'index.json'))
  const rows = entryRows(memDir)
  const layers = [
    ['SUMMARY.md', { files: existsSync(join(memDir, 'SUMMARY.md')) ? 1 : 0, chars: (readText(join(memDir, 'SUMMARY.md')) ?? '').length }],
    ['topics/', layerSize(join(memDir, 'topics'))],
    ['manual/', layerSize(join(memDir, 'manual'))],
    ['procedures/', layerSize(join(dirname(memDir), 'procedures'))],
  ]
  const chars = layers.reduce((a, [, l]) => a + l.chars, 0)
  const files = layers.reduce((a, [, l]) => a + l.files, 0)
  const L = []
  L.push(`  记忆库概览：${memDir}`)
  L.push(`  总条数      ${Number.isFinite(idx?.total) ? idx.total : rows.length} 条（index.json.total` +
    `${Number.isFinite(idx?.total) && idx.total !== rows.length ? `；摘要+主题实际条目行 ${rows.length} 行` : ''}）`)
  L.push(`  正文总字符  ${chars.toLocaleString('en-US')} 字符 / ${files} 份 .md（${layers.map(([n, l]) => `${n} ${l.chars.toLocaleString('en-US')}`).join(' + ')}）`)
  L.push(`  粗估 token  约 ${Math.round(chars / TOKEN_DIVISOR).toLocaleString('en-US')}（字符 ÷ ${TOKEN_DIVISOR}，仅粗估）`)
  const longest = [...rows].sort((a, b) => b.text.length - a.text.length).slice(0, 3)
  if (longest.length) {
    L.push('  最长条目')
    longest.forEach((r, i) => L.push(`    ${i + 1}. ${r.text.length} 字符  ${r.label}#${r.ln}`))
  }
  const cats = Array.isArray(idx?.categories) ? idx.categories.filter(c => typeof c?.name === 'string') : []
  if (cats.length) {
    L.push(`  主题分布    ${cats.length} 个主题：${cats.map(c => `${c.name} ${c.count}`).join(' / ')}`)
  } else {
    const byFile = new Map()
    for (const r of rows) if (r.label.startsWith('topics/')) byFile.set(r.label, (byFile.get(r.label) ?? 0) + 1)
    if (byFile.size) L.push(`  主题分布    ${byFile.size} 个主题：${[...byFile.entries()].map(([f, n]) => `${f.slice(7, -3)} ${n}`).join(' / ')}`)
  }
  const st = mtimeMs(join(memDir, '.state.json'))
  L.push(st === null
    ? '  采集停更    .state.json 不存在（没跑过 collect？）'
    : `  采集停更    ${daysAgo(st)} 天（.state.json 最后写入 ${fmtTime(st)}；按日历天算 ${calendarDaysAgo(st)} 天）`)
  const fresh = freshnessLine(memDir)
  if (fresh) L.push(fresh.replace(/^ +/, '  库新鲜度    '))
  return L.join('\n')
}
