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
  assert.ok(biology.coef >= 0.63 && biology.coef <= 0.65)
})

test('пожилой мужчина с большим стажем не проваливается в чрезмерно низкий КФ', () => {
  const biology = withRandom(
    [0.5, 0.4, 0.84, 0.59],
    () => generateBiology([]),
  )

  assert.equal(biology.sex, 'М')
  assert.equal(biology.age, 75)
  assert.equal(biology.experience, 35)
  assert.equal(biology.infertile, true)
  assert.ok(biology.coef >= 0.57 && biology.coef <= 0.6)
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
