const assert = require('node:assert/strict')
const test = require('node:test')
const { Lobby } = require('../dist/server/lobby.js')
const { makeCardByCatalogId } = require('../dist/server/cards.js')
const { biologyCoefficient } = require('../dist/server/biology.js')
const { loadCharacteristics, healthVariants } = require('../dist/server/data.js')

function setup(t, count = 4) {
  const events = []
  const io = { sockets: { sockets: new Map() }, to(target) {
    return { emit(event, payload) { events.push({ target, event, payload }) } }
  } }
  const lobby = new Lobby(io, 'TEST')
  lobby.players = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`, clientId: `client${i}`, name: `Player ${i}`, isAlive: true, connected: true,
    characteristics: [], biology: { sex: 'М', age: 30, experience: 2, infertile: false, coef: .7, isVisible: false },
  }))
  for (const p of lobby.players) {
    lobby.sockets.set(p.id, p.id + '-socket')
    io.sockets.sockets.set(p.id + '-socket', {
      emit(event, payload) { events.push({ target: p.id + '-socket', event, payload }) },
      leave() {}, disconnect() { lobby.handleDisconnect(p.id, p.id + '-socket') },
    })
  }
  lobby.started = true
  lobby.startCount = count
  lobby.settings.survivorsCount = 1
  lobby.settings.roundSteps = [{ kind: 'vote', revealThreat: false }, { kind: 'reveal', revealThreat: false }]
  lobby.stepIndex = 0
  lobby.stage = 'vote1'
  lobby.settings.voteMode = 'simultaneous'
  t.after(() => lobby.dispose())
  const last = (target, event) => events.filter(e => e.target === target && e.event === event).at(-1)?.payload
  return { lobby, events, last, io }
}

test('секретные цели не отправляются другим игрокам, включая выбывших и реконнект', t => {
  const { lobby, events, last } = setup(t)
  lobby.players[3].isAlive = false
  lobby.vote('p0', 'p1')
  for (const id of ['p0', 'p1', 'p2', 'p3']) {
    const payload = last(id + '-socket', 'votesUpdated')
    assert.deepEqual(payload.tally, {})
    assert.deepEqual(payload.votesByTarget, {})
    assert.deepEqual(payload.voted, ['p0'])
    assert.equal(payload.ownVote, id === 'p0' ? 'p1' : null)
  }
  assert.equal(events.some(e => e.target === 'TEST' && e.event === 'votesUpdated'), false)
  lobby.snapshotFor('p0')
  assert.equal(last('p0-socket', 'votesUpdated').ownVote, 'p1')
  assert.equal(last('p2-socket', 'votesUpdated').ownVote, null)
})

test('каждый живой, в том числе отключённый, должен проголосовать; выбывший не учитывается', t => {
  const { lobby, events } = setup(t)
  lobby.players[3].isAlive = false
  lobby.players[2].connected = false
  lobby.vote('p0', 'p1')
  lobby.vote('p1', 'p0')
  assert.equal(events.some(e => e.event === 'voteResult'), false)
  lobby.vote('p3', 'p1')
  assert.equal(events.some(e => e.event === 'voteResult'), false)
  lobby.vote('p2', 'p1')
  const results = events.filter(e => e.event === 'voteResult')
  assert.equal(results.length, 1)
  assert.equal(results[0].payload.eliminatedId, 'p1')
  assert.deepEqual(results[0].payload.tally, { p1: 2, p0: 1 })
})

test('повторный голос не считается новым проголосовавшим; ничья открывает второй тур', t => {
  const { lobby, events } = setup(t)
  lobby.vote('p0', 'p1')
  lobby.vote('p0', 'p2')
  lobby.vote('p0', 'p1')
  assert.equal(lobby.votes.size, 1)
  lobby.vote('p1', 'p0')
  lobby.vote('p2', 'p0')
  lobby.vote('p3', 'p1')
  assert.equal(lobby.stage, 'vote2')
  assert.equal(lobby.votes.size, 0)
  lobby.vote('p0', 'p1')
  lobby.vote('p1', 'p0')
  lobby.vote('p2', 'p1')
  lobby.vote('p3', 'p1')
  const results = events.filter(e => e.event === 'voteResult')
  assert.equal(results.length, 2)
  assert.equal(results[1].payload.eliminatedId, 'p1')
})

test('хост и таймер по-прежнему завершают неполное голосование', t => {
  for (const by of ['host', 'timer']) {
    const { lobby, events } = setup(t)
    lobby.vote('p0', 'p1')
    lobby.vote('p2', 'p1')
    lobby.resolveVote('p2')
    assert.equal(events.some(e => e.event === 'voteResult'), false)
    if (by === 'host') lobby.resolveVote('p0')
    else lobby.onVoteTimeout()
    assert.ok(events.some(e => e.event === 'voteResult'))
  }
})

test('карта переголосования не раскрывает предыдущие цели в истории или попапе', t => {
  const { lobby, events, last } = setup(t)
  lobby.vote('p0', 'p1')
  lobby.vote('p1', 'p2')
  lobby.cards.set('p0', [makeCardByCatalogId('ac_030', 'revote')])
  lobby.playCard('p0', 'revote', {})
  assert.equal(lobby.votes.size, 0)
  assert.deepEqual(last('p0-socket', 'votesUpdated').revoteFrom, { p0: 'p1' })
  assert.deepEqual(last('p1-socket', 'votesUpdated').revoteFrom, { p1: 'p2' })
  assert.deepEqual(last('p2-socket', 'votesUpdated').revoteFrom, {})
  const played = events.find(e => e.event === 'cardPlayed')
  assert.ok(played)
  assert.doesNotMatch(played.payload.effectText, /Player 1|Player 2/)
  for (const entry of lobby.cardHistoryFor('p3')) {
    assert.equal(entry.charChanges.length, 0)
    assert.doesNotMatch(entry.summary, /Player 1|Player 2/)
  }
  lobby.vote('p0', 'p1')
  assert.equal(lobby.votes.has('p0'), false)
})

test('последовательный режим сохраняет публичный подсчёт голосов', t => {
  const { lobby, last } = setup(t)
  lobby.settings.voteMode = 'sequential'
  lobby.votes.set('p0', 'p1')
  lobby.broadcastVotes()
  assert.deepEqual(last('p2-socket', 'votesUpdated').tally, { p1: 1 })
  assert.deepEqual(last('p2-socket', 'votesUpdated').votesByTarget, { p1: ['p0'] })
})

test('кик доступен только хосту до старта, не для самого себя; повторный вход разрешён', t => {
  const { lobby, events } = setup(t)
  lobby.kickPlayer('p0', 'p1')
  assert.equal(lobby.players.length, 4)
  lobby.started = false
  lobby.kickPlayer('p1', 'p2')
  lobby.kickPlayer('p0', 'p0')
  assert.equal(lobby.players.length, 4)
  lobby.kickPlayer('p0', 'p1')
  assert.equal(lobby.players.length, 3)
  assert.equal(lobby.sockets.has('p1'), false)
  assert.equal(lobby.removalTimers.has('p1'), false)
  assert.ok(events.some(e => e.event === 'kicked' && e.target === 'p1-socket'))
  const result = lobby.addOrReconnect('new-socket', 'client1', 'Player 1')
  assert.ok(result.playerId)
  assert.equal(lobby.players.length, 4)
})

test('обмен переносит стадию, её КФ и признак терминальности вместе со здоровьем', t => {
  const { lobby } = setup(t, 2)
  lobby.stage = 'reveal'
  const rows = loadCharacteristics().filter(r => r.category === 'Здоровье')
  const original = ['Онкология', 'Идеально здоров'].map((name, i) => {
    const row = rows.find(r => r.name === name)
    const variant = healthVariants(row)[i === 0 ? 2 : 0]
    return { type: 'Здоровье', value: row.name, coef: variant.coef, hint: variant.hint,
      stageLabel: variant.stageLabel, stageIndex: variant.stageIndex, incurable: variant.incurable,
      tags: [...row.tags], occ: 0, isVisible: true }
  })
  lobby.players.forEach((p, i) => { p.characteristics = [{ ...original[i] }] })
  lobby.cards.set('p0', [makeCardByCatalogId('ac_002', 'swap')])
  lobby.playCard('p0', 'swap', { players: ['p1'], characteristics: [
    { playerId: 'p0', category: 'Здоровье', occ: 0 },
    { playerId: 'p1', category: 'Здоровье', occ: 0 },
  ] })
  for (let i = 0; i < 2; i++) {
    const received = lobby.players[i].characteristics[0]
    for (const key of ['value', 'coef', 'hint', 'tags']) assert.deepEqual(received[key], original[1 - i][key])
    for (const key of ['stageIndex', 'stageLabel', 'incurable']) assert.equal(received[key], original[1 - i][key])
  }
  assert.doesNotMatch(lobby.players[0].characteristics[0].hint, /Стадия:/)
  assert.equal(lobby.players[1].characteristics[0].stageIndex, 2)
  assert.equal(lobby.players[1].characteristics[0].incurable, true)
})

test('лечение бесплодия пересчитывает КФ той же формулой', t => {
  const { lobby } = setup(t)
  const p = lobby.players[0]
  p.biology.infertile = true
  p.biology.coef = biologyCoefficient(p.biology)
  lobby.cards.set('p0', [makeCardByCatalogId('ac_011', 'heal')])
  lobby.playCard('p0', 'heal', { players: ['p0'] })
  assert.equal(p.biology.infertile, false)
  assert.equal(p.biology.coef, biologyCoefficient(p.biology))
})
