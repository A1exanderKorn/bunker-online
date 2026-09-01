const assert = require('node:assert/strict')
const test = require('node:test')

const {
  characteristicWeight,
  drawUniqueCharacteristics,
} = require('../dist/server/characteristics.js')

test('профессия имеет вес 0.8 в общем коэффициенте', () => {
  assert.equal(characteristicWeight('Профессия'), 0.8)
})

test('массовая перераздача профессий вытаскивает значения без повторов', () => {
  const professions = drawUniqueCharacteristics('Профессия', 20)
  const values = professions.map((profession) => profession.value)

  assert.equal(professions.length, 20)
  assert.equal(new Set(values).size, values.length)
})

test('массовая перераздача учитывает значения, исключённые из пула', () => {
  const first = drawUniqueCharacteristics('Профессия', 1)[0]
  assert.ok(first)

  const next = drawUniqueCharacteristics('Профессия', 20, [first.value])
  assert.equal(next.some((profession) => profession.value === first.value), false)
})
