const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const ts=require('typescript')

// Run the real store with a deterministic clock/socket, without a browser or a running server.
function client() {
  const events={},timers=new Map();let time=0,id=0
  const win={setTimeout(fn,delay){timers.set(++id,{fn,at:time+delay});return id},clearTimeout(id){timers.delete(id)}}
  const socket={on(name,fn){events[name]=fn},emit(){}}
  const pinia={defineStore(_name,options){return ()=>{
    const store=options.state()
    store.$reset=()=>Object.assign(store,options.state())
    for(const [key,action]of Object.entries(options.actions))store[key]=action.bind(store)
    for(const [key,get]of Object.entries(options.getters))Object.defineProperty(store,key,{get:()=>get(store)})
    return store
  }}}
  const source=fs.readFileSync(path.join(__dirname,'../../frontend/src/stores/game.ts'),'utf8')
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText
  const exports={}
  new Function('require','exports','window',compiled)(name=>{
    if(name==='pinia')return pinia
    if(name==='@shared/types')return require('../dist/shared/types.js')
    if(name==='@/services/socket')return {connectSocket:()=>socket,disconnectSocket(){},getSocket:()=>socket}
    throw Error(name)
  },exports,win)
  const store=exports.useGameStore();store.connect('test','ROOM','create')
  return {store,events,timers,advance(ms){const end=time+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn()}time=end}}
}
const card=(seq,animated=true)=>({seq,byPlayerId:'p',byName:'p',title:'card',effectText:'effect',...(animated?{reroll:[{playerId:'p',category:'Багаж',occ:1,from:'old',to:'new',samples:['sample']}]}:{})})

test('анимация начинается немедленно и не ждёт закрытия попапа',()=>{
  const {store,events,advance}=client()
  events.cardPlayed(card(1))
  assert.equal(store.rerollSlots['p:Багаж#1'].seq,1);assert.equal(store.cardPopup.seq,1)
  advance(5000);assert.deepEqual(store.rerollSlots,{})
  advance(3000);assert.equal(store.cardPopup,null)
  store.onCardPopupClosed();assert.deepEqual(store.rerollSlots,{})
})
test('новая замена перезапускает слот; устаревшее завершение не стирает новый эффект',()=>{
  const {store,events,advance}=client()
  events.cardPlayed(card(1));events.cardPlayed(card(2));events.cardPlayed(card(3,false))
  store.dismissCardPopup();store.onCardPopupClosed()
  assert.equal(store.rerollSlots['p:Багаж#1'].seq,2);assert.equal(store.cardPopup.seq,2)
  store.finishRerollSlot(1,'p:Багаж#1');assert.equal(store.rerollSlots['p:Багаж#1'].seq,2)
  advance(5000) // hidden-tab fallback
  assert.deepEqual(store.rerollSlots,{});assert.equal(store.cardPopup.seq,2)
  store.dismissCardPopup();store.onCardPopupClosed();store.finishRerollSlot(2,'p:Багаж#1')
  assert.equal(store.cardPopup.seq,3)
  advance(8000);store.onCardPopupClosed();assert.deepEqual(store.rerollSlots,{});assert.equal(store.cardPopup,null)
})
test('новая игра, реконнект и конец игры очищают эффекты и таймеры',()=>{
  for(const event of ['newGameStarted','gameEnded','gameStarted']) {
    const {store,events,timers,advance}=client()
    events.cardPlayed(card(1));events.cardPlayed(card(2));store.dismissCardPopup();store.onCardPopupClosed()
    events[event]({stage:'reveal',players:[],settings:{},turn:{},bunker:{},actionCards:[],survivorIds:[]})
    assert.deepEqual(store.rerollSlots,{},event);assert.equal(store.cardPopup,null,event);assert.equal(store.cardPopupQueue.length,0,event)
    assert.equal(timers.size,0,event);advance(10000);store.onCardPopupClosed();assert.equal(store.cardPopup,null,event)
  }
})
test('кровавый эффект длится семь секунд независимо от попапа',()=>{
  const {store,events,advance}=client()
  events.cardPlayed({...card(1),bloodPlayerIds:['p']})
  advance(6999);assert.equal(store.bloodPlayers.p,1)
  advance(1);assert.deepEqual(store.bloodPlayers,{})
  assert.equal(store.cardPopup.seq,1)
})
test('новый дизайн не выключает эффекты случайного хода; анимация учитывает reduced motion',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../../frontend/src/assets/presentation.css'),'utf8')
  assert.doesNotMatch(css,/\.player-card\.random-turn\s*\{[^}]*animation:\s*none/)
  assert.doesNotMatch(css,/\.random-sparks\s*\{[^}]*display:\s*none/)
  assert.doesNotMatch(css,/\.char-row\.final-danger\s*\{[^}]*animation:\s*none/)
  const table=fs.readFileSync(path.join(__dirname,'../../frontend/src/components/GameTable.vue'),'utf8')
  assert.match(table,/animation: rainbow-turn/);assert.match(table,/animation: question-drift/);assert.match(table,/animation: forced-white/)
  const reel=fs.readFileSync(path.join(__dirname,'../../frontend/src/components/TraitRoulette.vue'),'utf8')
  assert.match(reel,/prefers-reduced-motion/);assert.match(reel,/props.slot.to/)
})
