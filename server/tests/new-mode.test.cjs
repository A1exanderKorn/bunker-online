const assert = require('node:assert/strict')
const test = require('node:test')

const { loadCharacteristics, characteristicWeight, roundCoef } = require('../dist/server/data.js')
const { loadBunkerData } = require('../dist/server/bunker.js')
const { labelTag } = require('../dist/server/tagLabels.js')
const { dealCharacteristics } = require('../dist/server/characteristics.js')
const { sampleWShape, generateRareBiology, slotMinMax } = require('../dist/server/dealNew.js')

test('новый режим: все записи актуального каталога загружаются', () => {
  const count = (category) => loadCharacteristics('new').filter((row) => row.category === category).length
  for (const slot of require('../data/characteristics/index.json').slots.filter(s=>s.file)) {
    const source = require('../data/characteristics/'+slot.file)
    assert.ok(source.items.length >= 100, slot.category)
    assert.equal(count(slot.category), source.items.length, slot.category)
  }
})

test('режимы используют одинаковые характеристики и события', () => {
  assert.deepEqual(loadCharacteristics('classic'), loadCharacteristics('new'))
  assert.deepEqual(loadBunkerData('classic'), loadBunkerData('new'))
  assert.equal(loadCharacteristics('classic').filter((row) => row.category === 'Профессия').length, require('../data/characteristics/profession.json').items.length)
  assert.equal(loadBunkerData('classic').challenges.find((item) => item.id === 'cat_005').requirements[2][0], 'ppe')
})

test('общие веса: хобби 0.65, фобия 0.4', () => {
  assert.equal(characteristicWeight('Хобби', 'new'), 0.65)
  assert.equal(characteristicWeight('Фобия', 'new'), 0.4)
  assert.equal(characteristicWeight('Хобби', 'classic'), 0.65)
  assert.equal(characteristicWeight('Фобия', 'classic'), 0.4)
})

test('новые теги и правки бункера', () => {
  assert.equal(labelTag('ppe', 'new'), 'СИЗ и санитарная защита')
  assert.equal(labelTag('protection', 'new'), 'физическая защита')
  const data = loadBunkerData('new')
  for (const category of ['catastrophes','threats','conditions'])
    assert.equal(data[category].length, require('../data/bunker/'+category+'.json').items.length, category)
  assert.deepEqual(data.challenges.find((item) => item.id === 'cat_005').requirements[2], ['ppe'])
  assert.deepEqual(data.challenges.find((item) => item.id === 'threat_031').requirements[1], ['ppe'])
  assert.ok(data.challenges.find((item) => item.id === 'cat_020'))
  assert.ok(data.challenges.find((item) => item.id === 'threat_070'))
})

test('онкология стадийная, ремиссия нет', () => {
  const health = loadCharacteristics('new').filter((row) => row.category === 'Здоровье')
  const onco = health.find((row) => row.name === 'Онкология')
  const rem = health.find((row) => row.name === 'Ремиссия онкологии')
  assert.equal(onco.staged, true)
  assert.equal(onco.stages.length, 3)
  assert.equal(rem.staged, false)
  assert.equal(health.some((row) => row.name === 'Рак легких'), false)
})

test('округление КФ шагом 0.05', () => {
  assert.equal(roundCoef(0.12), 0.1)
  assert.equal(roundCoef(-0.17), -0.15)
})

test('раздача нового режима заполняет слоты', () => {
  const players = [
    { id: 'a', clientId: 'a', name: 'A', characteristics: [], biology: null, isAlive: true, connected: true },
    { id: 'b', clientId: 'b', name: 'B', characteristics: [], biology: null, isAlive: true, connected: true },
  ]
  dealCharacteristics(players, { targetCoef: 0.5, gameMode: 'new' })
  for (const player of players) {
    assert.ok(player.biology)
    assert.equal(player.characteristics.length, 6)
    const names = player.characteristics.map((item) => item.value)
    assert.equal(new Set(names).size, names.length)
  }
  const all = players.flatMap((player) => player.characteristics.map((item) => item.value))
  assert.equal(new Set(all).size, all.length)
})

test('W-форма возвращает значение внутри отрезка', () => {
  for (let i = 0; i < 40; i += 1) {
    const x = sampleWShape(-0.4, 0.8)
    assert.ok(x >= -0.4 && x <= 0.8)
  }
})

test('редкая биология нового режима: гермафродит 1%', () => {
  const original = Math.random
  let n = 0
  const seq = [0.009, 0.4, 0.4, 0.5]
  Math.random = () => seq[n++] ?? 0.5
  try {
    const bio = generateRareBiology([])
    assert.equal(bio.sex, 'Гермафродит')
    assert.equal(bio.coef, require('../dist/server/biology.js').biologyCoefficient(bio))
  } finally {
    Math.random = original
  }
})

test('все слоты нового режима используют диапазон от -1 до 1', () => {
  for (const category of ['Профессия','Хобби','Багаж','Факт','Здоровье','Фобия','Биология'])
    assert.deepEqual(slotMinMax(category), {min:-1,max:1}, category)
})

test('в новом режиме нет карты Спортивное сердце', () => {
  const health = loadCharacteristics('new').filter((row) => row.category === 'Здоровье')
  assert.equal(health.some((row) => row.name === 'Спортивное сердце'), false)
})

test('обычный М/Ж в новом режиме не младше 19, андроид не младше 18', () => {
  const players = Array.from({ length: 16 }, (_, i) => ({
    id: String(i),
    clientId: String(i),
    name: `P${i}`,
    characteristics: [],
    biology: null,
    isAlive: true,
    connected: true,
  }))
  dealCharacteristics(players, { targetCoef: 0.5, gameMode: 'new' })
  for (const player of players) {
    assert.ok(player.biology)
    if (player.biology.sex === 'Андроид') {
      assert.ok(player.biology.age >= 18)
    } else {
      assert.ok(player.biology.age >= 19)
    }
  }
})

test('андроид нового режима: возраст 18…37', () => {
  const original = Math.random
  let n = 0
  Math.random = () => [0.015, 0][n++] ?? 0.5
  try {
    const bio = generateRareBiology([])
    assert.equal(bio.sex, 'Андроид')
    assert.equal(bio.age, 18)
  } finally {
    Math.random = original
  }
})
