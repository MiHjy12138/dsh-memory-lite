#!/usr/bin/env node
// build.mjs — 汇总 extracts/*.json → 分层记忆库
//
//   SUMMARY.md        顶层总览：人工提炼的一句话（内容与条数来自 memory.config.json）
//   INDEX.md          全库索引：按【主题】分组
//   topics/<主题>.md   明细按主题分家，文件头写明「何时翻它」
//   index.json        机读索引
//
// 数据目录：默认取脚本所在目录；脚本在 <memory>/src/ 下时自动上溯一级。
//           可用环境变量 MEM_HOME 覆盖。
//
// 配置（可选）：<数据目录>/memory.config.json
//   {
//     "project": "my-project",
//     "cats":  [{ "key": "script", "name": "脚本与编码", "when": "…", "kw": ["BOM", "编码"] }],
//     "scenes":[{ "name": "动手之前先过一遍", "hint": "改配置前", "items": [["topic 名", "提炼后的一句话"]] }]
//   }
//   cats 缺省时用内置通用分类；scenes 缺省时 SUMMARY 只输出主题导航。
//
// 用法：node build.mjs

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const MEM_DIR = process.env.MEM_HOME ?? (basename(HERE) === 'src' ? dirname(HERE) : HERE)
const EXT = join(MEM_DIR, 'extracts')
const TOPICS = join(MEM_DIR, 'topics')
const STAGING = join(MEM_DIR, '.staging')
const KIND_CN = { lesson: '教训', decision: '决定', fact: '事实', state: '状态' }

// ── 配置 ──────────────────────────────────────────────────
const CFG = existsSync(join(MEM_DIR, 'memory.config.json'))
  ? JSON.parse(readFileSync(join(MEM_DIR, 'memory.config.json'), 'utf8'))
  : {}
const PROJECT = CFG.project ?? basename(MEM_DIR)
const SCENES = CFG.scenes ?? []

// ── 分类（config.cats 优先；未配置时用下面这套通用分类）───────────
const DEFAULT_CATS = [
  { key: 'script', name: '脚本与编码', when: '写 PowerShell / bat / shell，处理编码与换行时', kw: [/BOM/i, /CRLF/i, /GBK/i, /编码/, /换行/, /引号/, /转义/, /ps1/i, /\.bat\b/i, /bash/i] },
  { key: 'env', name: '环境与沙箱', when: '碰权限、沙箱、进程、端口、路径时', kw: [/沙箱/, /权限/, /进程/, /端口/, /路径/, /磁盘/, /回收/, /cwd/i] },
  { key: 'tool', name: '工具与插件', when: '装/卸/升级插件、改配置、动缓存时', kw: [/插件/, /plugin/i, /bundle/i, /profile/i, /preset/i, /版本/, /缓存/, /配置/] },
  { key: 'model', name: '模型与成本', when: '换模型、算额度、排查请求异常、谈 token 成本时', kw: [/token/i, /模型/, /额度/, /延迟/, /上下文/, /计费/, /超时/] },
  { key: 'data', name: '数据与自动化', when: '批量处理表格、文档、文件时', kw: [/Excel/i, /表格/, /CSV/i, /单元格/, /批量/, /Range/i, /文档/] },
  { key: 'method', name: '协作与验收', when: '规划任务、验收他人成果、和人对齐口径时', kw: [/验收/, /核对/, /确认/, /口径/, /授权/, /结论/, /交付/] },
]
const MISC = { key: 'misc', name: '其他零散结论', when: '其他一次性结论，一般不必主动翻' }
const CATS = (CFG.cats?.length
  ? CFG.cats.map(c => ({ ...c, kw: (c.kw ?? []).map(k => new RegExp(k, 'i')) }))
  : DEFAULT_CATS)
const CAT_MAP = existsSync(join(MEM_DIR, 'cats.json'))
  ? JSON.parse(readFileSync(join(MEM_DIR, 'cats.json'), 'utf8'))
  : {}

function classify(it) {
  const forced = CAT_MAP[it.topic]
  if (forced === 'misc') return MISC
  if (forced) { const hit = CATS.find(x => x.key === forced); if (hit) return hit }
  const hay = `${it.topic ?? ''} ${it.text ?? ''}`
  for (const c of CATS) if ((c.kw ?? []).some(r => r.test(hay))) return c
  return MISC
}

// ── 读提取结果 ──────────────────────────────────────────────
if (!existsSync(EXT)) {
  console.error(`没有 ${EXT} 目录。`)
  console.error('流程：node mem.mjs collect → 读 .staging/ 素材 → 写 extracts/*.json → 再跑 build')
  process.exit(1)
}

const DATES = existsSync(join(MEM_DIR, 'dates.json'))
  ? JSON.parse(readFileSync(join(MEM_DIR, 'dates.json'), 'utf8'))
  : {}

function dateOf(shortId) {
  if (DATES[shortId]) return DATES[shortId]
  for (const dir of [STAGING, join(MEM_DIR, '.archive', 'staging')]) {
    if (!existsSync(dir)) continue
    const f = readdirSync(dir).find(x => x.includes(shortId))
    if (!f) continue
    const m = /时间跨度：(\d{4}-\d{2}-\d{2})/.exec(readFileSync(join(dir, f), 'utf8').slice(0, 600))
    if (m) return m[1]
  }
  return null
}

const all = []
for (const f of readdirSync(EXT).filter(x => x.endsWith('.json')).sort()) {
  for (const it of JSON.parse(readFileSync(join(EXT, f), 'utf8'))) {
    const shortId = /session-([0-9a-f]{8})/.exec(it.source ?? '')?.[1] ?? null
    all.push({ ...it, shortId, date: it.date ?? ((shortId ? dateOf(shortId) : null) ?? '1970-01-00'), cat: classify(it) })
  }
}
if (!all.length) {
  console.error(`${EXT} 里没有条目。`)
  process.exit(1)
}
all.sort((a, b) => a.date.localeCompare(b.date) || (a.shortId ?? '').localeCompare(b.shortId ?? ''))
let n = 0
for (const it of all) it.id = `${it.date.replace(/-/g, '')}-${String(++n).padStart(3, '0')}`

const topTopics = new Set(SCENES.flatMap(s => (s.items ?? []).map(x => x[0])))
const byTopic = new Map(all.map(it => [it.topic, it]))
const missing = [...topTopics].filter(t => !byTopic.has(t))
if (missing.length) console.log(`  ⚠ 顶层配置里 ${missing.length} 个 topic 对不上明细：${missing.join('、')}`)

const cats = [...CATS, MISC]
const catList = cats.filter(c => all.some(it => it.cat.key === c.key))

// ── ① topics/<主题>.md ─────────────────────────────────────
mkdirSync(TOPICS, { recursive: true })
mkdirSync(join(MEM_DIR, '.archive'), { recursive: true })

// 清理改名后残留的孤立主题文件（类名变更时旧文件不会自己消失）
const validTopicFiles = new Set(catList.map(x => `${x.name}.md`))
for (const f of readdirSync(TOPICS).filter(x => x.endsWith('.md') && !validTopicFiles.has(x))) {
  renameSync(join(TOPICS, f), join(MEM_DIR, '.archive', `stale-${f}`))
  console.log(`  · 孤立主题文件已归档：${f}`)
}

for (const c of catList) {
  const items = all.filter(it => it.cat.key === c.key)
  const L = []
  L.push(`# ${c.name}`)
  L.push('')
  L.push(`> **何时翻它**：${c.when}`)
  L.push(`> ${items.length} 条｜总览见 ..\\SUMMARY.md，索引见 ..\\INDEX.md｜来源标注 session-短id#事件序号`)
  for (const it of items) {
    L.push('')
    L.push(`- **[${KIND_CN[it.kind] ?? it.kind}]** ${it.text} \`${it.source}\``)
  }
  L.push('')
  writeFileSync(join(TOPICS, `${c.name}.md`), L.join('\n'), 'utf8')
}

// ── ② INDEX.md ────────────────────────────────────────────
const L2 = []
L2.push(`# 项目记忆索引 · ${PROJECT}`)
L2.push('')
L2.push(`> 全库 ${all.length} 条，按 **主题** 分家（明细在 topics\\）。顶层见 SUMMARY.md。`)
L2.push('> **用法**：优先跑 \`mem.mjs query "关键词"\` 直接取命中片段；需要全局浏览时再读本文件。')
for (const c of catList) {
  const items = all.filter(it => it.cat.key === c.key)
  L2.push('')
  L2.push(`## ${c.name}（${items.length} 条）—— ${c.when}`)
  L2.push('')
  for (const it of items) L2.push(`- \`${it.id}\` **[${KIND_CN[it.kind] ?? it.kind}]** ${it.topic}${topTopics.has(it.topic) ? ' ★顶层' : ''}`)
}
L2.push('')
writeFileSync(join(MEM_DIR, 'INDEX.md'), L2.join('\n'), 'utf8')

// ── ③ SUMMARY.md（顶层，人工提炼句）────────────────────────
const L3 = []
L3.push(`# 记忆总览 · ${PROJECT}`)
L3.push('')
L3.push(`> 顶层是**提炼后的一句话**；全部 ${all.length} 条明细按 ${catList.length} 个主题分家，见 INDEX.md。`)
L3.push('> 要深入某一块时，按下面的主题导航去读对应的 topics/<主题>.md —— **不要整份载入**。')
if (!SCENES.length) {
  L3.push('')
  L3.push('> ⚠ 还没有配置顶层场景。在 memory.config.json 里写 `scenes`，把最该记住的一句话提炼上来。')
}
for (const s of SCENES) {
  const items = (s.items ?? []).filter(([t]) => byTopic.has(t))
  if (!items.length) continue
  L3.push('')
  L3.push(`## ${s.name}`)
  L3.push('')
  L3.push(`*${s.hint}*`)
  L3.push('')
  for (const [, one] of items) L3.push(`- ${one}`)
}
L3.push('')
L3.push('## 主题导航（要深入时去这里）')
L3.push('')
L3.push('| 主题 | 条数 | 何时翻 |')
L3.push('|---|---|---|')
for (const c of catList) L3.push(`| topics\\${c.name}.md | ${all.filter(it => it.cat.key === c.key).length} | ${c.when} |`)
L3.push('')
writeFileSync(join(MEM_DIR, 'SUMMARY.md'), L3.join('\n'), 'utf8')

// ── ④ index.json ──────────────────────────────────────────
writeFileSync(join(MEM_DIR, 'index.json'), JSON.stringify({
  version: 3,
  project: PROJECT,
  updated: new Date().toISOString().slice(0, 10),
  total: all.length,
  topCount: topTopics.size,
  categories: catList.map(c => ({ key: c.key, name: c.name, when: c.when, count: all.filter(it => it.cat.key === c.key).length })),
  entries: all.map(it => ({
    id: it.id, date: it.date, kind: it.kind, topic: it.topic,
    cat: it.cat.key, catName: it.cat.name, top: topTopics.has(it.topic),
    file: `topics\\${it.cat.name}.md`, source: it.source,
  })),
}, null, 2), 'utf8')

// ── 汇总 ─────────────────────────────────────────────────
const sumText = L3.join('\n')
console.log(`\n顶层 SUMMARY.md：${topTopics.size} 条 / ${sumText.length} 字符 / ${Buffer.byteLength(sumText, 'utf8')} 字节`)
console.log(`索引 INDEX.md：${all.length} 条`)
console.log('分类分布：' + catList.map(c => `${c.name} ${all.filter(it => it.cat.key === c.key).length}`).join('｜'))
const kinds = {}
for (const it of all) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1
console.log('类型分布：' + Object.entries(kinds).map(([k, v]) => `${KIND_CN[k] ?? k} ${v}`).join('｜'))
console.log(`明细已写入 topics\\（${catList.length} 个主题文件）`)
