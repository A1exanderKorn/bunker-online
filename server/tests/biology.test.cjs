const assert = require('node:assert/strict')
const test = require('node:test')

const { generateBiology } = require('../dist/server/characteristics.js')

function withRandom(sequence, fn) {
  const original = Math.random
  let index = 0
  Math.random = () => sequence[index++] ?? 0.5
  try {
    return fn()
  } finally {
    Math.random = original
  }
}

test('молодая женщина с малым стажем и бесплодием сохраняет приемлемый КФ', () => {
  const biology = withRandom(
    [0.5, 0.6, 0.02, 0.23, 0.1],
    () => generateBiology([]),
  )

  assert.equal(biology.sex, 'Ж')
  assert.equal(biology.age, 20)
  assert.equal(biology.experience, 1)
  assert.equal(biology.infertile, true)
  assert.ok(biology.coef >= 0.39 && biology.coef <= 0.4)
})

test('женщина старше 50 получает возрастное бесплодие по умолчанию', () => {
  const biology = withRandom(
    [0.5, 0.6, 0.48, 0.5],
    () => generateBiology([]),
  )

  assert.equal(biology.sex, 'Ж')
  assert.equal(biology.age, 51)
  assert.equal(biology.infertile, true)
})
