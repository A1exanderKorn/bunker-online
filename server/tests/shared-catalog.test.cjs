const assert = require('node:assert/strict')
const test = require('node:test')
const { loadCharacteristics, expandForDeal, characteristicWeight } = require('../dist/server/data.js')
const { dealCharacteristics, drawUniqueCharacteristics } = require('../dist/server/characteristics.js')
const { loadBunkerData, toPublicBunker } = require('../dist/server/bunker.js')
const { calculateSurvival } = require('../dist/server/survival.js')
const { averageCoef } = require('../dist/server/cards.js')

test('обе раздачи выдают полный уникальный набор из общего каталога, включая стадии', () => {
  const originalRandom = Math.random
  let seed = 123456789
  Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  try {
    const catalog = loadCharacteristics()
    let stagedCount = 0
    for (const gameMode of ['classic', 'new']) {
      for (const options of [{}, { extraBaggage: true }, { noPhobias: true }]) {
        const players = Array.from({ length: 16 }, (_, i) => ({
          id: String(i), clientId: String(i), name: `Игрок ${i}`,
          characteristics: [], biology: null, isAlive: true, connected: true,
        }))
        dealCharacteristics(players, { gameMode, targetCoef: 0.5, ...options })
        const values = players.flatMap((p) => p.characteristics.map((c) => c.value))
        assert.equal(new Set(values).size, values.length)
        for (const player of players) {
          assert.ok(player.biology)
          assert.equal(player.characteristics.length, options.extraBaggage ? 7 : options.noPhobias ? 5 : 6)
          for (const char of player.characteristics) {
            const row = catalog.find((r) => r.category === char.type && r.name === char.value)
            assert.ok(row, char.value)
            assert.deepEqual(char.tags, row.tags)
            const variant = expandForDeal(row).find((v) => v.coef === char.coef && (v.stageIndex ?? undefined) === char.stageIndex)
            assert.ok(variant, `${gameMode}: ${char.value}`)
            assert.equal(char.stageLabel, variant.stageLabel || undefined)
            if (row.staged) stagedCount++
          }
        }
      }
    }
    assert.ok(stagedCount > 0)
  } finally {
    Math.random = originalRandom
  }
})

test('массовая перераздача здоровья сохраняет стадии заболеваний', () => {
  const rows = loadCharacteristics().filter((r) => r.category === 'Здоровье')
  for (const mode of ['classic', 'new']) {
    const dealt = drawUniqueCharacteristics('Здоровье', rows.length, [], mode)
    // Повторы «Идеально здоров» увеличивают вес при раздаче, но не число уникальных карт.
    assert.equal(dealt.length, new Set(rows.map((r) => r.name)).size)
    for (const char of dealt) {
      const row = rows.find((r) => r.name === char.value)
      if (!row.staged) continue
      assert.ok(expandForDeal(row).some((v) => v.coef === char.coef && v.stageLabel === char.stageLabel))
      assert.equal(!!char.incurable, char.stageIndex === 2)
    }
  }
})

test('режим не меняет веса, публичные события, КФ активных карт и итог одинаковой команды', () => {
  const data = loadBunkerData()
  const rows = loadCharacteristics()
  const players = [{ id: 'a', clientId: 'a', name: 'A', isAlive: true, connected: true,
    biology: { sex: 'М', age: 30, experience: 10, coef: 0.8, infertile: false, isVisible: true },
    characteristics: rows.filter((r) => r.coef > 0.5).slice(0, 8).map((r) => ({
      type: r.category, value: r.name, coef: r.coef, tags: r.tags, hint: r.hint, occ: 0, isVisible: true,
    })),
  }]
  for (const category of new Set(rows.map((r) => r.category))) {
    assert.equal(characteristicWeight(category, 'classic'), characteristicWeight(category, 'new'))
  }
  assert.equal(averageCoef(players[0], 'classic'), averageCoef(players[0], 'new'))
  const bunker = { catastrophe: data.catastrophes[0], years: 3, threats: data.threats,
    conditions: data.conditions.map((text) => ({ text, byPlayerId: 'a', byName: 'A' })),
  }
  assert.deepEqual(toPublicBunker(bunker, 'classic'), toPublicBunker(bunker, 'new'))
  assert.deepEqual(calculateSurvival(players, bunker, 'classic'), calculateSurvival(players, bunker, 'new'))
})
