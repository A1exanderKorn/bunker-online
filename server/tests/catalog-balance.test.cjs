const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { loadCharacteristics, healthVariants } = require('../dist/server/data.js')
const { loadBunkerData } = require('../dist/server/bunker.js')
const labels = require('../data/tag-labels.json')
const rows = loadCharacteristics()
const events = loadBunkerData().challenges
const risk = ['dangerous', 'psychopath', 'maniac', 'suicidal', 'light_danger', 'conflict']
const severe = ['dangerous', 'psychopath', 'maniac', 'suicidal']

test('каталог в сборке совпадает с исходным JSON', () => {
  for (const relative of ['tag-labels.json', ...require('../data/characteristics/index.json').slots.filter(x => x.file).map(x => `characteristics/${x.file}`),
    ...['catastrophes', 'threats', 'conditions'].map(x => `bunker/${x}.json`)]) {
    const read = prefix => JSON.parse(fs.readFileSync(path.join(__dirname, prefix, relative), 'utf8'))
    assert.deepEqual(read('../dist/server/data'), read('../data'), relative)
  }
})

test('все теги каталога известны; КФ конечный и на сетке 0.05', () => {
  for (const x of rows) {
    assert.ok(Number.isFinite(x.coef) && x.coef >= -1 && x.coef <= 1.15, x.name)
    assert.ok(Math.abs(x.coef * 20 - Math.round(x.coef * 20)) < 1e-8, x.name)
    assert.equal(new Set(x.tags).size, x.tags.length, x.name)
    x.tags.forEach(tag => assert.ok(labels[tag], `${x.name}: ${tag}`))
    healthVariants(x).forEach(v => assert.ok(Number.isFinite(v.coef), x.name))
  }
  for (const e of events) for (const tag of [...e.requirements.flat(), ...e.grants]) assert.ok(labels[tag], `${e.id}: ${tag}`)
})

test('хвост описания точно соответствует группам И/ИЛИ и подписям тегов', () => {
  for (const e of events.filter(e => e.requirements.length)) {
    const groups = e.requirements.map(g => g.map(t => labels[t]).join(' или '))
    const suffix = groups.length === 1
      ? `Для решения подойдёт: ${groups[0]}.`
      : `Для решения нужны одновременно: ${groups.map((g,i) => `${i+1}) ${g}`).join('; ')}.`
    assert.ok(e.text.endsWith(suffix), e.id)
    e.requirements.forEach(g => assert.equal(new Set(g).size, g.length, e.id))
  }
})

test('все событийные теги имеют источники в нескольких категориях', () => {
  const required = new Set(events.flatMap(e => e.requirements.flat()))
  required.delete('reproductive_edge') // Generated biology, not a static characteristic.
  for (const tag of required) {
    const sources = rows.filter(x => x.tags.includes(tag))
    assert.ok(sources.length >= (tag === 'nuclear' ? 3 : 6), `${tag}: ${sources.length}`)
    assert.ok(new Set(sources.map(x => x.category)).size >= 2, tag)
  }
  for (const [tag, minimum] of [['protection', 12], ['diplomacy', 8], ['ventilation', 8], ['cold', 8], ['plumbing', 7]]) {
    const sources = rows.filter(x => x.tags.includes(tag))
    assert.ok(sources.length >= minimum, tag)
    assert.ok(new Set(sources.map(x => x.category)).size >= 3, tag)
  }
})

test('сохранены слабые, средние и сильные характеристики в каждой категории', () => {
  for (const category of new Set(rows.map(x => x.category))) {
    const pool = rows.filter(x => x.category === category)
    const bins = [pool.filter(x => x.coef < .35), pool.filter(x => x.coef >= .35 && x.coef < .7), pool.filter(x => x.coef >= .7)]
    for (const bin of bins) assert.ok(bin.length >= Math.floor(pool.length * .1), `${category}: ${bins.map(b => b.length)}`)
  }
})

test('риски сосредоточены на слабых характеристиках, не дублируют тяжёлую и лёгкую опасность', () => {
  const marked = rows.filter(x => x.tags.some(t => risk.includes(t)))
  assert.ok(marked.filter(x => x.coef < .35).length >= marked.length * .9)
  assert.ok(rows.filter(x => x.tags.includes('light_danger')).length >= 20)
  for (const x of marked) {
    assert.ok(x.coef < .7, x.name)
    assert.equal(x.tags.includes('light_danger') && x.tags.some(t => severe.includes(t)), false, x.name)
  }
  for (const x of rows.filter(x => x.category === 'Багаж' && x.coef < .4)) {
    assert.ok(x.tags.includes('light_danger') || x.tags.includes('dangerous'), x.name)
  }
  for (const x of rows.filter(x => x.tags.includes('critical') || x.tags.includes('contagious'))) {
    assert.ok(x.coef < .35, x.name)
  }
})

test('допусловия уникальны, не требуют скрытых навыков и дают небольшие бонусы', () => {
  const conditions = events.filter(x => x.kind === 'condition')
  const normalize = s => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  for (const key of ['id', 'title', 'text']) assert.equal(new Set(conditions.map(x => normalize(x[key]))).size, conditions.length, key)
  for (const x of conditions) {
    assert.equal(x.requirements.length, 0, x.id)
    assert.ok(x.grants.length <= 1, x.id)
    assert.ok(x.successDelta >= 0 && x.successDelta <= 1, x.id)
    assert.equal(x.failureDelta, 0, x.id)
    assert.ok(x.grants.length || x.successDelta > 0, x.id)
  }
  const threats = events.filter(x => x.kind === 'threat')
  assert.equal(new Set(threats.map(x => normalize(x.text))).size, threats.length)
})

test('ресурсы не приобретают несвязанные навыки, прошлое заключение не означает насилия', () => {
  const checks = [['Плавание', 'water'], ['Компьютерные игры', 'computing'], ['Радиоинженер', 'nuclear'],
    ['Коробок спичек', 'fire'], ['Красный диплом', 'repair'], ['Отличный иммунитет', 'infectious']]
  for (const [name, tag] of checks) {
    const x = rows.find(x => x.name === name)
    assert.ok(x, name)
    assert.equal(x.tags.includes(tag), false, name)
  }
  for (const name of ['Сидел на зоне', 'Имеет непогашенную судимость', 'Преследуют суицидальные мысли']) {
    const x = rows.find(x => x.name === name)
    assert.ok(x, name)
    assert.equal(x.tags.some(t => risk.includes(t)), false, name)
  }
})

test('подсказки краткие, фобии поясняются отдельно от названия', () => {
  for (const row of rows) {
    assert.equal(row.name, row.name.trim())
    assert.doesNotMatch(row.name, /\s{2,}/)
    assert.doesNotMatch(row.hint, /не даёт|в игре даёт|автоматического штрафа|не заменяет|Для игровой карты/)
    if (row.category === 'Фобия') {
      assert.doesNotMatch(row.name, /[()]/)
      if (row.name !== 'Нет фобии') assert.ok(row.hint.trim())
    }
    if (!['Фобия', 'Здоровье'].includes(row.category))
      assert.ok(!row.hint || ['ОСУЖДАЮ', 'резня'].includes(row.hint), row.name)
  }
  assert.ok(rows.some(r => r.name === 'Оператор очистных сооружений'))
  assert.ok(rows.some(r => r.name === 'Работал на очистных сооружениях'))
  assert.ok(rows.some(r => r.name === 'Электронная книга с библиотекой из 10 000 книг'))
})
