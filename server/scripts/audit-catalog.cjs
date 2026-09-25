// Reproducible data audit; does not change game data. Optional baseline: --baseline <git-ref>.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '../..')
const categories = ['profession', 'health', 'hobby', 'phobia', 'baggage', 'fact']
const penalties = new Set(['light_danger', 'dangerous', 'psychopath', 'maniac', 'suicidal', 'conflict'])
function load(ref) {
  const read = (file) => JSON.parse(ref
    ? execFileSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'show', `${ref}:server/data/${file}.json`], { cwd: root, encoding: 'utf8', maxBuffer: 8e6 })
    : fs.readFileSync(path.join(root, 'server/data', `${file}.json`), 'utf8'))
  return { categories: Object.fromEntries(categories.map(c => [c, read(`characteristics/${c}`)])),
    events: ['catastrophes', 'threats'].flatMap(c => read(`bunker/${c}`).items.map(x => ({ ...x, kind: c }))),
    conditions: read('bunker/conditions').items }
}
function stats(data) {
  const rows = Object.values(data.categories).flatMap(c => c.items.map(x => ({ ...x, category: c.category })))
  const required = [...new Set(data.events.flatMap(e => e.requirements.flat()))].sort()
  const isRisk = x => x.tags.some(t => penalties.has(t))
  return { categories: Object.fromEntries(Object.entries(data.categories).map(([key, { category, items }]) => [key, {
    category, count: items.length, mean: items.reduce((s, x) => s + x.coef, 0) / items.length,
    low: items.filter(x => x.coef < .35).length, mid: items.filter(x => x.coef >= .35 && x.coef < .7).length,
    high: items.filter(x => x.coef >= .7).length, risk: items.filter(isRisk).length,
  }])), tags: Object.fromEntries(required.map(tag => {
    const sources = rows.filter(x => x.tags.includes(tag))
    return [tag, { count: sources.length, categories: new Set(sources.map(x => x.category)).size,
      low: sources.filter(x => x.coef < .35).length, mid: sources.filter(x => x.coef >= .35 && x.coef < .7).length,
      high: sources.filter(x => x.coef >= .7).length }]
  })), light: rows.filter(x => x.tags.includes('light_danger')).length,
    riskLow: rows.filter(x => x.coef < .35 && isRisk(x)).length,
    riskHigh: rows.filter(x => x.coef >= .7 && isRisk(x)).length,
    conditionMean: data.conditions.reduce((s, x) => s + x.successDelta, 0) / data.conditions.length,
    grantMean: data.conditions.reduce((s, x) => s + x.grants.length, 0) / data.conditions.length }
}
// Diagnostic only: uniform rows, four survivors, two baggage slots, no target selection/biology/stages.
// Name-sorting keeps a seed comparable when catalog rows are resorted. No selection by survival value.
function coverageExperiment(data) {
  let seed = 25092026
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32 }
  const pools = [...categories, 'baggage'].map(c => [...data.categories[c].items].sort((a,b) => a.name.localeCompare(b.name, 'ru')))
  const events = data.events.filter(e => e.requirements.length && !e.requirements.flat().includes('reproductive_edge'))
  const perEvent = events.map(e => ({ id: e.id, plain: 0, condition: 0 }))
  const samples = 5000
  for (let i = 0; i < samples; i++) {
    const tags = new Set()
    for (let player = 0; player < 4; player++) for (const pool of pools) {
      pool[Math.floor(rng() * pool.length)].tags.forEach(t => tags.add(t))
    }
    const withCondition = new Set(tags)
    data.conditions[Math.floor(rng() * data.conditions.length)].grants.forEach(t => withCondition.add(t))
    events.forEach((e, j) => {
      if (e.requirements.every(g => g.some(t => tags.has(t)))) perEvent[j].plain++
      if (e.requirements.every(g => g.some(t => withCondition.has(t)))) perEvent[j].condition++
    })
  }
  return { plain: perEvent.reduce((s,e) => s + e.plain, 0) / events.length / samples * 100,
    condition: perEvent.reduce((s,e) => s + e.condition, 0) / events.length / samples * 100,
    perEvent: perEvent.map(e => ({ id: e.id, plain: e.plain / samples * 100, condition: e.condition / samples * 100 })) }
}
const baselineIndex = process.argv.indexOf('--baseline')
const ref = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null
if (baselineIndex >= 0 && !ref) throw new Error('Expected a baseline git ref')
const after = load(), before = ref ? load(ref) : after
const a = stats(after), b = stats(before), ca = coverageExperiment(after), cb = coverageExperiment(before)
const n = x => x.toFixed(2)
const cell = x => String(x ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
const lines = ['# Аудит каталога', '', `База сравнения: ${ref || 'текущий каталог'}. Источник: server/data, общий для обоих режимов.`, '',
  'КФ — игровая оценка аргументов и ограничений, не оценка человека и не медицинская шкала. Формула раздачи и финального подсчёта не менялась.', '',
  '## Распределение', '', 'Низкие: < 0.35; средние: 0.35–0.65; высокие: ≥ 0.70. У безопасного багажа отдельный минимум 0.40: его слабый край попадает в среднюю колонку.', '',
  '| Категория | Количество | Средний КФ до → после | Низкие до → после | Средние до → после | Высокие до → после | Риск до → после |',
  '|---|---:|---:|---:|---:|---:|---:|']
for (const k of categories) { const x = b.categories[k], y = a.categories[k]; lines.push(`| ${y.category} | ${y.count} | ${n(x.mean)} → ${n(y.mean)} | ${x.low} → ${y.low} | ${x.mid} → ${y.mid} | ${x.high} → ${y.high} | ${x.risk} → ${y.risk} |`) }
lines.push('', `light_danger: ${b.light} → ${a.light}; характеристики с социальным/опасным риском в низком диапазоне: ${b.riskLow} → ${a.riskLow}, в высоком: ${b.riskHigh} → ${a.riskHigh}.`, '',
  `Средний прямой бонус допусловия: ${n(b.conditionMean)} → ${n(a.conditionMean)} п.п.; среднее число выдаваемых тегов: ${n(b.grantMean)} → ${n(a.grantMean)}.`, '',
  '## Покрытие тегов', '', 'Считаются строки каталога (повторные строки здорового состояния/отсутствия фобии сохраняют вес). reproductive_edge генерируется биологией, поэтому здесь у него ноль.', '',
  '| Тег | Источников до → после | Категорий после | Низкий / средний / высокий КФ после |', '|---|---:|---:|---:|')
for (const [tag,x] of Object.entries(a.tags)) lines.push(`| ${tag} | ${b.tags[tag]?.count ?? 0} → ${x.count} | ${x.categories} | ${x.low} / ${x.mid} / ${x.high} |`)
lines.push('', '## Контрольный эксперимент покрытия', '',
  '5000 команд по 4 человека, равномерный выбор строк, два багажа. Без целевой коррекции, отбора голосованием, стадий здоровья, биологии и активных карт. Сканер бесплодия и пустые угрозы исключены. Это доля полностью закрытых событий, НЕ вероятность победы и НЕ прогноз реальных партий.', '',
  `Среднее покрытие без допусловий: ${n(cb.plain)}% → ${n(ca.plain)}%; с одним случайным допусловием: ${n(cb.condition)}% → ${n(ca.condition)}%.`, '',
  '| Событие | Без допусловия до → после | С одним допусловием до → после |', '|---|---:|---:|')
for (const x of ca.perEvent) { const y = cb.perEvent.find(e => e.id === x.id); lines.push(`| ${x.id} | ${y ? n(y.plain) : '—'} → ${n(x.plain)}% | ${y ? n(y.condition) : '—'} → ${n(x.condition)}% |`) }
lines.push('', '## Изменения характеристик', '', '| Категория / характеристика | КФ до → после | Теги до → после | Новая подсказка |', '|---|---:|---|---|')
let changed = 0
for (const k of categories) for (const x of after.categories[k].items) {
  const old = before.categories[k].items.find(y => y.name === x.name)
  if (old && JSON.stringify(old) === JSON.stringify(x)) continue
  changed++
  lines.push(`| ${cell(after.categories[k].category)}: ${cell(x.name)} | ${old?.coef ?? 'новая/переименована'} → ${x.coef} | ${cell(old?.tags.join(', ') || '—')} → ${cell(x.tags.join(', ') || '—')} | ${cell(x.hint)} |`)
}
lines.push('', '## Допусловия после ребаланса', '', '| Условие | Теги | Прямой бонус | Описание |', '|---|---|---:|---|')
after.conditions.forEach(x => lines.push(`| ${cell(x.title)} | ${x.grants.join(', ')} | +${x.successDelta} | ${cell(x.text)} |`))
lines.push('', '## Удалённые названия / заменённые варианты', '', 'Размеры колод сохранены. Эти названия заменены новыми, перечисленными выше:', '')
for (const k of categories) for (const old of before.categories[k].items) {
  if (!after.categories[k].items.some(x => x.name === old.name)) lines.push(`- ${before.categories[k].category}: ${old.name} (КФ ${old.coef}; теги ${old.tags.join(', ') || 'нет'}).`)
}
lines.push('', '## Изменённые требования событий', '', '| Событие | Требования до → после (внутри скобок ИЛИ; между группами И) |', '|---|---|')
for (const x of after.events) {
  const old = before.events.find(e => e.id === x.id)
  if (old && JSON.stringify(old.requirements) !== JSON.stringify(x.requirements)) {
    const format = groups => groups.map(g => '(' + g.join(' или ') + ')').join(' и ')
    lines.push(`| ${x.id} | ${format(old.requirements)} → ${format(x.requirements)} |`)
  }
}
const output = path.join(root, 'reports/catalog-balance.md')
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, lines.join('\n') + '\n')
console.log(JSON.stringify({ output, changed, before: b, after: a, coverage: { before: { plain: cb.plain, condition: cb.condition }, after: { plain: ca.plain, condition: ca.condition } } }, null, 2))
