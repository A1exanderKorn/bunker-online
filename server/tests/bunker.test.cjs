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
