const assert = require('node:assert/strict')
const test = require('node:test')

const { filterCardHistory } = require('../dist/server/cardHistory.js')
const { Lobby } = require('../dist/server/lobby.js')
const { makeCardByCatalogId } = require('../dist/server/cards.js')

function harness() {
  return {
    io: {
      to() {
        return { emit() {} }
      },
    },
  }
}

function player(id, { visible = true, alive = true } = {}) {
  return {
    id,
    clientId: `client-${id}`,
    name: id,
    characteristics: [
      { type: 'Профессия', value: `Профессия ${id}`, coef: 0.5, hint: '', tags: [], isVisible: visible, occ: 0 },
    ],
    biology: { sex: 'М', age: 30, experience: 5, coef: 0.5, infertile: false, isVisible: visible },
    isAlive: alive,
    connected: true,
  }
}

const hiddenChange = {
  playerId: 'guest',
  playerName: 'guest',
  slotType: 'Профессия',
  slotOcc: 0,
  slotLabel: 'Профессия',
  wasVisible: false,
  changeKind: 'replace',
  oldValue: 'Врач',
  newValue: 'Повар',
}

function historyEntries() {
  return [{
    seq: 1,
    round: 2,
    stage: 'reveal',
    byPlayerId: 'host',
    byName: 'host',
    cardTitle: 'Смена',
    summary: 'замена',
    charChanges: [hiddenChange],
  }]
}

test('закрытый слот не утекает живому чужому в истории', () => {
  const entries = historyEntries()
  const host = player('host')
  const guest = player('guest', { visible: false })
  const players = [host, guest]

  const forHost = filterCardHistory(entries, host, players, 'reveal', false)
  assert.equal(forHost[0].charChanges[0].oldValue, null)
  assert.equal(forHost[0].charChanges[0].newValue, null)
  assert.equal(forHost[0].charChanges[0].oldPublic, false)
  assert.equal(forHost[0].charChanges[0].newPublic, false)

  const forGuest = filterCardHistory(entries, guest, players, 'reveal', false)
  assert.equal(forGuest[0].charChanges[0].oldValue, 'Врач')
  assert.equal(forGuest[0].charChanges[0].newValue, 'Повар')
  assert.equal(forGuest[0].charChanges[0].oldPublic, false)
  assert.equal(forGuest[0].charChanges[0].newPublic, false)

  guest.isAlive = false
  const afterDeath = filterCardHistory(entries, host, players, 'reveal', false)
  assert.equal(afterDeath[0].charChanges[0].oldValue, 'Врач')
  assert.equal(afterDeath[0].charChanges[0].newValue, 'Повар')
  assert.equal(afterDeath[0].charChanges[0].oldPublic, true)
  assert.equal(afterDeath[0].charChanges[0].newPublic, true)
})

test('после вскрытия слота живой чужой видит только новое, пока настройка выкл', () => {
  const entries = historyEntries()
  const host = player('host')
  const guest = player('guest', { visible: true })
  const players = [host, guest]

  const off = filterCardHistory(entries, host, players, 'reveal', false)
  assert.equal(off[0].charChanges[0].oldValue, null)
  assert.equal(off[0].charChanges[0].newValue, 'Повар')
  assert.equal(off[0].charChanges[0].oldPublic, false)
  assert.equal(off[0].charChanges[0].newPublic, true)

  const on = filterCardHistory(entries, host, players, 'reveal', true)
  assert.equal(on[0].charChanges[0].oldValue, 'Врач')
  assert.equal(on[0].charChanges[0].newValue, 'Повар')
  assert.equal(on[0].charChanges[0].oldPublic, true)
  assert.equal(on[0].charChanges[0].newPublic, true)

  const ownerOff = filterCardHistory(entries, guest, players, 'reveal', false)
  assert.equal(ownerOff[0].charChanges[0].oldValue, 'Врач')
  assert.equal(ownerOff[0].charChanges[0].newValue, 'Повар')
  assert.equal(ownerOff[0].charChanges[0].oldPublic, false)
  assert.equal(ownerOff[0].charChanges[0].newPublic, true)
})

test('одно playCard с несколькими игроками даёт одну запись истории', () => {
  const { io } = harness()
  const lobby = new Lobby(io, 'HIST')
  lobby.players = [player('host'), player('guest')]
  lobby.started = true
  lobby.stage = 'reveal'
  lobby.cards.set('host', [makeCardByCatalogId('ac_001', 'jobs-all')])
  try {
    lobby.playCard('host', 'jobs-all', {})
    const history = lobby.cardHistoryFor('host')
    assert.equal(history.length, 1)
    assert.ok(history[0].charChanges.length >= 2)
    assert.equal(new Set(history[0].charChanges.map((c) => c.playerId)).size, 2)
  } finally {
    lobby.dispose()
  }
})
