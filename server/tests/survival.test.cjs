const assert = require('node:assert/strict')
const test = require('node:test')

const { calculateSurvival } = require('../dist/server/survival.js')
const { loadBunkerData, challengeFlavor } = require('../dist/server/bunker.js')

function survivor(id, name, sex, professionTags, age = 30) {
  return {
    id,
    clientId: `client-${id}`,
    name,
    characteristics: [
      { type: 'Здоровье', value: 'Идеальное здоровье', coef: 1, hint: '', isVisible: true, occ: 0, tags: ['healthy'] },
      { type: 'Профессия', value: 'Тестовая профессия', coef: 0.5, hint: '', isVisible: true, occ: 0, tags: professionTags },
    ],
    biology: { sex, age, experience: 8, coef: 0.8, infertile: false, isVisible: true },
    isAlive: true,
    connected: true,
  }
}

test('базовые потребности не требуют воду, а срок в бункере не меняет шанс', () => {
  const players = [
    survivor('one', 'Первый', 'М', ['food']),
    survivor('two', 'Вторая', 'Ж', []),
  ]
  const bunker = { catastrophe: '', years: 1, threats: [], conditions: [] }
  const shortStay = calculateSurvival(players, bunker)
  const longStay = calculateSurvival(players, { ...bunker, years: 15 })

  assert.equal(shortStay.baseChance, 40)
  assert.equal(shortStay.chance, longStay.chance)
  // Фактора длительности пребывания в модели нет — срок не должен создавать фактор.
  assert.equal(shortStay.factors.some((item) => item.id === 'duration'), false)

  const needs = shortStay.factors.find((item) => item.id === 'needs')
  assert.equal(needs.status, 'Удовлетворены')
  assert.equal(needs.detail, '')
})

// Реальная катастрофа cat_004 «Супервулканы»: 2 группы требований
// [geology|navigation] и [engineering|computing], успех +6 / провал -16.
const SUPERVULCANO = loadBunkerData().challenges.find((item) => item.id === 'cat_004').text

function challengeDelta(report, text) {
  const flavor = challengeFlavor(text)
  const item = report.challenges.find((c) => c.text === flavor)
  assert.ok(item, `challenge не найден: ${flavor}`)
  return item
}

test('катастрофа: полностью закрытые требования дают успех и положительную дельту', () => {
  const players = [
    survivor('g', 'Геолог', 'М', ['geology']),
    survivor('e', 'Инженер', 'Ж', ['engineering']),
  ]
  const bunker = { catastrophe: SUPERVULCANO, years: 1, threats: [], conditions: [] }
  const item = challengeDelta(calculateSurvival(players, bunker), SUPERVULCANO)
  assert.equal(item.success, true)
  assert.equal(item.delta, 6)
})

test('катастрофа: частично закрытые требования дают промежуточную дельту, а не полный провал', () => {
  // Закрыта только 1 из 2 групп (geology есть, engineering|computing нет).
  const players = [
    survivor('g', 'Геолог', 'М', ['geology']),
    survivor('x', 'Пустой', 'Ж', []),
  ]
  const bunker = { catastrophe: SUPERVULCANO, years: 1, threats: [], conditions: [] }
  const item = challengeDelta(calculateSurvival(players, bunker), SUPERVULCANO)
  assert.equal(item.success, false)
  // Максимальный штраф усилен до round(16*1.2)=19, одна из двух групп
  // закрыта: остаётся половина штрафа, округлённая от нуля => -10.
  assert.equal(item.delta, -10)
  // Полностью проваленный вариант должен быть строго хуже частичного.
  const noneClosed = calculateSurvival(
    [survivor('a', 'A', 'М', []), survivor('b', 'B', 'Ж', [])],
    bunker,
  )
  assert.ok(challengeDelta(noneClosed, SUPERVULCANO).delta < item.delta)
  assert.equal(challengeDelta(noneClosed, SUPERVULCANO).delta, -19)
})

test('reproductive_edge выдаётся гермафродиту старше 50, как женщине', () => {
  // threat_004 требует reproductive_edge. Гермафродит 55 лет должен его закрывать.
  const REPRO_THREAT = loadBunkerData().challenges.find((item) => item.id === 'threat_004').text
  const players = [survivor('h', 'Герм', 'Гермафродит', [], 55)]
  const bunker = { catastrophe: '', years: 1, threats: [REPRO_THREAT], conditions: [] }
  const item = challengeDelta(calculateSurvival(players, bunker), REPRO_THREAT)
  assert.equal(item.success, true)
})

test('возрастное и явное бесплодие ухудшают репродуктивный потенциал группы', () => {
  const fertile = [
    survivor('m', 'Мужчина', 'М', [], 35),
    survivor('f', 'Женщина', 'Ж', [], 30),
  ]
  const infertile = [
    survivor('m', 'Мужчина', 'М', [], 61),
    survivor('f', 'Женщина', 'Ж', [], 51),
  ]
  const bunker = { catastrophe: '', years: 1, threats: [], conditions: [] }
  const fertileFactor = calculateSurvival(fertile, bunker).factors.find((item) => item.id === 'sex')
  const infertileFactor = calculateSurvival(infertile, bunker).factors.find((item) => item.id === 'sex')

  assert.equal(fertileFactor.delta, 2)
  assert.equal(infertileFactor.delta, -6)
})

test('низкий коэффициент штрафует фобии, но не багаж и факты', () => {
  const player = survivor('weak', 'Слабый', 'М', [], 30)
  player.characteristics.push({
    type: 'Багаж', value: 'Бесполезный хлам', coef: 0.1, hint: '', isVisible: true, occ: 0,
  })
  player.characteristics.push({
    type: 'Фобия', value: 'Опасная фобия', coef: 0.1, hint: '', isVisible: true, occ: 0,
  })
  const report = calculateSurvival([player], { catastrophe: '', years: 1, threats: [], conditions: [] })
  const traits = report.factors.find((item) => item.id === 'traits')

  assert.equal(traits.delta, -3)
  assert.match(traits.detail, /Опасная фобия/)
  assert.doesNotMatch(traits.detail, /Бесполезный хлам/)
})

test('light_danger даёт −2 пункта за каждую помеченную характеристику', () => {
  const player = survivor('light', 'Рискованный', 'М', ['light_danger'], 30)
  player.characteristics.push({
    type: 'Багаж', value: 'Ещё один риск', coef: 0.5, hint: '', isVisible: true, occ: 0,
    tags: ['light_danger'],
  })
  const danger = calculateSurvival(
    [player],
    { catastrophe: '', years: 1, threats: [], conditions: [] },
  ).factors.find((item) => item.id === 'danger')

  assert.equal(danger.delta, -4)
})

test('одинаковый bunker_assistance_big учитывается один раз на всю команду', () => {
  const players = [
    survivor('one', 'Первый', 'М', ['food', 'bunker_assistance_big']),
    survivor('two', 'Вторая', 'Ж', ['bunker_assistance_big']),
  ]
  const report = calculateSurvival(players, { catastrophe: '', years: 1, threats: [], conditions: [] })
  const assistance = report.factors.find((item) => item.id === 'bunker_assistance')

  assert.equal(assistance.delta, 5)
  assert.equal(report.chance % 1, 0)
})

test('разные bunker_assistance теги складываются до 8 процентных пунктов', () => {
  const players = [
    survivor('one', 'Первый', 'М', ['food', 'bunker_assistance_big']),
    survivor('two', 'Вторая', 'Ж', ['bunker_assistance_small']),
  ]
  const report = calculateSurvival(players, { catastrophe: '', years: 1, threats: [], conditions: [] })
  const assistance = report.factors.find((item) => item.id === 'bunker_assistance')

  assert.equal(assistance.delta, 8)
  assert.equal(report.chance % 1, 0)
})

test('андроид автоматически даёт уникальный bunker_assistance_big', () => {
  const players = [
    survivor('android', 'Андроид', 'Андроид', ['food']),
    survivor('human', 'Человек', 'Ж', []),
  ]
  const report = calculateSurvival(players, { catastrophe: '', years: 1, threats: [], conditions: [] })
  const assistance = report.factors.find((item) => item.id === 'bunker_assistance')

  assert.equal(assistance.delta, 5)
  assert.match(assistance.detail, /Андроид: андроид/)
})

test('leadership не уменьшает штраф danger, но смягчает conflict', () => {
  const bunker = { catastrophe: '', years: 1, threats: [], conditions: [] }
  const dangerWithoutLeader = calculateSurvival(
    [survivor('danger', 'Опасный', 'М', ['dangerous'])],
    bunker,
  ).factors.find((item) => item.id === 'danger')
  const dangerWithLeader = calculateSurvival(
    [
      survivor('danger', 'Опасный', 'М', ['dangerous']),
      survivor('leader', 'Лидер', 'Ж', ['leadership']),
    ],
    bunker,
  ).factors.find((item) => item.id === 'danger')
  const conflictWithoutLeader = calculateSurvival(
    [survivor('conflict', 'Конфликтный', 'М', ['conflict'])],
    bunker,
  ).factors.find((item) => item.id === 'danger')
  const conflictWithLeader = calculateSurvival(
    [
      survivor('conflict', 'Конфликтный', 'М', ['conflict']),
      survivor('leader', 'Лидер', 'Ж', ['leadership']),
    ],
    bunker,
  ).factors.find((item) => item.id === 'danger')

  assert.equal(dangerWithoutLeader.delta, -6)
  assert.equal(dangerWithLeader.delta, -6)
  assert.equal(conflictWithoutLeader.delta, -2)
  assert.equal(conflictWithLeader.delta, -1)
})
