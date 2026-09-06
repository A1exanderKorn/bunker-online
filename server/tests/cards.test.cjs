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

test('категории карт обходятся в порядке A -> B -> D -> C', () => {
  const defs = [def('C', 1), def('D', 1), def('B', 1), def('A', 1)]
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.00), 'A')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.26), 'B')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.51), 'D')
  assert.equal(rollCategory(defs, 0.5, 'balanced', () => 0.76), 'C')
})

test('вероятности категорий в каждой корзине Excel дают 100%', () => {
  const firstByCategory = new Map()
  for (const card of loadCards()) {
    if (!firstByCategory.has(card.category)) firstByCategory.set(card.category, card)
  }

  for (let bucket = 0; bucket < 7; bucket++) {
    const total = [...firstByCategory.values()]
      .reduce((sum, card) => sum + card.probs[bucket], 0)
    assert.ok(Math.abs(total - 1) < 1e-9, `корзина ${bucket}: сумма ${total}`)
  }

  assert.equal(firstByCategory.get('C').probs[6], 0.75)
})

test('все активные карты имеют поддерживаемое действие и корректные шаги выбора', () => {
  const supported = new Set([
    'change', 'swap', 'healFertile', 'replayLast', 'changeCatastrophe', 'revealCondition',
    'removeThreat', 'cancelVotes', 'doubleVote', 'selfProtection', 'selfDefence', 'revote',
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
