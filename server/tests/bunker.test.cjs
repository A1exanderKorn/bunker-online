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
