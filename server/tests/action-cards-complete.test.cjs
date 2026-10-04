const test = require('node:test')
const assert = require('node:assert/strict')
const { Lobby } = require('../dist/server/lobby.js')
const { loadCards, makeCardByCatalogId, dealActionCards } = require('../dist/server/cards.js')
const { loadBunkerData } = require('../dist/server/bunker.js')
const { biologyCoefficient, isBiologyInfertile } = require('../dist/server/biology.js')
const { biologyTags } = require('../dist/server/cardEffects.js')

function fixture() {
  const events = []
  const l = new Lobby({ to: target => ({ emit: (event,payload) => events.push({target,event,payload}) }) }, 'TEST')
  l.players = Array.from({length:6},(_,i)=>({
    id:'p'+i, clientId:'c'+i, name:'Игрок '+i, isAlive:true, connected:true,
    biology:{sex:i%2?'Ж':'М',age:45,experience:20,infertile:false,isVisible:true,coef:.55},
    characteristics:['Профессия','Здоровье','Хобби','Фобия','Багаж','Багаж','Факт'].map((type,k)=>({
      type,occ:k===5?1:0,value:`${type}-${i}-${k}`,coef:.5,hint:'подсказка',isVisible:true,
      tags:type==='Профессия'?['engineering','tools']:[],
      ...(type==='Здоровье'?{stageLabel:'средняя',stageIndex:1,incurable:false}:{})
    })),
  }))
  l.players.forEach(p=>l.sockets.set(p.id,p.id))
  l.started=true; l.stage='reveal'; l.stepIndex=0
  l.turn.revealsThisTurn=1
  l.hostId='p0'; l.settings.voteMode='simultaneous'
  const data=loadBunkerData()
  l.bunker={catastrophe:data.catastrophes[0],years:3,conditions:[],threats:[data.threats[0]]}
  l.pendingThreats=data.threats.slice(1)
  l.lastRevealed.set('p1',{category:'Профессия',occ:0})
  const play=(id,targets={},owner='p0')=>{
    const card=makeCardByCatalogId(id,id+'-'+owner)
    l.cards.set(owner,[card]); l.playCard(owner,card.instanceId,targets); return card
  }
  return {l,events,play}
}
const char=(playerId,category='Багаж',occ=0)=>({playerId,category,occ})
function targets(card) {
  if(card.action==='swap')return {players:['p1'],characteristics:[char('p0'),char('p1','Багаж',1)]}
  if(['shuffleRevealed','biasedReroll'].includes(card.action)||(card.action==='change'&&card.target==='any'&&card.scope==='all'))return {categories:[{category:'Профессия',occ:0}]}
  if(card.action==='change'&&card.scope==='self')return {characteristics:[char('p0')]}
  if(card.action==='change'&&card.target==='any')return {players:['p1'],characteristics:card.cardId==='ac_006'?[char('p1','Профессия'),char('p1','Здоровье')]:[char('p1','Профессия')]}
  if(card.action==='removeThreat')return {threats:[0]}
  if(card.action==='cancelVotes')return {players:['p1','p2']}
  if(card.picks>0)return {players:['p1']}
  return {}
}

for(const def of loadCards())test(`полный каталог: ${def.cardId} — ${def.action}`,()=>{
  const {l,events,play}=fixture()
  try {
    l.stage=def.stage==='vote'?'vote1':'reveal'
    if(def.action==='healFertile')l.players[1].biology.infertile=true
    if(def.action==='randomReveal')l.players.forEach(p=>{p.biology.isVisible=false;p.characteristics.forEach(c=>c.isVisible=false)})
    if(def.action==='replayLast')l.lastPlayedEffect={card:makeCardByCatalogId('ac_028','prev'),targets:{},byPlayerId:'p1'}
    if(def.action==='revote')l.votes.set('p1','p2')
    const card=play(def.cardId,targets(def))
    assert.deepEqual(events.filter(e=>e.event==='errorMessage'),[])
    assert.equal(l.cardHistory.length,1)
    if(def.action==='replayLast') {assert.equal(l.cards.get('p0')[0].cardId,'ac_028');assert.equal(l.cards.get('p0')[0].used,false)}
    else assert.equal(card.used,true)
    if(def.action==='change')assert.ok(l.cardHistory[0].charChanges.length>0)
    if(def.action==='removeThreat')assert.equal(l.bunker.threats.length,0)
    if(def.action==='revealCondition')assert.equal(l.bunker.conditions.length,1)
    if(def.action==='addMatchingThreat')assert.equal(l.bunker.threats.length,2)
    if(def.action==='rejuvenate'){assert.equal(l.players[1].biology.age,25);assert.equal(l.players[1].biology.experience,9)}
    if(def.action==='makeInfertile'){assert.equal(l.players[1].biology.infertile,true);assert.ok(l.players[1].biology.coef<=0)}
    if(def.action==='healFertile')assert.equal(l.players[1].biology.infertile,false)
    if(def.action==='cancelVotes')assert.deepEqual([...l.cancelledVoters],['p1','p2'])
    if(def.action==='doubleVote')assert.equal(l.voteWeight.get('p0'),2)
    if(def.action==='selfProtection')assert.deepEqual(l.voteBans,[{voterId:'p1',protectedId:'p0'}])
    if(def.action==='selfDefence')assert.ok(l.protectedFromVote.has('p0'))
    if(def.action==='revote'){assert.equal(l.votes.size,0);assert.equal(l.revoteFrom.get('p1'),'p2')}
    if(def.action==='biasedReroll'){
      assert.ok(l.players[0].characteristics[0].coef>.5)
      assert.ok(l.players.slice(1).every(p=>p.characteristics[0].coef<.5))
    }
    const n=l.cardHistory.length
    if(def.action!=='replayLast'){l.playCard('p0',card.instanceId,targets(def));assert.equal(l.cardHistory.length,n)}
  }finally{l.dispose()}
})

test('раздача: 1–2 S, минимум A, одна карта игроку, уникальные экземпляры не повторяются',()=>{
  const {l}=fixture()
  const originalWarn=console.warn
  try{
    console.warn=()=>{}
    let seed=112233
    const rng=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
    for(let n=2;n<=16;n++)for(const power of ['weak','balanced','strong'])for(const coef of [-1,.35,.5,1])for(const random of [()=>0,()=>.999999,rng]){
      const players=Array.from({length:n},(_,i)=>({...l.players[0],id:'d'+i,biology:null,characteristics:[{...l.players[0].characteristics[0],coef}]}))
      const result=[...dealActionCards(players,power,'new',random).values()]
      assert.equal(result.length,n)
      const s=result.filter(c=>c.category==='S').length
      assert.ok(s>=1&&s<=2,`${n}/${coef}/${power}: ${s} S`)
      assert.ok(result.some(c=>c.category==='A'))
      const unique=result.filter(c=>loadCards().find(d=>d.cardId===c.cardId).unique)
      assert.equal(new Set(unique.map(c=>c.cardId)).size,unique.length)
      assert.equal(new Set(result.map(c=>c.instanceId)).size,n)
    }
  }finally{console.warn=originalWarn;l.dispose()}
})

test('75%: выбор на ходе, приватность, запрет другого слота, один обычный reveal',()=>{
  const {l,play,events}=fixture(),oldRandom=Math.random
  try{
    l.players.forEach(p=>p.characteristics[0].isVisible=false)
    l.players[0].characteristics[1].isVisible=false
    l.turnOrder=l.players.map(p=>p.id)
    l.startTurn(0)
    const rolls=[.749,0,.75]
    Math.random=()=>rolls.shift()??.99
    play('ac_032')
    assert.deepEqual(l.players.map(p=>p.characteristics[0].isVisible),[false,false,false,false,false,false])
    assert.deepEqual(l.forcedReveal,{category:'Профессия',occ:0})
    assert.ok(events.filter(e=>e.event==='forcedRevealChanged'&&e.payload.slot).every(e=>e.target==='p0'))
    l.reveal('p0','Здоровье')
    assert.equal(l.turn.revealedThisTurn,0)
    assert.equal(play('ac_032').used,false)
    l.reveal('p0','Профессия')
    assert.equal(l.turn.revealedThisTurn,1)
    assert.equal(l.forcedReveal,null)
    assert.equal(l.lastRevealed.get('p0').category,'Профессия')
    l.reveal('p0','Здоровье')
    assert.equal(l.players[0].characteristics[1].isVisible,false)
    l.startTurn(1)
    assert.equal(l.forcedReveal,null)
    l.reveal('p1','Профессия')
    assert.equal(l.turn.revealedThisTurn,1)
  }finally{Math.random=oldRandom;l.dispose()}
})

test('случайный ход: поздняя активация, таймер, хост, окончание раунда и права админки',()=>{
  const {l,play}=fixture(),oldRandom=Math.random
  try {
    Math.random=()=>0
    l.players.forEach(p=>p.characteristics.forEach(c=>c.isVisible=false))
    l.turnOrder=l.players.map(p=>p.id);l.startTurn(0)
    l.reveal('p0','Здоровье');play('ac_032')
    assert.equal(l.forcedReveal,null)
    l.startTurn(1)
    assert.deepEqual(l.forcedReveal,{category:'Профессия',occ:0})
    l.onTurnTimeout()
    assert.equal(l.players[1].characteristics[0].isVisible,true)
    assert.equal(l.players[1].characteristics[1].isVisible,false)
    l.endTurn('p0')
    assert.equal(l.players[2].characteristics[0].isVisible,true)
    l.beginRevealStep({kind:'reveal'})
    assert.equal(l.forcedReveal,null);assert.equal(l.randomRevealStep,-1)
    l.adminGiveCard('p1','ac_032');assert.equal(l.cards.has('p1'),false)
    const before=l.cards.get('p0').length;l.adminGiveCard('p0','ac_032')
    assert.equal(l.cards.get('p0').length,before+1)
  } finally {Math.random=oldRandom;l.dispose()}
})

test('угроза: все группы закрываются ОДНИМ источником, без дубликата из очереди',()=>{
  const {l,play}=fixture(),oldRandom=Math.random
  try{
    l.players[0].characteristics.forEach(c=>c.tags=[])
    l.players[0].biology={...l.players[0].biology,sex:'М',age:25,infertile:false}
    l.players[0].characteristics[0].tags=['reproductive_edge']
    Math.random=()=>0
    const card=play('ac_033')
    assert.equal(card.used,true)
    const added=l.bunker.threats.at(-1)
    assert.match(added,/сканер/i)
    assert.ok(!l.pendingThreats.includes(added))
    const failed=play('ac_033')
    assert.equal(failed.used,false)
    assert.equal(new Set(l.bunker.threats).size,l.bunker.threats.length)
  }finally{Math.random=oldRandom;l.dispose()}
})

test('перемешивание: целиком переносит здоровье, не трогает скрытое и выбывших',()=>{
  const {l,play}=fixture(),oldRandom=Math.random
  try{
    l.players[0].characteristics[1].stageLabel='ранняя';l.players[0].characteristics[1].stageIndex=0
    l.players[1].characteristics[1].stageLabel='терминальная';l.players[1].characteristics[1].stageIndex=2;l.players[1].characteristics[1].incurable=true
    l.players[2].characteristics[1].isVisible=false;l.players[5].isAlive=false
    const before=JSON.parse(JSON.stringify(l.players))
    Math.random=()=>0
    play('ac_034',{categories:[{category:'Здоровье',occ:0}]})
    const indices=[0,1,3,4]
    assert.deepEqual(indices.map(i=>l.players[i].characteristics[1]).sort((a,b)=>a.value.localeCompare(b.value)),indices.map(i=>before[i].characteristics[1]).sort((a,b)=>a.value.localeCompare(b.value)))
    assert.notDeepEqual(l.players[0].characteristics[1],before[0].characteristics[1])
    assert.deepEqual(l.players[2],before[2]);assert.deepEqual(l.players[5],before[5])
  }finally{Math.random=oldRandom;l.dispose()}
})

test('полная перераздача: без дублей, со стадиями и сохранением видимости/карт/начальной истории',()=>{
  const {l,play}=fixture()
  try{
    l.players[0].characteristics[0].isVisible=false;l.players[5].isAlive=false
    const dead=JSON.stringify(l.players[5])
    play('ac_035')
    assert.equal(l.players[0].characteristics[0].isVisible,false)
    assert.equal(l.players[0].characteristics[1].isVisible,true)
    assert.equal(JSON.stringify(l.players[5]),dead)
    for(const type of ['Профессия','Здоровье','Багаж','Факт']){
      const chars=l.players.filter(p=>p.isAlive).flatMap(p=>p.characteristics.filter(c=>c.type===type))
      assert.equal(new Set(chars.map(c=>c.value)).size,chars.length)
    }
    assert.equal(l.cards.get('p0')[0].cardId,'ac_035')
    assert.equal(l.cardHistory[0].charChanges.length,40)
    assert.ok(l.cardHistoryFor('p1')[0].charChanges.find(c=>c.playerId==='p0'&&c.slotType==='Профессия').newValue===null)
  }finally{l.dispose()}
})

test('направленная перераздача: на границах оставляет карты, биология имеет реальный КФ',()=>{
  const {l,play}=fixture()
  try{
    l.players[0].characteristics[0].coef=1
    l.players.slice(1).forEach(p=>p.characteristics[0].coef=-1)
    const before=JSON.stringify(l.players)
    assert.equal(play('ac_037',{categories:['Профессия']}).used,false)
    assert.equal(JSON.stringify(l.players),before)
    l.players.forEach(p=>{p.biology.coef=biologyCoefficient(p.biology)})
    const coefs=l.players.map(p=>p.biology.coef)
    assert.equal(play('ac_038',{categories:['Биология']}).used,true)
    l.players.forEach((p,i)=>{assert.equal(p.biology.coef,biologyCoefficient(p.biology));assert.ok(i===0?p.biology.coef>coefs[i]:p.biology.coef<coefs[i])})
  }finally{l.dispose()}
})

test('возраст, лечение и повторное бесплодие согласованы с финальным подсчётом',()=>{
  const {l,play}=fixture()
  try{
    const bio=l.players[1].biology;bio.age=75;bio.infertile=true
    play('ac_011',{players:['p1']})
    assert.equal(isBiologyInfertile(bio),false)
    assert.ok(!biologyTags(bio).includes('reproductive_edge'))
    play('ac_039',{players:['p1']})
    assert.equal(isBiologyInfertile(bio),true)
    play('ac_036',{players:['p1']})
    assert.equal(bio.age,25);assert.equal(bio.infertile,true);assert.ok(bio.coef<=0)
    assert.equal(play('ac_039',{players:['p1']}).used,false)
    bio.sex='Андроид';bio.infertile=false
    assert.equal(play('ac_039',{players:['p1']}).used,false)
  }finally{l.dispose()}
})

test('невалидные, скрытые и повторные цели отклоняются без частичных изменений',()=>{
  const {l,play}=fixture()
  try{
    l.players[1].characteristics[0].isVisible=false
    const before=JSON.stringify(l.players)
    assert.equal(play('ac_007',{players:['p1'],characteristics:[char('p1','Профессия')]}).used,false)
    assert.equal(play('ac_006',{players:['p1'],characteristics:[char('p1','Здоровье'),char('p1','Здоровье')]}).used,false)
    assert.equal(play('ac_006',{players:['p1'],characteristics:[char('p1','Здоровье'),char('p2','Хобби')]}).used,false)
    assert.equal(play('ac_021',{threats:[.5]}).used,false)
    assert.equal(JSON.stringify(l.players),before)
    l.stage='vote1'
    assert.equal(play('ac_035').used,false)
  }finally{l.dispose()}
})
