const assert = require('node:assert/strict')
const test = require('node:test')

const { loadBunkerData, pickUnusedCondition, threatQueue } = require('../dist/server/bunker.js')

test('очередь угроз не содержит дублей даже при запросе больше размера колоды', () => {
  const data = loadBunkerData()
  const queue = threatQueue(data.threats.length + 10)

  assert.equal(queue.length, new Set(data.threats).size)
  assert.equal(new Set(queue).size, queue.length)
})

test('дополнительные условия выбираются без повторов до исчерпания колоды', () => {
  const data = loadBunkerData()
  const opened = []

  for (let index = 0; index < new Set(data.conditions).size; index += 1) {
    const condition = pickUnusedCondition(opened)
    assert.ok(condition)
    assert.equal(opened.includes(condition), false)
    opened.push(condition)
  }

  assert.equal(pickUnusedCondition(opened), undefined)
  assert.equal(new Set(opened).size, opened.length)
})

test('катастрофы, угрозы и условия парсятся независимо от порядка строк', () => {
  const data = loadBunkerData()
  assert.ok(data.catastrophes.length >= 10)
  assert.ok(data.threats.length >= 30)
  assert.ok(data.conditions.length >= 8)
  assert.equal(data.challenges.length, data.catastrophes.length + data.threats.length + data.conditions.length)
  assert.equal(new Set(data.challenges.map((item) => item.id)).size, data.challenges.length)
  for (const challenge of data.challenges) {
    assert.ok(challenge.text)
    assert.ok(challenge.title)
    assert.ok(['catastrophe', 'threat', 'condition'].includes(challenge.kind))
    assert.ok(challenge.requirements.every((group) => group.length > 0))
  }
  for (const catastrophe of data.challenges.filter((item) => item.kind === 'catastrophe')) {
    assert.ok(catastrophe.title.length <= 40)
    assert.equal(catastrophe.title.includes(':'), false)
  }
})

test('лист данных отсортирован: катастрофы, затем угрозы и доп. условия', () => {
  const rank = { catastrophe: 0, threat: 1, condition: 2 }
  const kinds = loadBunkerData().challenges.map((challenge) => rank[challenge.kind])
  assert.equal(kinds.some((value, index) => index > 0 && value < kinds[index - 1]), false)
})

const {
  challengeFlavor,
  toPublicBunker,
} = require('../dist/server/bunker.js')
const { labelTag } = require('../dist/server/tagLabels.js')
const { requirementsView, grantsView } = require('../dist/shared/bunkerDisplay.js')

test('подписи тегов читаются из tag-labels.json', () => {
  assert.equal(labelTag('agriculture'), 'сельское хозяйство')
  assert.equal(labelTag('нет_такого_тега'), 'нет_такого_тега')
})

test('challengeFlavor отрезает хвост механики', () => {
  const cat002 = loadBunkerData().challenges.find((item) => item.id === 'cat_002')
  const cat007 = loadBunkerData().challenges.find((item) => item.id === 'cat_007')
  const lucky = loadBunkerData().challenges.find((item) => item.id === 'threat_009')
  const condition = loadBunkerData().challenges.find((item) => item.id === 'condition_25')

  assert.ok(cat002.text.includes('Для решения'))
  assert.equal(challengeFlavor(cat002.text).includes('Для решения'), false)
  assert.ok(challengeFlavor(cat002.text).startsWith('Ядерная война:'))

  assert.ok(cat007.text.includes('вируса Для решения'))
  assert.equal(challengeFlavor(cat007.text).includes('Для решения'), false)
  assert.ok(challengeFlavor(cat007.text).includes('зомби'))

  assert.equal(challengeFlavor(lucky.text), lucky.text)
  assert.equal(challengeFlavor(condition.text), condition.text)
})

test('форматтер requirements покрывает пустой, один тег, ИЛИ и И', () => {
  assert.deepEqual(requirementsView([]), { kind: 'none', heading: 'Особые навыки не нужны.' })
  assert.equal(requirementsView([['медицина']]).kind, 'single')
  assert.equal(requirementsView([['пища', 'сельское хозяйство']]).kind, 'or')
  const andView = requirementsView([['энергия'], ['пища', 'сельское хозяйство']])
  assert.equal(andView.kind, 'and')
  assert.equal(andView.items[0].kind, 'tag')
  assert.equal(andView.items[1].kind, 'or')
})

test('форматтер grants сохраняет порядок и пустой грант', () => {
  assert.deepEqual(grantsView([]), { kind: 'empty', heading: 'Ничего не даёт.' })
  assert.deepEqual(grantsView(['химия', 'наука']), {
    kind: 'list',
    heading: 'Приобретено:',
    labels: ['химия', 'наука'],
  })
})

test('публичный бункер не содержит хвост Для решения', () => {
  const cat002 = loadBunkerData().challenges.find((item) => item.id === 'cat_002').text
  const publicBunker = toPublicBunker({
    catastrophe: cat002,
    years: 7,
    threats: [loadBunkerData().challenges.find((item) => item.id === 'threat_001').text],
    conditions: [],
  })
  const dump = JSON.stringify(publicBunker)
  assert.equal(dump.includes('Для решения'), false)
  assert.equal(publicBunker.catastrophe.requirements[0].includes('радиация'), true)
  assert.equal(publicBunker.threats[0].requirements[0].includes('пища'), true)
})

