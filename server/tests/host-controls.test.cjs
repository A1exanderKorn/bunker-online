const assert = require('node:assert/strict')
const test = require('node:test')

const { Lobby } = require('../dist/server/lobby.js')

function harness() {
  const emitted = []
  return {
    emitted,
    io: {
      to(target) {
        return {
          emit(event, payload) {
            emitted.push({ target, event, payload })
          },
        }
      },
    },
  }
}

function player(id) {
  return {
    id,
    clientId: `client-${id}`,
    name: id,
    characteristics: [
      {
        type: 'Профессия',
        value: `Профессия ${id}`,
        coef: 0.5,
        hint: '',
        isVisible: false,
        occ: 0,
      },
    ],
    biology: {
      sex: 'М',
      age: 30,
      experience: 5,
      coef: 0.7,
      infertile: false,
      isVisible: false,
    },
    isAlive: true,
    connected: true,
  }
}

test('принудительное завершение голосования без голосов исключает случайного игрока', () => {
  const { io, emitted } = harness()
  const lobby = new Lobby(io, 'TEST')
  lobby.players = [player('host'), player('guest-1'), player('guest-2')]
  lobby.started = true
  lobby.stage = 'vote1'
  lobby.startCount = 3
  lobby.stepIndex = 0
  lobby.settings.survivorsCount = 1
  lobby.settings.roundSteps = [
    { kind: 'vote', revealThreat: false },
    { kind: 'reveal', revealThreat: false },
  ]

  const original = Math.random
  Math.random = () => 0
  try {
    lobby.resolveVote('host')
  } finally {
    Math.random = original
    lobby.dispose()
  }

  assert.equal(lobby.players.filter((candidate) => candidate.isAlive).length, 2)
  const result = emitted.find((item) => item.event === 'voteResult')?.payload
  assert.equal(result?.eliminatedId, 'host')
  assert.deepEqual(result?.tally, {})
})

test('хост может завершить чужой ход, при необходимости вскрыв случайную характеристику', () => {
  const { io } = harness()
  const lobby = new Lobby(io, 'TEST')
  lobby.players = [player('host'), player('guest')]
  lobby.started = true
  lobby.stage = 'reveal'
  lobby.stepIndex = 0
  lobby.turnOrder = ['guest', 'host']
  lobby.turnIndex = 0
  lobby.turn = {
    currentPlayerId: 'guest',
    stepIndex: 0,
    round: 1,
    revealsThisTurn: 1,
    revealedThisTurn: 0,
    currentVoterId: null,
  }

  try {
    lobby.endTurn('host')

    const guest = lobby.players.find((candidate) => candidate.id === 'guest')
    const visibleCount = guest.characteristics.filter((item) => item.isVisible).length
      + (guest.biology.isVisible ? 1 : 0)
    assert.equal(visibleCount, 1)
    assert.equal(lobby.turn.currentPlayerId, 'host')
  } finally {
    lobby.dispose()
  }
})

test('автозавершение сразу передаёт ход после успешного вскрытия', () => {
  const { io } = harness()
  const lobby = new Lobby(io, 'TEST')
  lobby.players = [player('host'), player('guest')]
  lobby.started = true
  lobby.stage = 'reveal'
  lobby.turnOrder = ['host', 'guest']
  lobby.turnIndex = 0
  lobby.turn = {
    currentPlayerId: 'host',
    stepIndex: 0,
    round: 1,
    revealsThisTurn: 1,
    revealedThisTurn: 0,
    currentVoterId: null,
  }

  try {
    lobby.reveal('host', 'Профессия', 0, true)

    assert.equal(lobby.players[0].characteristics[0].isVisible, true)
    assert.equal(lobby.turn.currentPlayerId, 'guest')
  } finally {
    lobby.dispose()
  }
})
