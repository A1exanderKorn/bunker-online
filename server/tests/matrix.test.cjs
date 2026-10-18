const test=require('node:test'),assert=require('node:assert/strict')
const {loadCapabilityMatrix,validateMatrix,characteristicCapabilities,biologyCapabilities,buildCapabilityTeam,teamDivisor,capabilityCoverage,capabilityDeficit}=require('../dist/server/capabilityMatrix')
const {loadCharacteristics}=require('../dist/server/data')
const {loadBunkerData,toPublicChallenge,toPublicBunker}=require('../dist/server/bunker')
const {calculateSurvival}=require('../dist/server/survival')
const m=loadCapabilityMatrix()
const ch=(type,value)=>({type,value,coef:0,tags:[],isVisible:false})
const player=(id,chars=[])=>({id,name:id,clientId:id,isAlive:true,connected:true,characteristics:chars,biology:{sex:'М',age:30,experience:5,infertile:false,isVisible:false,coef:.7}})
const event=id=>loadBunkerData().challenges.find(c=>c.id===id)
const bunker=(id,conditions=[])=>({catastrophe:event(id)?.text||'',threats:[],conditions,years:3})

test('полнота матрицы: все строки, события, условия, только известные шкалы 0–100',()=>{
  validateMatrix(m)
  for(const r of loadCharacteristics())assert.ok(Object.hasOwn(m.characteristics[r.category],r.name),r.name)
  for(const c of loadBunkerData().challenges){
    assert.ok(Object.hasOwn(c.kind==='condition'?m.conditions:m.challenges,c.id),c.id)
    if(c.kind!=='condition')assert.deepEqual(c.requirements.flat().sort(),Object.keys(c.capabilityRequirements).sort())
  }
  for(const rows of Object.values(m.characteristics))for(const v of Object.values(rows))for(const n of Object.values(v))assert.ok(n<100)
  for(const [old,canonical]of Object.entries(m.aliases)){assert.ok(!m.dimensions[old]);assert.ok(m.dimensions[canonical])}
  for(const tag of Object.keys(m.dimensions))assert.ok(Object.values(m.challenges).some(v=>v[tag]),tag+' нигде не нужен')
  for(const v of Object.values(m.challenges))for(const [tag,required]of Object.entries(v)){
    const sources=[...Object.values(m.characteristics).flatMap(Object.values),...Object.values(m.conditions),...Object.values(m.biology)].map(v=>v[tag]||0).sort((a,b)=>b-a)
    assert.ok(sources.slice(0,3).reduce((a,b)=>a+b,0)>=required,tag+' невозможно набрать')
  }
})

test('неверная матрица отклоняется',()=>{
  for(const value of [-1,0,101,NaN]){const x=structuredClone(m);x.characteristics['Багаж']['Аптечка'].medical=value;assert.throws(()=>validateMatrix(x))}
  const x=structuredClone(m);x.challenges.cat_001.invented=20;assert.throws(()=>validateMatrix(x))
})

test('катастрофы имеют основной порог 100; исправленные сюжеты требуют осмысленные шкалы',()=>{
  for (const e of loadBunkerData().challenges.filter(c=>c.kind==='catastrophe'))
    assert.equal(Math.max(...Object.values(e.capabilityRequirements)),100,e.id)
  assert.equal(m.challenges.cat_001.biology,100)
  assert.equal(m.challenges.cat_001.psychology,undefined)
  assert.equal(m.challenges.cat_013.water,45)
  assert.equal(m.challenges.cat_013.agriculture,undefined)
  assert.equal(m.challenges.threat_034.ventilation,45)
  assert.equal(m.challenges.threat_034.cold,undefined)
  assert.deepEqual(m.conditions.condition_30,{medical:30})
  assert.deepEqual(m.conditions.condition_38,{navigation:30})
})

test('аптечка, книга, хобби и врач не эквивалентны; теги не дают неявные 100%',()=>{
  assert.equal(characteristicCapabilities(ch('Багаж','Аптечка')).medical,20)
  assert.equal(characteristicCapabilities(ch('Багаж','Справочник по неотложной медицине')).medical,15)
  assert.equal(characteristicCapabilities(ch('Хобби','Первая помощь')).medical,30)
  assert.equal(characteristicCapabilities(ch('Профессия','Врач общей практики')).medical,70)
  assert.deepEqual(characteristicCapabilities({...ch('Здоровье','Идеально здоров'),tags:['medical']}),{})
  assert.deepEqual(characteristicCapabilities({...ch('Багаж','Неизвестная вещь'),tags:['medical']}),{})
})

test('масштабирование по выжившим, два багажа складываются, условия не делятся и не дублируются',()=>{
  const p=player('p',[ch('Багаж','Аптечка'),{...ch('Багаж','Запас антибиотиков'),occ:1}])
  const dead={...player('dead',[ch('Профессия','Врач общей практики')]),isAlive:false}
  const three=[p,player('2'),player('3'),dead]
  assert.equal(teamDivisor(1),1);assert.equal(teamDivisor(3),1)
  const conditions=[{id:'condition_30',title:'Медицинский запас'},{id:'condition_30',title:'Медицинский запас'}]
  assert.equal(buildCapabilityTeam(three,conditions).values.medical,80)
  const six=[...three,player('4'),player('5'),player('6')]
  const result=buildCapabilityTeam(six,conditions)
  assert.ok(Math.abs(result.divisor-Math.pow(2,.65))<1e-12)
  assert.ok(Math.abs(result.values.medical-(50/Math.pow(2,.65)+30))<1e-12)
  assert.ok(result.sources.medical.every(s=>!s.source.startsWith('dead')))
})

test('уникальное бесплодие: максимум 100%, без делителя, лечение и андроид',()=>{
  const people=Array.from({length:8},(_,i)=>player('p'+i));people[0].biology.age=70;people[1].biology.infertile=true
  assert.equal(buildCapabilityTeam(people,[]).values.reproductive_edge,100)
  people[0].biology.fertilityRestored=true;people[1].biology.infertile=false
  assert.equal(buildCapabilityTeam(people,[]).values.reproductive_edge,0)
  assert.deepEqual(biologyCapabilities({...people[0].biology,sex:'Андроид'}),m.biology.android)
})

test('пандемия: медицина важнее вторичных шкал, переполнение не возмещает нехватку',()=>{
  const req=m.challenges.cat_005
  assert.equal(req.medical,100)
  const a=capabilityCoverage(req,{medical:80,infectious:50,ppe:55,biology:25})
  assert.ok(Math.abs(capabilityDeficit(a)-50/260)<1e-12)
  assert.ok(capabilityDeficit(capabilityCoverage(req,{medical:1000}))>0)
  assert.equal(capabilityDeficit(capabilityCoverage(req,{...req})),0)
})

test('итог: реальные вклады, непрерывный штраф, полный успех, оба режима одинаковы',()=>{
  const p=player('p')
  const state=bunker('cat_005')
  const none=calculateSurvival([p],state).challenges[0]
  assert.equal(none.delta,-24)
  p.characteristics.push(ch('Багаж','Аптечка'))
  const kit=calculateSurvival([p],state).challenges[0]
  assert.ok(kit.delta>none.delta&&kit.delta<0)
  p.characteristics.push(ch('Профессия','Инфекционист'),ch('Хобби','Первая помощь'),ch('Багаж','Комплект СИЗ-3'))
  const full=calculateSurvival([p,player('2'),player('3')],state)
  assert.equal(full.challenges[0].success,true);assert.equal(full.challenges[0].delta,7)
  assert.deepEqual(full,calculateSurvival([p,player('2'),player('3')],state,'new'))
  assert.ok(Number.isInteger(full.chance)&&full.chance>=0&&full.chance<=100)
})

test('UI публикует только пороги, не скрытые вклады команды',()=>{
  const pub=toPublicChallenge(event('cat_005').text)
  assert.equal(pub.capabilityRequirements.find(r=>r.tag==='medical').percent,100)
  assert.ok(!JSON.stringify(pub).includes('available'))
  const state=toPublicBunker(bunker('cat_005',[{text:event('condition_30').text,byPlayerId:'p',byName:'p'}]))
  assert.equal(state.conditions[0].capabilityGrants.find(r=>r.tag==='medical').percent,30)
})

test('здоровье/базовые нужды: маленькая аптечка не заменяет врача',()=>{
  const p=player('p',[{...ch('Здоровье','Астма'),coef:-.15,tags:['critical']}])
  const state=bunker('')
  const before=calculateSurvival([p],state).factors.find(f=>f.id==='health').delta
  p.characteristics.push(ch('Багаж','Аптечка'))
  assert.equal(calculateSurvival([p],state).factors.find(f=>f.id==='health').delta,before)
  p.characteristics.push(ch('Профессия','Врач общей практики'))
  assert.ok(calculateSurvival([p],state).factors.find(f=>f.id==='health').delta>before)
})
