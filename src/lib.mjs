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
import { existsSync, readFileSync, readdirSync } from 'node:fs'
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
      let n = 0, at = 0
      while ((at = low.indexOf(t, at)) !== -1) { n++; at += t.length }
      if (n) { hits++; score += Math.min(t.length, 6) * (1 + Math.log2(n + 1)) }
    }
    if (!hits) continue
    out.push({ score: Math.round(score * 10) / 10, hits, file: label, ln: i + 1, text })
  }
}

// 扫 SUMMARY.md + topics/*.md（不扫 INDEX.md，避免索引与正文重复计分）
export function queryDir(memDir, terms, n = 5) {
  const out = []
  const summ = join(memDir, 'SUMMARY.md')
  if (existsSync(summ)) scanFile(summ, 'SUMMARY.md', terms, out)
  const tdir = join(memDir, 'topics')
  if (existsSync(tdir)) {
    for (const f of readdirSync(tdir)) if (f.endsWith('.md')) scanFile(join(tdir, f), `topics/${f}`, terms, out)
  }
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
    lines.push(`  ${i + 1}. [${r.score}] ${r.file}#${r.ln}`)
    lines.push(`     ${body}`)
    lines.push('')
  })
  return lines.join('\n').replace(/\n+$/, '')
}
