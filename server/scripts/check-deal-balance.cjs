// Run after the server build. Samples the real dealers, with optional historical JSON data.
// No production writes. Each catalog is isolated in its own child process to avoid loader caches.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const arg = key => { const i = process.argv.indexOf(key); return i < 0 ? null : process.argv[i + 1] }
const sampleRef = arg('--sample')
if (sampleRef) {
  if (sampleRef !== 'working-tree') {
    const cache = new Map()
    require('../dist/server/loadJson.js').readJson = relative => {
      if (!cache.has(relative)) cache.set(relative, JSON.parse(execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `${sampleRef}:server/data/${relative}`], { cwd: root, encoding: 'utf8', maxBuffer: 8e6 })))
      return cache.get(relative)
    }
  }
  const { dealCharacteristics } = require('../dist/server/characteristics.js')
  const { averageCoef } = require('../dist/server/cards.js')
  const results = []
  const targets = arg('--target') === null ? [0, .25, .5, .75, .9, null] : [Number(arg('--target'))]
  for (const mode of ['classic', 'new']) for (const target of targets) {
    let seed = 20260925
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
    const coefs = [], sizes = []
    let duplicateDeals = 0
    for (let game = 0; game < 12; game++) {
      const players = Array.from({ length: 6 }, (_, i) => ({ id: String(i), clientId: String(i), name: String(i), characteristics: [], biology: null, isAlive: true, connected: true }))
      const extraBaggage = game % 2 === 0
      dealCharacteristics(players, { gameMode: mode, targetCoef: target, extraBaggage })
      const values = players.flatMap(p => p.characteristics.map(c => c.value))
      if (new Set(values).size !== values.length) duplicateDeals++
      for (const p of players) {
        sizes.push(p.characteristics.length === (extraBaggage ? 7 : 6))
        if (sizes.at(-1)) coefs.push(averageCoef(p, mode))
      }
    }
    coefs.sort((a,b) => a-b)
    results.push({ mode, target, total: sizes.length, incomplete: sizes.filter(x => !x).length, duplicateDeals,
      mean: coefs.length ? coefs.reduce((s,x) => s+x,0)/coefs.length : null,
      meanError: target !== null && coefs.length ? coefs.reduce((s,x) => s+Math.abs(x-target),0)/coefs.length : null,
      p10: coefs[Math.floor(coefs.length*.1)] ?? null, p90: coefs[Math.floor(coefs.length*.9)] ?? null })
  }
  console.log(JSON.stringify(results))
} else {
  const ref = arg('--baseline')
  const sample = ref => JSON.parse(execFileSync(process.execPath, [__filename, '--sample', ref || 'working-tree'], { cwd: root, encoding: 'utf8', maxBuffer: 8e6 }))
  const before = ref ? sample(ref) : null, after = sample(null)
  const n = x => x == null ? '—' : x.toFixed(3)
  const lines = ['# Проверка реальной раздачи', '', `База: ${ref || 'нет'}, текущие алгоритмы для обоих каталогов. По 12 лобби × 6 игроков на режим и целевой КФ; в половине лобби два багажа. Фиксированный seed. Стадии здоровья, биология и уникальность обрабатываются настоящими алгоритмами.`, '',
    'Это небольшая диагностическая выборка, не статистическая гарантия. Столбец пустых раздач выявляет исчерпание попыток алгоритма. Для null среднее отклонение от цели не определяется.', '',
    '| Режим | Цель | Средний КФ до → после | Среднее абсолютное отклонение до → после | Неполных раздач до → после (из 72) | Лобби с дублями до → после |', '|---|---:|---:|---:|---:|---:|']
  after.forEach((x,i) => { const b = before?.[i]; lines.push(`| ${x.mode} | ${x.target ?? 'null'} | ${n(b?.mean)} → ${n(x.mean)} | ${n(b?.meanError)} → ${n(x.meanError)} | ${b?.incomplete ?? '—'} → ${x.incomplete} | ${b?.duplicateDeals ?? '—'} → ${x.duplicateDeals} |`) })
  lines.push('', 'Высокие цели особенно чувствительны к исчерпанию уникального пула. Изменение алгоритма/fallback не входит в ребаланс каталога; обнаруженные случаи нельзя выдавать за успешные раздачи.')
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true })
  fs.writeFileSync(path.join(root, 'reports/deal-balance.md'), lines.join('\n') + '\n')
  console.log(JSON.stringify({ before, after }, null, 2))
}
