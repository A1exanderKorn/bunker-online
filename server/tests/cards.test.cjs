const assert = require('node:assert/strict')
const test = require('node:test')

const { loadCards, pickSpecsFor, rollCategory } = require('../dist/server/cards.js')
const { Lobby } = require('../dist/server/lobby.js')

function def(category, weight) {
  return {
    cardId: category,
    category,
    title: category,
    code: category,
    action: '',
    target: '',
    scope: '',
    picks: 0,
    stage: 'any',
    unique: false,
    note: '',
    probs: Array(7).fill(weight),
  }
}

test('интервалы категорий расположены A -> B -> D -> C', () => {
  const defs = [def('C', 1), def('D', 1), def('B', 1), def('A', 1)]
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.00), 'A')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.26), 'B')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.51), 'D')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.76), 'C')
})

test('один бросок выбирает накопленный интервал, включая точные границы', () => {
  const defs = [def('S', .15), def('A', .25), def('B', .2), def('D', .1), def('C', .3)]
  for (const [roll, expected] of [[0,'S'], [.149999,'S'], [.15,'A'], [.399999,'A'], [.4,'B'], [.599999,'B'], [.600001,'D'], [.699999,'D'], [.700001,'C'], [.999999,'C']]) {
    let calls = 0
    assert.equal(rollCategory(defs, .5, 'balanced', () => { calls++; return roll }), expected)
    assert.equal(calls, 1, 'ровно один бросок на выбор категории')
  }
  const counts = { S:0, A:0, B:0, D:0, C:0 }
  for (let i = 0; i < 10000; i++) counts[rollCategory(defs, .5, 'balanced', () => (i + .5) / 10000)]++
  assert.deepEqual(counts, { S:1500, A:2500, B:2000, D:1000, C:3000 })
})

test('недоступная S перераспределяет интервалы, нулевые веса не выпадают', () => {
  const defs = [def('A', .25), def('B', .75), def('C', 0)]
  assert.equal(rollCategory(defs, .5, 'balanced', () => .249999), 'A')
  assert.equal(rollCategory(defs, .5, 'balanced', () => .25), 'B')
  assert.equal(rollCategory(defs, .5, 'balanced', () => .999999), 'B')
  assert.equal(rollCategory([def('A', 2), def('B', 3)], .5, 'balanced', () => .4), 'B')
})

test('категория S сильнее A и участвует в ролле на общих основаниях', () => {
  const defs = [def('C', 1), def('A', 1), def('S', 1), def('D', 1), def('B', 1)]
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0), 'S')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.21), 'A')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.41), 'B')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.61), 'D')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.81), 'C')
})

test('пустая категория S отсутствует в ролле, нулевой вес не даёт ей выпадать', () => {
  const defs = [def('A', 1), def('B', 1)]
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0), 'A')
  assert.equal(rollCategory([...defs, def('S', 0)], 0.5, 'balanced', () => 0), 'A')
})

test('веса карт берутся из единого файла, в каждой корзине есть доступные карты', () => {
  const configured = require('../data/action-card-probabilities.json')
  const firstByCategory = new Map()
  for (const card of loadCards()) {
    assert.deepEqual(card.probs, configured[card.category])
    if (!firstByCategory.has(card.category)) firstByCategory.set(card.category, card)
  }

  for (let bucket = 0; bucket < 7; bucket++) {
    const total = [...firstByCategory.values()]
      .reduce((sum, card) => sum + card.probs[bucket], 0)
    assert.ok(Number.isFinite(total) && total > 0, `корзина ${bucket}: сумма ${total}`)
  }

})

test('все активные карты имеют поддерживаемое действие и корректные шаги выбора', () => {
  const supported = new Set([
    'change', 'swap', 'healFertile', 'replayLast', 'changeCatastrophe', 'revealCondition',
    'removeThreat', 'cancelVotes', 'doubleVote', 'selfProtection', 'selfDefence', 'revote',
    'randomReveal', 'addMatchingThreat', 'shuffleRevealed', 'rerollAll', 'rejuvenate', 'biasedReroll', 'makeInfertile',
  ])
  for (const card of loadCards()) {
    assert.ok(supported.has(card.action), `${card.cardId}: неизвестное действие ${card.action}`)
    assert.ok(['reveal', 'vote', 'any'].includes(card.stage), `${card.cardId}: неверный этап`)
    const specs = pickSpecsFor(card)
    if (['swap', 'removeThreat', 'cancelVotes', 'selfProtection', 'healFertile'].includes(card.action)) {
      assert.ok(specs.length > 0, `${card.cardId}: отсутствует выбор цели`)
    }
  }
})

function harness() {
  const emitted = []
  return {
    emitted,
    io: {
      to(target) {
        return { emit(event, payload) { emitted.push({ target, event, payload }) } }
      },
    },
  }
}

function player(id, baggage) {
  return {
    id,
    clientId: `client-${id}`,
    name: id,
    characteristics: baggage.map((value, occ) => ({
      type: 'Багаж', value, coef: 0.5, hint: '', tags: [], isVisible: true, occ,
    })),
    biology: { sex: 'М', age: 30, experience: 5, coef: 0.6, infertile: false, isVisible: true },
    isAlive: true,
    connected: true,
  }
}

test('обмен багажа поддерживает разные номера слотов', () => {
  const { io } = harness()
  const lobby = new Lobby(io, 'TEST')
  lobby.players = [player('host', ['A1', 'A2']), player('guest', ['B1', 'B2'])]
  lobby.started = true
  lobby.stage = 'reveal'
  lobby.cards.set('host', [require('../dist/server/cards.js').makeCardByCatalogId('ac_009', 'swap')])
  try {
    lobby.playCard('host', 'swap', {
      players: ['guest'],
      characteristics: [
        { playerId: 'host', category: 'Багаж', occ: 0 },
        { playerId: 'guest', category: 'Багаж', occ: 1 },
      ],
    })
    assert.equal(lobby.players[0].characteristics[0].value, 'B2')
    assert.equal(lobby.players[1].characteristics[1].value, 'A1')
  } finally {
    lobby.dispose()
  }
})

test('карта повтора превращается в неиспользованную копию последней карты', () => {
  const { io } = harness()
  const lobby = new Lobby(io, 'TEST')
  lobby.players = [player('host', ['A1']), player('guest', ['B1'])]
  lobby.started = true
  lobby.stage = 'vote1'
  const make = require('../dist/server/cards.js').makeCardByCatalogId
  lobby.cards.set('guest', [make('ac_028', 'source')])
  lobby.cards.set('host', [make('ac_012', 'replay')])
  try {
    lobby.playCard('guest', 'source', {})
    lobby.playCard('host', 'replay', {})
    const hand = lobby.cards.get('host')
    assert.equal(hand.length, 1)
    assert.equal(hand[0].cardId, 'ac_028')
    assert.equal(hand[0].used, false)
    assert.notEqual(hand[0].instanceId, 'replay')
  } finally {
    lobby.dispose()
  }
})
