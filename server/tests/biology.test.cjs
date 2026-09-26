const assert = require('node:assert/strict')
const test = require('node:test')
const { biologyCoefficient, biologyAgeProbability, experienceModifier, generateBiology,
  generateOrdinaryBiology, generateRareBiology } = require('../dist/server/biology.js')
const { dealCharacteristics } = require('../dist/server/characteristics.js')
function rng(seed = 12345) {
  return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
}
const bio = (age, infertile = false, experience = 1) => ({ age, infertile, experience, sex: 'М' })
test('стаж даёт только −0.01…+0.01 и растёт линейно', () => {
  assert.equal(experienceModifier(30, 1), -.01)
  assert.equal(experienceModifier(30, 14), .01)
  assert.equal(experienceModifier(30, 7.5), 0)
})
test('35 лет — пик, молодость без бесплодия не уходит в минус', () => {
  for (let age = 19; age < 35; age++) {
    assert.ok(biologyCoefficient(bio(age)) >= 0)
    assert.ok(biologyCoefficient(bio(age)) < biologyCoefficient(bio(age + 1)))
  }
  for (let age = 36; age <= 80; age++)
    assert.ok(biologyCoefficient(bio(age)) < biologyCoefficient(bio(age - 1)))
  assert.equal(biologyCoefficient(bio(35, false, 19)), 1)
})
test('бесплодие штрафует молодость, старость приближается к −1', () => {
  assert.ok(biologyCoefficient(bio(19, true)) < 0)
  assert.ok(biologyCoefficient(bio(59)) < 0)
  assert.equal(biologyCoefficient(bio(80, true)), -1)
  assert.equal(biologyCoefficient(bio(90, true)), -1)
  assert.ok(Math.abs(biologyCoefficient(bio(30)) - biologyCoefficient(bio(30, true)) - .3) < 1e-9)
})
test('возрастной вес плавно снижается и нормирован', () => {
  let sum = 0
  for (let age = 19; age <= 90; age++) {
    sum += biologyAgeProbability(age)
    if (age < 90) assert.ok(biologyAgeProbability(age) > biologyAgeProbability(age + 1))
  }
  assert.ok(Math.abs(sum - 1) < 1e-12)
})
test('целевой КФ выбирает реальную биологию в пределах ±0.3, не переписывая формулу', () => {
  const random = rng()
  for (const target of [-1, -.8, -.5, 0, .3, .5, .8, 1]) {
    const samples = Array.from({ length: 150 }, () => generateOrdinaryBiology(target, random))
    for (const sample of samples) {
      assert.equal(sample.coef, biologyCoefficient(sample))
      assert.ok(Math.abs(sample.coef - target) <= .300001, JSON.stringify({ target, sample }))
      assert.ok(sample.experience <= sample.age - 16)
      if (sample.age > (sample.sex === 'М' ? 60 : 50)) assert.equal(sample.infertile, true)
    }
    assert.ok(new Set(samples.map(x => x.age)).size > 3)
  }
})
test('без целевого КФ случайное бесплодие около 10% у нестарых персонажей', () => {
  const random = rng(12)
  let young = 0, infertile = 0
  for (let i = 0; i < 10000; i++) {
    const b = generateOrdinaryBiology(null, random)
    assert.equal(b.coef, biologyCoefficient(b))
    if (b.age <= (b.sex === 'М' ? 60 : 50)) { young++; infertile += Number(b.infertile) }
    else assert.equal(b.infertile, true)
  }
  assert.ok(infertile / young > .085 && infertile / young < .115)
})
test('редкие типы: гермафродит 1%, андроид 1.5%, уникальность без переноса шанса', () => {
  const random = rng()
  const counts = {}
  for (let i = 0; i < 20000; i++) {
    const b = generateRareBiology([], random, .5)
    if (b) {
      counts[b.sex] = (counts[b.sex] ?? 0) + 1
      assert.equal(b.coef, biologyCoefficient(b))
    }
  }
  assert.ok(counts['Гермафродит'] > 150 && counts['Гермафродит'] < 260)
  assert.ok(counts['Андроид'] > 240 && counts['Андроид'] < 365)
  assert.equal(generateRareBiology([{ sex: 'Гермафродит' }], () => .005), null)
  assert.equal(generateRareBiology([{ sex: 'Андроид' }], () => .015), null)
  assert.equal(generateRareBiology([], () => .045), null)
})
test('оба алгоритма сохраняют КФ по формуле в реальных раздачах на 16 игроков', () => {
  const original = Math.random
  Math.random = rng(101)
  try {
    for (const mode of ['classic', 'new']) for (const target of [.5, .65, .75]) {
      const players = Array.from({ length: 16 }, (_, i) => ({
        id: String(i), clientId: String(i), name: String(i),
        characteristics: [], biology: null, isAlive: true, connected: true,
      }))
      dealCharacteristics(players, { targetCoef: target, gameMode: mode })
      for (const p of players) {
        assert.equal(p.characteristics.length, 6)
        assert.equal(p.biology.coef, biologyCoefficient(p.biology))
      }
      for (const sex of ['Андроид', 'Гермафродит', 'транс', 'оно/мы'])
        assert.ok(players.filter(p => p.biology.sex === sex).length <= 1)
    }
  } finally { Math.random = original }
})

test('новые редкие варианты имеют по 1% диапазона ролла и КФ от −1 до 0', () => {
  for (const [sex, roll] of [['транс', .03], ['оно/мы', .04]]) {
    const random = rng(42)
    for (let i = 0; i < 200; i++) {
      let first = true
      const b = generateRareBiology([], () => { if (first) { first = false; return roll }; return random() }, .9)
      assert.equal(b.sex, sex)
      assert.equal(b.coef, biologyCoefficient(b))
      assert.ok(b.coef >= -1 && b.coef <= 0)
    }
    assert.equal(generateRareBiology([{ sex }], () => roll), null)
    assert.equal(biologyCoefficient({ ...bio(35, false, 19), sex }), 0)
    assert.equal(biologyCoefficient({ ...bio(90), sex }), -1)
    assert.ok(biologyCoefficient({ ...bio(60), sex }) < biologyCoefficient({ ...bio(35), sex }))
  }
})
