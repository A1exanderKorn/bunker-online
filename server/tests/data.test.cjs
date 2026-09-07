const assert = require('node:assert/strict')
const test = require('node:test')

const { loadCharacteristics, parseSurvivalTags } = require('../dist/server/data.js')
const { loadBunkerData } = require('../dist/server/bunker.js')

test('характеристики не содержат служебные четвёрки', () => {
  const rows = loadCharacteristics()
  assert.equal(rows.some((row) => String(row.name).trim() === '4'), false)
  assert.equal(rows.some((row) => String(row.hint).trim() === '4'), false)
})

test('внутри каждой категории характеристики отсортированы по КФ убыванию', () => {
  const previous = new Map()
  for (const row of loadCharacteristics()) {
    const coef = Number(row.coef)
    if (previous.has(row.category)) {
      assert.ok(coef <= previous.get(row.category), `${row.category}: ${coef} после ${previous.get(row.category)}`)
    }
    previous.set(row.category, coef)
  }
})

test('погранично опасные факты используют light_danger', () => {
  const expected = new Set([
    'Наркодилер',
    'Ограбил своего деда',
    'Сидел на зоне',
    'Имеет непогашенную судимость',
  ])
  const rows = loadCharacteristics().filter((row) => expected.has(row.name))
  assert.equal(rows.length, expected.size)
  for (const row of rows) {
    const tags = parseSurvivalTags(row.tags)
    assert.ok(tags.includes('light_danger'), row.name)
    assert.equal(tags.includes('dangerous'), false, row.name)
  }
})

test('у характеристик с КФ не выше 0.30 нет полезных тегов, кроме компенсирующего criminal', () => {
  const required = new Set(loadBunkerData().challenges.flatMap((challenge) => challenge.requirements.flat()))
  required.delete('criminal')
  const usefulLow = loadCharacteristics().filter((row) =>
    Number(row.coef) <= 0.3 && parseSurvivalTags(row.tags).some((tag) => required.has(tag)),
  )
  assert.deepEqual(usefulLow.map((row) => row.name), [])
})

test('угроза криминальных группировок компенсирует light_danger', () => {
  const challenge = loadBunkerData().challenges.find((item) => item.id === 'threat_041')
  assert.ok(challenge)
  assert.equal(challenge.kind, 'threat')
  assert.deepEqual(challenge.requirements, [['criminal']])
  assert.equal(challenge.successDelta, 2)
  assert.equal(challenge.failureDelta, -6)
})

test('все катастрофы и угрозы явно объясняют способ решения', () => {
  const challenges = loadBunkerData().challenges.filter((item) =>
    item.kind !== 'condition' && item.requirements.length > 0,
  )
  assert.ok(challenges.length > 0)
  assert.deepEqual(
    challenges.filter((item) => !item.text.includes('Для решения')).map((item) => item.id),
    [],
  )
})

test('теги protection и criminal имеют достаточно источников', () => {
  const rows = loadCharacteristics()
  const withTag = (tag) => rows.filter((row) => parseSurvivalTags(row.tags).includes(tag))
  const protection = withTag('protection')
  const criminal = withTag('criminal')

  assert.ok(protection.length >= 7)
  assert.ok(new Set(protection.map((row) => row.category)).size >= 2)
  assert.ok(criminal.length >= 10)
  assert.deepEqual(new Set(criminal.map((row) => row.category)), new Set(['Профессия', 'Хобби', 'Факт']))
  for (const row of criminal) {
    const tags = parseSurvivalTags(row.tags)
    assert.ok(tags.includes('light_danger') || tags.includes('dangerous'), row.name)
  }
})

test('все теги испытаний имеют не менее трёх источников', () => {
  const rows = loadCharacteristics()
  const required = new Set(loadBunkerData().challenges.flatMap((challenge) => challenge.requirements.flat()))
  required.delete('reproductive_edge')
  const sparse = [...required].filter((tag) =>
    rows.filter((row) => parseSurvivalTags(row.tags).includes(tag)).length < 3,
  )
  assert.deepEqual(sparse, [])
})
