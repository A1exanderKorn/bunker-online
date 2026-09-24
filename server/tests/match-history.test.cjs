const test = require('node:test')
const assert = require('node:assert/strict')
delete process.env.DATABASE_URL
const { Lobby } = require('../dist/server/lobby.js')
const { loadCharacteristics } = require('../dist/server/data.js')
const { loadBunkerData } = require('../dist/server/bunker.js')
const { loadCards } = require('../dist/server/cards.js')
loadCharacteristics(); loadBunkerData(); loadCards()
const io = {to:()=>({emit(){}}),sockets:{sockets:new Map()}}
test('real lobby captures initial deal; disconnected account remains in history; a new game gets a new snapshot', () => {
  const lobby = new Lobby(io,'HIST')
  for (let i=0;i<4;i++) lobby.addOrReconnect(`s${i}`,`c${i}`,`Игрок ${i}`,i===0?undefined:{id:`profile${i}`,nickname:`Игрок ${i}`,avatarUrl:''})
  lobby.start(lobby.host.id)
  const recorder = lobby.matchRecorder
  assert.ok(recorder)
  const removed = lobby.players[1]
  const startingName = removed.characteristics[0].value
  removed.characteristics[0].value = 'Changed by action card'
  lobby.removePlayerNow(removed.id)
  const record = recorder.finish(lobby.players.filter(p=>p.isAlive).map(p=>p.id))
  assert.equal(record.playerCount,4)
  const participant = record.players.find(p=>p.profileId==='profile1')
  assert.equal(participant.admitted,false)
  assert.equal(participant.eliminationOrder,1)
  assert.equal(participant.characteristics[1].value,startingName)
  lobby.newGame(lobby.host.id)
  assert.equal(lobby.matchRecorder,null)
  lobby.start(lobby.host.id)
  const next = lobby.matchRecorder.finish([])
  assert.notEqual(next.id,record.id)
  assert.equal(next.playerCount,3)
  assert.equal(next.targetCoef,lobby.settings.targetCoef)
  assert.equal(next.randomTargetCoef,lobby.settings.randomTargetCoef)
  lobby.stopTimer()
})

test('random dealing preserves configured target but marks it as unused, and freezes weighted player coefficient', () => {
  const {MatchRecorder} = require('../dist/server/matchHistory.js')
  const {averageCoef} = require('../dist/server/cards.js')
  const players = [{id:'p',profileId:'account',characteristics:[{type:'Профессия',value:'Врач',coef:1,occ:0},{type:'Багаж',value:'Аптечка',coef:.4,occ:0}],biology:null}]
  const expected = averageCoef(players[0],'new')
  const recorder = new MatchRecorder(players,'new',.75,true)
  players[0].characteristics[0].coef=-1
  const match = recorder.finish(['p'])
  assert.equal(match.gameMode,'new')
  assert.equal(match.targetCoef,.75)
  assert.equal(match.randomTargetCoef,true)
  assert.equal(match.players[0].startingCoef,expected)
})
