const assert = require('node:assert/strict')
const test = require('node:test')

const {
  biologyAgeProbability,
  experienceModifier,
  generateBiology,
} = require('../dist/server/characteristics.js')

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

function randomForAge(age) {
  let cumulative = 0
  for (let current = 19; current < age; current += 1) {
    cumulative += biologyAgeProbability(current)
  }
  return cumulative + biologyAgeProbability(age) / 2
}

test('модификатор стажа линейно растёт от −0.02 до +0.06', () => {
  assert.equal(experienceModifier(30, 1), -0.02)
  assert.ok(Math.abs(experienceModifier(30, 14) - 0.06) < 1e-12)
  assert.ok(Math.abs(experienceModifier(30, 7.5) - 0.02) < 1e-12)
})

test('вероятность возраста плавно уменьшается от 19 до 90 лет', () => {
  assert.ok(biologyAgeProbability(19) > biologyAgeProbability(50))
  assert.ok(biologyAgeProbability(50) > biologyAgeProbability(90))
  const total = Array.from({ length: 72 }, (_, index) => 19 + index)
    .reduce((sum, age) => sum + biologyAgeProbability(age), 0)
  assert.ok(Math.abs(total - 1) < 1e-12)
})

test('шанс андроида заканчивается на отметке 4% с учётом гермафродита', () => {
  const android = withRandom([0.0399, 0.5, 0.5], () => generateBiology([]))
  const ordinary = withRandom(
    [0.0401, 0.4, randomForAge(30), 0.5, 0.5],
    () => generateBiology([]),
  )

  assert.equal(android.sex, 'Андроид')
  assert.equal(ordinary.sex, 'М')
})

test('случайное бесплодие срабатывает только в нижних 10% ролла', () => {
  const infertile = withRandom(
    [0.5, 0.6, randomForAge(30), 0.5, 0.099],
    () => generateBiology([]),
  )
  const fertile = withRandom(
    [0.5, 0.6, randomForAge(30), 0.5, 0.1],
    () => generateBiology([]),
  )

  assert.equal(infertile.infertile, true)
  assert.equal(fertile.infertile, false)
})

test('молодая женщина с малым стажем и бесплодием сохраняет приемлемый КФ', () => {
  const biology = withRandom(
    [0.5, 0.6, randomForAge(20), 0.23, 0.09],
    () => generateBiology([]),
  )

  assert.equal(biology.sex, 'Ж')
  assert.equal(biology.age, 20)
  assert.equal(biology.experience, 1)
  assert.equal(biology.infertile, true)
  assert.ok(biology.coef >= 0.57 && biology.coef <= 0.59)
})

test('пожилой мужчина с большим стажем не проваливается в чрезмерно низкий КФ', () => {
  const biology = withRandom(
    [0.5, 0.4, randomForAge(75), 0.59],
    () => generateBiology([]),
  )

  assert.equal(biology.sex, 'М')
  assert.equal(biology.age, 75)
  assert.equal(biology.experience, 35)
  assert.equal(biology.infertile, true)
  assert.ok(biology.coef >= 0.54 && biology.coef <= 0.57)
})

test('женщина старше 50 получает возрастное бесплодие по умолчанию', () => {
  const biology = withRandom(
    [0.5, 0.6, randomForAge(51), 0.5],
    () => generateBiology([]),
  )

  assert.equal(biology.sex, 'Ж')
  assert.equal(biology.age, 51)
  assert.equal(biology.infertile, true)
})
