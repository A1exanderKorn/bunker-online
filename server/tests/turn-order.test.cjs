const assert = require('node:assert/strict')
const test = require('node:test')

const { Lobby } = require('../dist/server/lobby.js')

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
