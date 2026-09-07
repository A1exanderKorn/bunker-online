const assert = require('node:assert/strict')
const test = require('node:test')

const {
  characteristicWeight,
  drawUniqueCharacteristics,
  targetCandidateWeight,
} = require('../dist/server/characteristics.js')

test('профессия имеет вес 0.8 в общем коэффициенте', () => {
  assert.equal(characteristicWeight('Профессия'), 0.8)
})

test('вес неизвестной категории равен 1', () => {
  assert.equal(characteristicWeight('НетТакойКатегории'), 1)
})

test('притяжение к целевому КФ стало плотнее предыдущей кривой', () => {
  const previousWeightAtHalfPoint = 0.15 + 0.85 / (1 + 4 * 0.5)

  assert.equal(targetCandidateWeight(0), 1)
  assert.ok(targetCandidateWeight(0.5) < previousWeightAtHalfPoint)
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
