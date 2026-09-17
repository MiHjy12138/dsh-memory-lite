#!/usr/bin/env node
// mem.mjs — 轻量记忆采集器 + 检索器（零依赖，Node 18+）
//
// 用法：
//   node mem.mjs collect          扫本工作区会话日志 → 产出素材到 .staging/
//   node mem.mjs collect --all    扫全部工作区（跨 cwd）
//   node mem.mjs collect --force  忽略增量判重，全部重跑
//   node mem.mjs list             列出待处理素材
//   node mem.mjs mark <id>        把素材标为已处理
//   node mem.mjs query "关键词"    扫 SUMMARY + topics，只回命中片段（默认 5 条，--n 调数量）
//                                 —— 用法约定：查记忆先跑这个，别整份读 SUMMARY / INDEX
//
// 数据目录：默认取脚本所在目录（脚本放在 memory/ 下）
//           若脚本位于 <memory>/src/ 下，则自动上溯一级
//           可用环境变量 MEM_HOME 覆盖
//
// 采集范围：DSH 会话日志（<DSH_HOME>/sessions/**/session.*.jsonl.zstd）
//           换平台时只需要替换 collect / decodeFrames 这两部分
//
// 过滤判据：
//   真人输入的事件带 data.source.kind === "user"；其余（plugin / agent-message /
//   subagent-settled / skill-catalog / agent-instructions）全是注入。实测样本里
//   user/message 共 1,139 条，真人只有 365 条（32%），注入占 68% —— 内容前缀正则
//   只能抓到 7%，所以主判据用 source.kind，前缀正则仅作「无 source 的老格式」兜底。

import { zstdDecompressSync } from 'node:zlib'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const MEM_DIR = process.env.MEM_HOME ?? (basename(HERE) === 'src' ? dirname(HERE) : HERE)
const STAGING = join(MEM_DIR, '.staging')
const STATE = join(MEM_DIR, '.state.json')
const SESSIONS = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])   // zstd frame magic
const MAX_ENTRY = 800      // 单条截断（字符）
const MAX_TOTAL = 48000    // 单会话素材上限（字符），超出丢最早的
const INJECT = [           // 无 source 的老格式兜底
  /^=====\s*长期记忆/,
  /^<system-reminder/,
  /^<referenced-sessions/,
  /^## Referenced sessions/,
  /^Instructions from:/,
  /^Current runtime context\./,
  /^The approval policy changed/,
]

// ── 解压：文件是多 frame 串联，按 magic 切分后逐段解 ──────────────
function decodeFrames(buf) {
  const idx = []
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) idx.push(i)
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

function readHead(file) {
  const buf = readFileSync(file)
  return decodeFrames(buf.subarray(0, Math.min(buf.length, 8192))).text.split('\n').filter(Boolean)
}

// ── 事件取文本 ──────────────────────────────────────────────
// user 消息正文在 data.content，assistant 在 data.message.content（实测差异）。
// 只取 type==="text" 的块：reasoning（推理）与 tool-call 一律不要。
function textOf(e) {
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

// ── 过滤：只留真人输入 / 助手回复 / 压缩点 ─────────────────────
function filterEvents(events) {
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
        // 老格式：没有 source，只能靠内容前缀判
        if (INJECT.some(r => r.test(txt))) { bump('无source·前缀命中'); continue }
      } else if (src.kind !== 'user') {
        bump(src.plugin ?? src.kind ?? '(kind缺失)')
        continue
      }
    }
    out.push({ kind: t === 'user/message' ? '用户' : '助手', text: txt, seq: e.seq, time: e.time })
  }
  return { kept: out, dropped }
}

// ── 渲染素材 md ────────────────────────────────────────────
function fmt(t) {
  if (!t) return '—'
  const d = new Date(t), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function render(sid, head, kept, totalEvents, dropped, frames, failed) {
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
  const span = `${fmt(kept[0]?.time ?? head?.createdAt)} → ${fmt(kept[kept.length - 1]?.time)}`
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

// ── 状态读写 ──────────────────────────────────────────────
function loadState() { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return {} } }
function saveState(s) { writeFileSync(STATE, JSON.stringify(s, null, 2), 'utf8') }
const norm = p => (p ?? '').replace(/[\\/]+$/, '').toLowerCase()

// ── collect ───────────────────────────────────────────────
function collect({ all = false, force = false, cwd = process.cwd() } = {}) {
  mkdirSync(STAGING, { recursive: true })
  const state = loadState()
  let processed = 0, skipped = 0, scanned = 0, live = 0
  const target = norm(cwd)

  for (const dir of readdirSync(SESSIONS)) {
    const cwdDir = join(SESSIONS, dir)
    let ents; try { ents = readdirSync(cwdDir) } catch { continue }
    for (const sid of ents) {
      const sdir = join(cwdDir, sid)
      let files; try { files = readdirSync(sdir) } catch { continue }
      const logName = files.find(f => f.startsWith('session.') && f.endsWith('.jsonl.zstd'))
      if (!logName) continue
      const file = join(sdir, logName)
      const st = statSync(file)
      scanned++

      const rec = state[sid]
      const staged = existsSync(join(STAGING, `${sid}.md`))
      const done = existsSync(join(STAGING, `${sid}.done.md`))
      if (!force && rec && rec.size === st.size && rec.mtimeMs === st.mtimeMs) { skipped++; continue }
      if (!force && (staged || done) && rec && rec.size === st.size) { skipped++; continue }

      const headLine = readHead(file).find(l => { try { return JSON.parse(l).type === 'session' } catch { return false } })
      const head = headLine ? JSON.parse(headLine) : null
      if (!all && head?.cwd && norm(head.cwd) !== target) { skipped++; continue }

      const { text, frames, failed } = decodeFrames(readFileSync(file))
      const events = []
      for (const l of text.split('\n')) { if (!l) continue; try { events.push(JSON.parse(l)) } catch { /* 半帧截断 */ } }
      const { kept, dropped } = filterEvents(events)
      if (kept.length < 2) { skipped++; continue }

      const md = render(sid, head, kept, events.length, dropped, frames, failed)
      writeFileSync(join(STAGING, `${sid}.md`), md, 'utf8')
      const grew = rec ? '（上次已采集，本次有新增）' : ''
      state[sid] = { size: st.size, mtimeMs: st.mtimeMs, cwd: head?.cwd ?? null, stagedAt: new Date().toISOString() }
      processed++
      if (grew) live++
      console.log(`  + ${sid}  事件 ${events.length}｜保留 ${kept.length}${grew}`)
    }
  }
  saveState(state)
  return { scanned, processed, skipped, live }
}

// ── query：按关键词扫 SUMMARY + topics，只回命中片段 ──────────
// 目的：替代「先读 SUMMARY.md 再读 INDEX.md」那上万字符的固定开销。
// 打分：命中词长 × (1 + log2(命中次数))，多词累加；长词权重更高。
function scanFile(file, label, terms, out) {
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

function query(terms, n = 5) {
  const out = []
  const summ = join(MEM_DIR, 'SUMMARY.md')
  if (existsSync(summ)) scanFile(summ, 'SUMMARY.md', terms, out)
  const tdir = join(MEM_DIR, 'topics')
  if (existsSync(tdir)) {
    for (const f of readdirSync(tdir)) if (f.endsWith('.md')) scanFile(join(tdir, f), `topics\\${f}`, terms, out)
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

// ── list / mark ───────────────────────────────────────────
function list() {
  if (!existsSync(STAGING)) return []
  const rows = readdirSync(STAGING).filter(f => f.endsWith('.md') && !f.endsWith('.done.md'))
  for (const f of rows) {
    const p = join(STAGING, f)
    console.log(`  ${basename(f, '.md')}  ${(statSync(p).size / 1024).toFixed(1)} KB`)
  }
  return rows
}

function mark(id) {
  const src = join(STAGING, `${id}.md`), dst = join(STAGING, `${id}.done.md`)
  if (!existsSync(src)) { console.log(`  ! 没有这个素材：${id}`); return false }
  renameSync(src, dst)
  console.log(`  ✓ ${id} → .done.md`)
  return true
}

// ── CLI ───────────────────────────────────────────────────
const [cmd, ...flags] = process.argv.slice(2)
if (cmd === 'collect') {
  console.log(`扫描：${SESSIONS}`)
  const r = collect({ all: flags.includes('--all'), force: flags.includes('--force'), cwd: process.cwd() })
  console.log(`\n扫到 ${r.scanned} 个会话日志 → 产出素材 ${r.processed} 个，跳过 ${r.skipped} 个`)
  if (r.live) console.log(`其中 ${r.live} 个是「已采集过、本次有新增」（通常是当前正在进行的会话）`)
} else if (cmd === 'list') {
  const rows = list()
  console.log(rows.length ? `\n待处理 ${rows.length} 个` : '没有待处理素材')
} else if (cmd === 'mark') {
  if (!flags[0]) console.log('用法：node mem.mjs mark <session-id>')
  else mark(flags[0])
} else if (cmd === 'query') {
  const rest = flags.filter(f => !f.startsWith('--'))
  const nIdx = flags.indexOf('--n')
  const n = nIdx >= 0 ? Math.max(1, parseInt(flags[nIdx + 1], 10) || 5) : 5
  const terms = rest.join(' ').trim().toLowerCase().split(/\s+/).filter(t => t.length >= 2)
  if (!terms.length) {
    console.log('用法：node mem.mjs query "关键词 [关键词2]" [--n 5]')
  } else {
    const { picked, total } = query(terms, n)
    if (!picked.length) {
      console.log(`  没命中：${terms.join(' / ')}`)
      console.log('  换个词；或看 SUMMARY.md 的主题导航表（每个主题都标了「何时翻」）')
    } else {
      console.log(`  命中 ${total} 处 → 取前 ${picked.length} 条（关键词：${terms.join(' / ')}）\n`)
      picked.forEach((r, i) => {
        const body = r.text.length > 200 ? r.text.slice(0, 200) + '…' : r.text
        console.log(`  ${i + 1}. [${r.score}] ${r.file}#${r.ln}`)
        console.log(`     ${body}\n`)
      })
    }
  }
} else {
  console.log('用法：node mem.mjs <collect|list|mark|query> [--all] [--force]')
  console.log('      node mem.mjs query "关键词" --n 5')
}
