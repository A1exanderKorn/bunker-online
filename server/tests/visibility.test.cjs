const assert = require('node:assert/strict')
const test = require('node:test')

const { Lobby } = require('../dist/server/lobby.js')

function player(id, isAlive, visible) {
  return {
    id,
    clientId: `client-${id}`,
    name: id,
    characteristics: [
      { type: 'Профессия', value: `Профессия ${id}`, coef: 0.5, hint: '', tags: [], isVisible: visible, occ: 0 },
    ],
    biology: { sex: 'М', age: 30, experience: 5, coef: 0.5, infertile: false, isVisible: visible },
    isAlive,
    connected: true,
  }
}

test('выбывший видит все карточки, живой — только открытые', () => {
  const lobby = new Lobby({}, 'TEST')
  lobby.stage = 'reveal'
  lobby.players = [player('alive', true, false), player('dead', false, false)]

  const forAlive = lobby.publicPlayers('alive')
  assert.equal(forAlive[0].characteristics.length, 0)
  assert.equal(forAlive[1].characteristics.length, 0)
  assert.equal(forAlive[0].biology, null)

  const forDead = lobby.publicPlayers('dead')
  assert.equal(forDead[0].characteristics.length, 1)
  assert.equal(forDead[1].characteristics.length, 1)
  assert.ok(forDead[0].biology)
  assert.ok(forDead[1].biology)
})
