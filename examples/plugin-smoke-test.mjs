/**
 * plugin-smoke-test.mjs — 插件冒烟测试（不装进 DSH 也能验）
 *
 * 它模拟宿主：造一个假的 ctx 调 apply()，然后拿假 exec 调 mem_query。
 * 能验到四件事：插件入口能加载、工具注册得出、命中路径通、无库时正确报错。
 *
 * 用法（必须在能解析 @deepseek-ai/dsh-tools 的目录下运行 —— 例如 DSH 的 profile 目录）：
 *   node examples/plugin-smoke-test.mjs [记忆库目录]
 *
 * 记忆库目录缺省为仓库根；先按 README 的 demo 生成一份库即可：
 *   mkdir -p extracts && cp examples/extracts-example.json extracts/00.json
 *   cp examples/memory.config.example.json memory.config.json
 *   node src/build.mjs
 *   node examples/plugin-smoke-test.mjs .
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = dirname(here)
const memDir = process.argv[2] ?? pkgRoot

const mod = await import(new URL('../index.js', import.meta.url).href)

const registered = []
mod.apply({ tools: { register: (t) => { registered.push(t); return () => {} } } })

console.log('插件 name =', mod.name)
console.log('inject    =', JSON.stringify(mod.inject))
console.log('注册工具  =', registered.map(t => t.name).join(', '))
if (!registered.length) {
  console.error('✗ 没有注册任何工具')
  process.exit(1)
}

const tool = registered[0]
const mkExec = (cwd) => ({ agent: { session: { header: { cwd } } } })
let failed = 0

console.log(`\n记忆库：${memDir}`)
for (const [label, args] of [
  ['英文命中', { query: 'BOM', n: 3 }],
  ['中文命中', { query: '单元格' }],
  ['多词', { query: 'bat crlf' }],
  ['未命中', { query: '量子计算机' }],
  ['全是短词', { query: 'a b' }],
]) {
  const r = await tool.execute(args, mkExec(memDir))
  const first = String(r.text ?? '').split('\n')[0]
  console.log(`  ${label.padEnd(6)} ok=${String(r.ok).padEnd(5)} hits=${r.hits}  ${first.slice(0, 58)}`)
}

// 工作区里没有记忆库时必须明确报错，而不是回退到别处的库
const r = await tool.execute({ query: 'bom' }, mkExec(tmpdir()))
console.log(`  ${'无库'.padEnd(6)} ok=${String(r.ok).padEnd(5)} dir=${r.dir}`)
if (r.ok || r.dir !== null) {
  console.error('✗ 工作区无库时不应返回命中（会跨工作区串记忆）')
  failed++
}

console.log(failed ? '\n✗ 冒烟测试失败' : '\n✓ 冒烟测试通过')
process.exit(failed ? 1 : 0)
