#!/usr/bin/env node
// verify.mjs — 核对抽取条目的来源标注是否与素材原文对得上
//
// 用法：node verify.mjs extract.json [--staging <素材目录>]
//   输入：抽取结果 JSON 数组（[{kind,topic,text,source}]）
//   输出：逐条的核对表——标出该 seq 在素材里的原文前 60 字，供人工判断相关性
//   --staging 可换成 examples/staging 之类，方便对着示例跑
//
// 为什么需要它：记忆条目的价值取决于「它真的来自某次真实经历」。
// 这份核对会告诉你：每条标注的 source 能不能在素材里找到、找到的那段话与条目说的是不是一回事。

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MEM_DIR = process.env.MEM_HOME ?? (basename(HERE) === 'src' ? dirname(HERE) : HERE)
const STAGING = join(MEM_DIR, '.staging')

const argv = process.argv.slice(2)
const sIdx = argv.indexOf('--staging')
const stagingArg = sIdx >= 0 ? argv[sIdx + 1] : null
const src = argv.find((a, i) => !a.startsWith('--') && i !== sIdx + 1)
if (!src) { console.log('用法：node verify.mjs extract.json [--staging <素材目录>]'); process.exit(1) }
const items = JSON.parse(readFileSync(src, 'utf8'))

// 建立「短 id → 素材内容行」的索引
const STAGING_DIR = stagingArg ?? STAGING
const DIRS = [STAGING_DIR, join(MEM_DIR, '.archive', 'staging')].filter(d => existsSync(d))
const files = DIRS.flatMap(d => readdirSync(d).filter(f => f.endsWith('.md')).map(f => join(d, f)))
const cache = new Map()
function linesOf(shortId) {
  if (cache.has(shortId)) return cache.get(shortId)
  const f = files.find(x => x.includes(shortId))
  if (!f) { cache.set(shortId, null); return null }
  const lines = readFileSync(f, 'utf8').split('\n')
  cache.set(shortId, lines)
  return lines
}

let ok = 0, mismatch = 0, missing = 0
const report = []
for (const it of items) {
  const m = /session-([0-9a-f]{8})#(\d+)/.exec(it.source ?? '')
  if (!m) { report.push({ ...it, verdict: '格式坏', detail: it.source }); missing++; continue }
  const [, shortId, seq] = m
  const lines = linesOf(shortId)
  if (!lines) { report.push({ ...it, verdict: '无素材文件', detail: shortId }); missing++; continue }
  // 找行尾标了这个 seq 的素材行，再取它所在的整条消息块（含多行续行）
  const li = lines.findIndex(l => l.endsWith(`\`#${seq}\``))
  if (li < 0) { report.push({ ...it, verdict: 'seq不存在', detail: `#${seq}` }); missing++; continue }
  let start = li, stop = li + 1
  while (start > 0 && !lines[start].startsWith('- [')) start--
  while (stop < lines.length && !lines[stop].startsWith('- [')) stop++
  const block = lines.slice(start, stop).join('\n').replace(/\s*`#\d+`\s*$/, '')
  const raw = block.replace(/^- \[(用户|助手)\]\s*/, '').replace(/\s+/g, ' ').slice(0, 60)
  // 粗判相关性：条目 text 里的关键词是否出现在该消息块里
  const words = (it.text ?? '').match(/[\u4e00-\u9fa5A-Za-z0-9_.-]{3,}/g) ?? []
  const body = block.replace(/\s+/g, ' ')
  const hit = words.filter(w => body.includes(w.slice(0, 6))).length
  const verdict = hit >= 2 ? '✅ 对得上' : hit === 1 ? '⚠ 弱相关' : '❌ 不相关'
  if (verdict === '✅ 对得上') ok++; else mismatch++
  report.push({ ...it, verdict, detail: raw })
}

console.log('核对结果：', `${ok} 对得上 / ${mismatch} 存疑 / ${missing} 找不到`, '\n')
for (const r of report) {
  console.log(`${r.verdict}  ${r.source}`)
  console.log(`   条目：${(r.text ?? '').slice(0, 70)}`)
  console.log(`   原文：${r.detail}`)
}
const rate = items.length ? (ok / items.length * 100).toFixed(0) : 0
console.log(`\n准确率：${rate}%`)
