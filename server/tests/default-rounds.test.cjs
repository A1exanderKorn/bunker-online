const assert = require('node:assert/strict')
const test = require('node:test')
const { DEFAULT_SETTINGS, defaultRoundSteps } = require('../dist/shared/types.js')
const { Lobby } = require('../dist/server/lobby.js')

test('новые настройки и программа: 3R V 2R V, затем R V до половины', () => {
  assert.equal(DEFAULT_SETTINGS.gameMode, 'new')
  assert.equal(DEFAULT_SETTINGS.voteMode, 'sequential')
  assert.equal(DEFAULT_SETTINGS.actionCardsEnabled, true)
  assert.equal(DEFAULT_SETTINGS.extraBaggage, true)
  assert.equal(DEFAULT_SETTINGS.cardsPower, 'balanced')
  for (let count = 2; count <= 16; count++) {
    const survivors = Math.ceil(count / 2)
    const steps = defaultRoundSteps(count, survivors)
    assert.equal(steps.filter(s => s.kind === 'vote').length, count - survivors)
    assert.deepEqual(steps.slice(0, 4).map(s => [s.kind, s.revealThreat]), [
      ['reveal', false], ['reveal', false], ['reveal', true], ['vote', false],
    ])
    if (count - survivors >= 2) assert.deepEqual(steps.slice(4, 7).map(s => [s.kind, s.revealThreat]), [
      ['reveal', false], ['reveal', true], ['vote', false],
    ])
    for (let i = 7; i < steps.length; i++) {
      assert.equal(steps[i].kind, i % 2 ? 'reveal' : 'vote')
      assert.equal(steps[i].revealThreat, false)
    }
  }
})

test('программа по умолчанию доводит матч до половины и выдаёт только две угрозы', t => {
  const lobby = new Lobby({ to() { return { emit() {} } } }, 'ROUNDS')
  t.after(() => lobby.dispose())
  lobby.players = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, clientId: 'c' + i,
    name: 'Игрок ' + i, characteristics: [], biology: null, isAlive: true, connected: true }))
  lobby.regenerateDefaultSteps()
  lobby.start('p0')
  assert.equal(lobby.pendingThreats.length, 2)
  lobby.beginRounds('p0')
  let guard = 0
  while (lobby.stage !== 'end' && guard++ < 200) {
    if (lobby.stage === 'reveal') lobby.onTurnTimeout()
    else lobby.resolveVote('p0')
  }
  assert.equal(lobby.stage, 'end')
  assert.equal(lobby.players.filter(p => p.isAlive).length, 4)
  assert.equal(lobby.bunker.threats.length, 2)
})
