const assert = require('node:assert/strict')
const test = require('node:test')

const { calculateSurvival } = require('../dist/server/survival.js')

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

  assert.equal(shortStay.baseChance, 50)
  assert.equal(shortStay.chance, longStay.chance)
  // Фактора длительности пребывания в модели нет — срок не должен создавать фактор.
  assert.equal(shortStay.factors.some((item) => item.id === 'duration'), false)

  const needs = shortStay.factors.find((item) => item.id === 'needs')
  assert.equal(needs.status, 'Удовлетворены')
  assert.equal(needs.detail, '')
})

// Реальная катастрофа cat_004 «Супервулканы»: 2 группы требований
// [geology|navigation] и [engineering|computing], успех +6 / провал -16.
const SUPERVULCANO =
  'Супервулканы: Активизируются супервулканы, производящие чрезвычайно мощные извержения. Ландшафт и климат резко меняются. Большинство населения сразу погибает от скачков температур, замлетрясений и наводнений. После выхода из бункера вас ждет глобальная засуха, разрушенные города и постоянная сейсмическая активность. Вы можете выжить, только разработав сверхчувствительную систему предсказания землетрясений и роботизированную инфраструктуру.'

function challengeDelta(report, text) {
  const item = report.challenges.find((c) => c.text === text)
  assert.ok(item, `challenge не найден: ${text}`)
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
  // failure=-16, success=+6, ratio=0.5 => round(-16 + 22*0.5) = -5
  assert.equal(item.delta, -5)
  // Полностью проваленный вариант должен быть строго хуже частичного.
  const noneClosed = calculateSurvival(
    [survivor('a', 'A', 'М', []), survivor('b', 'B', 'Ж', [])],
    bunker,
  )
  assert.ok(challengeDelta(noneClosed, SUPERVULCANO).delta < item.delta)
  assert.equal(challengeDelta(noneClosed, SUPERVULCANO).delta, -16)
})

test('reproductive_edge выдаётся гермафродиту старше 50, как женщине', () => {
  // threat_004 требует reproductive_edge. Гермафродит 55 лет должен его закрывать.
  const REPRO_THREAT =
    'Алгоритмы сканера на входе в бункер из-за катастрофы  дали сбой. Чтобы вас пропустили внутрь, среди вас должен быть хотя бы один человек с бесплодием(или Ж страше 50/М старше 60)'
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

test('откровенно слабые характеристики дают отдельный штраф', () => {
  const player = survivor('weak', 'Слабый', 'М', [], 30)
  player.characteristics.push({
    type: 'Багаж', value: 'Бесполезный хлам', coef: 0.1, hint: '', isVisible: true, occ: 0,
  })
  const report = calculateSurvival([player], { catastrophe: '', years: 1, threats: [], conditions: [] })
  const traits = report.factors.find((item) => item.id === 'traits')

  assert.equal(traits.delta, -3)
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
