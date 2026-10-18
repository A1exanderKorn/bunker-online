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
test('порча: три категории, андроид, приватность, стадии и случайный живой соперник',()=>{
  const random=Math.random
  try {
    for(const category of ['Биология','Здоровье','Факт']) for(const visible of [false,true]) {
      const {l,events,play}=fixture()
      try {
        l.players[1].isAlive=false
        const victim=l.players[2]
        victim.biology.sex='Андроид';victim.biology.isVisible=visible
        victim.characteristics.forEach(c=>c.isVisible=visible)
        const before=JSON.stringify(l.players.filter(p=>p!==victim))
        Math.random=()=>0
        assert.equal(play('ac_039',{categories:[category]}).used,true)
        assert.equal(JSON.stringify(l.players.filter(p=>p!==victim)),before)
        assert.equal(l.cardHistory[0].charChanges.length,1)
        assert.equal(l.cardHistory[0].charChanges[0].playerId,'p2')
        if(category==='Биология') {
          assert.equal(victim.biology.age,95);assert.equal(victim.biology.sex,'М')
          assert.equal(victim.biology.infertile,true);assert.equal(victim.biology.coef,biologyCoefficient(victim.biology))
        } else {
          const {rowsByCategory,expandForDeal}=require('../dist/server/data.js')
          const value=victim.characteristics.find(c=>c.type===category)
          if(category==='Факт') assert.equal(value.value,'Педофил')
          else {
            const worst=rowsByCategory(category).sort((a,b)=>a.coef-b.coef).slice(0,10)
            assert.ok(worst.some(r=>r.name===value.value))
            const variant=expandForDeal(worst.find(r=>r.name===value.value))[0]
            assert.equal(value.coef,variant.coef);assert.equal(value.stageLabel,variant.stageLabel)
            assert.equal(value.stageIndex,variant.stageIndex)
          }
        }
        for(const e of events.filter(e=>e.event==='cardPlayed')) {
          assert.deepEqual(e.payload.bloodPlayerIds,visible?['p2']:[])
          assert.equal(e.payload.reroll.length,visible||['p1','p2'].includes(e.target)?1:0)
        }
      } finally {l.dispose()}
    }
  } finally {Math.random=random}
})
test('порча отклоняет поддельные категории, слоты, выбор игрока и отсутствие соперников',()=>{
  const {l,play}=fixture()
  try {
    const before=JSON.stringify(l.players)
    for(const targets of [{categories:['Профессия']},{categories:[{category:'Здоровье',occ:1}]},{categories:['Факт'],players:['p1']}]) {
      assert.equal(play('ac_039',targets).used,false)
      assert.equal(JSON.stringify(l.players),before)
    }
    l.players.slice(1).forEach(p=>p.isAlive=false)
    assert.equal(play('ac_039',{categories:['Биология']}).used,false)
  } finally {l.dispose()}
})
function targets(card) {
  if(card.action==='spoilRandom')return {categories:['Биология']}
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
    if(def.action==='addMatchingThreat')l.players[0].biology.infertile=true
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

test('раздача: максимум две S и две A, одна карта игроку, уникальность',()=>{
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
      assert.ok(s<=2,`${n}/${coef}/${power}: ${s} S`)
      assert.ok(result.filter(c=>c.category==='A').length<=2)
      const unique=result.filter(c=>loadCards().find(d=>d.cardId===c.cardId).unique)
      assert.equal(new Set(unique.map(c=>c.cardId)).size,unique.length)
      assert.equal(new Set(result.map(c=>c.instanceId)).size,n)
    }
  }finally{console.warn=originalWarn;l.dispose()}
})

test('раздача не добавляет гарантированные S/A и исключает обе категории после лимита',()=>{
  const {l}=fixture()
  const originalWarn=console.warn
  try {
    console.warn=()=>{}
    const players=Array.from({length:10},(_,i)=>({...l.players[0],id:'d'+i,biology:null,
      characteristics:[{...l.players[0].characteristics[0],coef:1}]}))
    const weak=[...dealActionCards(players,'balanced','new',()=>.999999).values()]
    assert.equal(weak.length,10)
    assert.ok(weak.every(c=>c.category!=='S'&&c.category!=='A'))
    players.forEach(p=>p.characteristics[0].coef=-1)
    const strong=[...dealActionCards(players,'balanced','new',()=>0).values()]
    assert.deepEqual(strong.slice(0,4).map(c=>c.category),['S','S','A','A'])
    assert.ok(strong.slice(4).every(c=>c.category!=='S'&&c.category!=='A'))
  } finally {console.warn=originalWarn;l.dispose()}
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
    l.players[0].biology={...l.players[0].biology,sex:'М',age:25,infertile:true}
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

test('подходящая угроза использует матрицу одного источника и целевой размер бункера',()=>{
  const {l,play}=fixture()
  try {
    l.players[0].biology={...l.players[0].biology,age:30,infertile:false}
    l.players[0].characteristics=[
      {type:'Багаж',value:'Аптечка',coef:.9,tags:['medical'],occ:0},
      {type:'Хобби',value:'Первая помощь',coef:.6,tags:['medical'],occ:0},
    ]
    assert.equal(play('ac_033').used,false) // 20+30 >= 45, но ни одна карточка отдельно не решает.
    l.players[0].characteristics.push({type:'Профессия',value:'Врач общей практики',coef:.8,tags:[],occ:0})
    assert.equal(play('ac_033').used,true) // Теги пусты, реальные знания есть в матрице.
    assert.match(l.bunker.threats.at(-1),/Часть лекарств испорчена/)
  } finally {l.dispose()}
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

test('треть слотов каждому: без дублей, остальные слоты и выбывшие неизменны, анимация приватна',()=>{
  const {l,events,play}=fixture()
  const random=Math.random
  try{
    Math.random=()=>0
    l.players[0].characteristics[1].isVisible=false;l.players[5].isAlive=false
    const before=structuredClone(l.players)
    const dead=JSON.stringify(l.players[5])
    play('ac_035')
    assert.equal(l.players[0].characteristics[1].isVisible,false)
    assert.equal(JSON.stringify(l.players[5]),dead)
    for(const type of ['Профессия','Здоровье','Багаж','Факт']){
      const chars=l.players.filter(p=>p.isAlive).flatMap(p=>p.characteristics.filter(c=>c.type===type))
      assert.equal(new Set(chars.map(c=>c.value)).size,chars.length)
    }
    assert.equal(l.cards.get('p0')[0].cardId,'ac_035')
    assert.equal(l.cardHistory[0].charChanges.length,15)
    for (const p of l.players.filter(p=>p.isAlive)) {
      const changes=l.cardHistory[0].charChanges.filter(c=>c.playerId===p.id)
      assert.equal(changes.length,3)
      const old=before.find(x=>x.id===p.id)
      for (const c of p.characteristics) {
        const prev=old.characteristics.find(x=>x.type===c.type&&x.occ===c.occ)
        if (!changes.some(x=>x.slotType===c.type&&x.slotOcc===c.occ)) assert.deepEqual(c,prev)
        assert.equal(c.isVisible,prev.isVisible)
      }
      if (!changes.some(x=>x.slotType==='Биология')) assert.deepEqual(p.biology,old.biology)
    }
    const popups=events.filter(e=>e.event==='cardPlayed')
    assert.equal(popups.length,6)
    for (const e of popups) assert.ok(e.payload.reroll.every(s=>s.playerId===e.target || e.target==='p5' || l.cardHistory[0].charChanges.some(c=>c.playerId===s.playerId&&c.slotType===s.category&&c.slotOcc===s.occ&&c.wasVisible)))
    assert.ok(popups.find(e=>e.target==='p5').payload.reroll.length>0)
    assert.ok(l.cardHistoryFor('p1')[0].charChanges.find(c=>c.playerId==='p0'&&c.slotType==='Здоровье').newValue===null)
  }finally{Math.random=random;l.dispose()}
})

test('треть слотов: округление 6→2, 7→2, 8→3; биология участвует и имеет реальный КФ',()=>{
  const random=Math.random
  try {
    for (const n of [6,7,8]) {
      const {l,play}=fixture()
      try {
        l.players.forEach(p=>{p.characteristics=p.characteristics.slice(0,n-1)})
        Math.random=()=>.999999 // No shuffle: first slots.
        play('ac_035')
        l.players.forEach(p=>assert.equal(l.cardHistory[0].charChanges.filter(c=>c.playerId===p.id).length,Math.round(n/3)))
      } finally {l.dispose()}
    }
    const {l,play}=fixture()
    try {
      // Put only the biology slot into the selectable pool.
      l.players.forEach(p=>{p.characteristics=[]})
      play('ac_035')
      l.players.forEach(p=>assert.equal(p.biology.coef,biologyCoefficient(p.biology)))
      assert.equal(l.cardHistory[0].charChanges.length,6)
    } finally {l.dispose()}
  } finally {Math.random=random}
})

test('перераздача категории: анимацию своих скрытых и чужих открытых видят только нужные зрители',()=>{
  const {l,events,play}=fixture()
  try {
    l.players[1].characteristics[0].isVisible=false
    l.players[2].characteristics[0].isVisible=false
    l.players[5].isAlive=false
    l.settings.revealPreviousCharacteristics=true // Does not bypass animation privacy.
    play('ac_005',{categories:['Профессия']})
    const popups=events.filter(e=>e.event==='cardPlayed')
    assert.equal(popups.length,6)
    for (const e of popups) {
      const expected=l.players.filter(p=>p.isAlive&&(e.target==='p5'||p.id===e.target||![1,2].includes(Number(p.id.slice(1))))).map(p=>p.id)
      assert.deepEqual(e.payload.reroll.map(s=>s.playerId),expected)
      assert.equal(e.payload.seq,1)
      for (const slot of e.payload.reroll) assert.ok(slot.from&&slot.to&&slot.samples.length)
    }
  } finally {l.dispose()}
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
    assert.equal(play('ac_037',{categories:['Биология']}).used,true)
    l.players.forEach((p,i)=>{assert.equal(p.biology.coef,biologyCoefficient(p.biology));assert.ok(i===0?p.biology.coef>coefs[i]:p.biology.coef<coefs[i])})
  }finally{l.dispose()}
})

test('возраст и лечение согласованы с финальным подсчётом',()=>{
  const {l,play}=fixture()
  try{
    const bio=l.players[1].biology;bio.age=75;bio.infertile=true
    play('ac_011',{players:['p1']})
    assert.equal(isBiologyInfertile(bio),false)
    assert.ok(!biologyTags(bio).includes('reproductive_edge'))
    bio.infertile=true;bio.fertilityRestored=false
    assert.equal(isBiologyInfertile(bio),true)
    play('ac_036',{players:['p1']})
    assert.equal(bio.age,25);assert.equal(bio.infertile,false);assert.ok(bio.coef>=.5)
    assert.equal(isBiologyInfertile(bio),false)
    assert.equal(bio.coef,biologyCoefficient(bio))
    assert.ok(!biologyTags(bio).includes('reproductive_edge'))
    assert.equal(play('ac_036',{players:['p1']}).used,false)
    bio.age=22;bio.infertile=true
    assert.equal(play('ac_036',{players:['p1']}).used,true)
    assert.equal(bio.age,22);assert.equal(bio.infertile,false)
    assert.equal(bio.coef,biologyCoefficient(bio))
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
