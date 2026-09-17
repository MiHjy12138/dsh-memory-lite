#!/usr/bin/env node
// mem.mjs — 轻量记忆采集器 + 检索 CLI（零依赖，Node 18+）
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
//           换平台时只需要替换 lib.mjs 里的 decodeFrames / filterEvents
//
// 核心逻辑在 lib.mjs —— 与 DSH 插件版（index.js）共用同一份实现。

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'
import {
  decodeFrames, readHead, filterEvents, renderSession, memDirFromScript,
  parseTerms, queryDir, formatHits,
} from './lib.mjs'

const MEM_DIR = process.env.MEM_HOME ?? memDirFromScript(import.meta.url)
const STAGING = join(MEM_DIR, '.staging')
const STATE = join(MEM_DIR, '.state.json')
const SESSIONS = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')

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

      const md = renderSession(sid, head, kept, events.length, dropped, frames, failed)
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
  const terms = parseTerms(rest.join(' '))
  if (!terms.length) {
    console.log('用法：node mem.mjs query "关键词 [关键词2]" [--n 5]')
  } else {
    const { picked, total } = queryDir(MEM_DIR, terms, n)
    console.log(formatHits(picked, total, terms))
  }
} else {
  console.log('用法：node mem.mjs <collect|list|mark|query> [--all] [--force]')
  console.log('      node mem.mjs query "关键词" --n 5')
}
