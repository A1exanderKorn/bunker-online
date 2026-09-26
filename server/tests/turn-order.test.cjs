const assert = require('node:assert/strict')
const test = require('node:test')

const { Lobby } = require('../dist/server/lobby.js')

test('старт перемешивает все места, сохраняет хоста и использует одну очередь для стола и раундов', () => {
  const lobby = new Lobby(ioStub(), 'SHUFFLE')
  lobby.players = Array.from({ length: 6 }, (_, i) => player(i + 1))
  lobby.settings.voteMode = 'sequential'
  lobby.settings.roundSteps = [
    { kind: 'reveal', revealThreat: false },
    { kind: 'reveal', revealThreat: false },
    { kind: 'vote', revealThreat: false },
  ]
  const original = Math.random
  let calls = 0, seed = 12345
  Math.random = () => calls++ < 5 ? 0 : ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  try {
    lobby.start('p2')
    assert.deepEqual(lobby.matchOrder, [])
    lobby.start('p1')
    assert.deepEqual(lobby.matchOrder, ['p2', 'p3', 'p4', 'p5', 'p6', 'p1'])
    assert.equal(lobby.isHost('p1'), true)
    assert.equal(lobby.isHost('p2'), false)
    assert.deepEqual(lobby.publicPlayers().map(p => p.id), lobby.matchOrder)
    lobby.beginRounds('p1')
    assert.deepEqual(lobby.turnOrder, lobby.matchOrder)
    lobby.runStep(1)
    assert.deepEqual(lobby.turnOrder, ['p3', 'p4', 'p5', 'p6', 'p1', 'p2'])
    lobby.runStep(2)
    assert.deepEqual(lobby.voteOrder, lobby.matchOrder)
    lobby.removePlayerNow('p2')
    lobby.stepIndex = 1
    assert.deepEqual(lobby.rotatedAliveOrder('reveal'), ['p3', 'p4', 'p5', 'p6', 'p1'])
    lobby.newGame('p1')
    assert.deepEqual(lobby.matchOrder, [])
    assert.equal(lobby.isHost('p1'), true)
    lobby.start('p1')
    assert.equal(lobby.matchOrder.length, 5)
    assert.equal(new Set(lobby.matchOrder).size, 5)
    assert.equal(lobby.isHost('p1'), true)
  } finally { Math.random = original; lobby.dispose() }
})

function player(index) {
  return {
    id: `p${index}`,
    clientId: `client-${index}`,
    name: `Игрок ${index}`,
    characteristics: [],
    biology: null,
    isAlive: true,
    connected: true,
  }
}

function ioStub() {
  return {
    to() {
      return { emit() {} }
    },
  }
}

test('очереди вскрытия и голосования сдвигаются независимо по исходным местам', () => {
  const lobby = new Lobby(ioStub(), 'TEST')
  lobby.players = Array.from({ length: 6 }, (_, index) => player(index + 1))
  lobby.started = true
  lobby.startCount = 6
  lobby.settings.survivorsCount = 1
  lobby.settings.voteMode = 'sequential'
  lobby.settings.roundSteps = [
    { kind: 'reveal', revealThreat: false },
    { kind: 'reveal', revealThreat: false },
    { kind: 'vote', revealThreat: false },
    { kind: 'reveal', revealThreat: false },
    { kind: 'vote', revealThreat: false },
  ]

  try {
    lobby.runStep(0)
    assert.deepEqual(lobby.turnOrder, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])

    lobby.runStep(1)
    assert.deepEqual(lobby.turnOrder, ['p2', 'p3', 'p4', 'p5', 'p6', 'p1'])

    lobby.runStep(2)
    assert.deepEqual(lobby.voteOrder, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])

    // Первый игрок выбыл, но точка старта третьего вскрытия остаётся на
    // третьем исходном месте, а второго голосования — на втором.
    lobby.players[0].isAlive = false

    lobby.runStep(3)
    assert.deepEqual(lobby.turnOrder, ['p3', 'p4', 'p5', 'p6', 'p2'])

    lobby.runStep(4)
    assert.deepEqual(lobby.voteOrder, ['p2', 'p3', 'p4', 'p5', 'p6'])
  } finally {
    lobby.dispose()
  }
})

test('переголосование сохраняет очередь текущего голосовательного раунда', () => {
  const lobby = new Lobby(ioStub(), 'TEST')
  lobby.players = Array.from({ length: 4 }, (_, index) => player(index + 1))
  lobby.started = true
  lobby.startCount = 4
  lobby.settings.survivorsCount = 1
  lobby.settings.voteMode = 'sequential'
  lobby.settings.roundSteps = [
    { kind: 'vote', revealThreat: false },
    { kind: 'reveal', revealThreat: false },
    { kind: 'vote', revealThreat: false },
  ]

  try {
    lobby.runStep(2)
    assert.deepEqual(lobby.voteOrder, ['p2', 'p3', 'p4', 'p1'])

    lobby.stage = 'vote2'
    lobby.beginSequentialVote()
    assert.deepEqual(lobby.voteOrder, ['p2', 'p3', 'p4', 'p1'])
  } finally {
    lobby.dispose()
  }
})
