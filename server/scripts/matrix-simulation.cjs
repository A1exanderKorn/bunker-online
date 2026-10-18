// Диагностика, не игровой балансировщик. Требует npm --prefix server run build.
const fs=require('node:fs'),path=require('node:path')
const {loadCharacteristics}=require('../dist/server/data')
const {loadBunkerData}=require('../dist/server/bunker')
const {dealCharacteristics}=require('../dist/server/characteristics')
const {calculateSurvival}=require('../dist/server/survival')
const {buildCapabilityTeam,characteristicCapabilities,capabilityCoverage,capabilityDeficit}=require('../dist/server/capabilityMatrix')
const makePlayer=id=>({id,name:id,clientId:id,isAlive:true,connected:true,characteristics:[],biology:{sex:'М',age:30,experience:10,infertile:false,coef:.8,isVisible:false}})
const asChar=r=>({type:r.category,value:r.name,coef:r.coef,tags:r.tags,isVisible:false})
const events=loadBunkerData().challenges.filter(c=>c.kind!=='condition')
const candidates=loadCharacteristics()
// Конструктивная проверка: собрать команду из трёх, не повторяя названия в категории.
const unmet=[]
for(const event of events){
  const players=Array.from({length:3},(_,i)=>makePlayer('g'+i)),used=new Set()
  if(event.id==='threat_004')players[0].biology.infertile=true
  for(const category of ['Профессия','Хобби','Багаж','Багаж','Факт'])for(const p of players){
    const before=buildCapabilityTeam(players,[]).values
    let best=null,score=Infinity
    for(const r of candidates.filter(r=>r.category===category&&!used.has(category+'/'+r.name))){
      const after={...before};for(const [t,n]of Object.entries(characteristicCapabilities(asChar(r))))after[t]=(after[t]||0)+n
      const loss=capabilityDeficit(capabilityCoverage(event.capabilityRequirements,after))
      if(loss<score){score=loss;best=r}
    }
    if(best){p.characteristics.push(asChar(best));used.add(category+'/'+best.name)}
  }
  const loss=capabilityDeficit(capabilityCoverage(event.capabilityRequirements,buildCapabilityTeam(players,[]).values))
  if(loss>1e-9)unmet.push({id:event.id,deficit:Math.round(loss*1000)/10})
}
let seed=1501026;const original=Math.random
Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
const rows=[]
try {
  for(const n of [6,8]) {
    const randomChances=[],bestChances=[],deficits=[]
    for(let trial=0;trial<60;trial++){
      const players=Array.from({length:n},(_,i)=>makePlayer('p'+i))
      dealCharacteristics(players,{gameMode:'new',targetCoef:.5,extraBaggage:true})
      const cats=events.filter(e=>e.kind==='catastrophe'),threats=events.filter(e=>e.kind==='threat')
      const catastrophe=cats[trial%cats.length],start=(trial*7)%threats.length
      const bunker={catastrophe:catastrophe.text,threats:[threats[start].text,threats[(start+19)%threats.length].text],conditions:[],years:3}
      const k=n/2,reports=[]
      const choose=(ids,next)=>{if(ids.length===k){const chosen=new Set(ids);reports.push(calculateSurvival(players.map((p,i)=>({...p,isAlive:chosen.has(i)})),bunker));return}for(let i=next;i<n;i++)choose([...ids,i],i+1)}
      choose([],0)
      randomChances.push(reports[0].chance)
      const best=reports.reduce((a,b)=>a.chance>=b.chance?a:b)
      bestChances.push(best.chance)
      deficits.push(best.challenges.reduce((s,c)=>s+capabilityDeficit(c.coverage||[]),0)/3)
    }
    const mean=a=>Math.round(a.reduce((s,n)=>s+n,0)/a.length*10)/10
    rows.push({n,trials:60,randomMean:mean(randomChances),bestMean:mean(bestChances),bestMin:Math.min(...bestChances),bestMax:Math.max(...bestChances),meanEventDeficit:mean(deficits.map(n=>n*100))})
  }
} finally {Math.random=original}
const result={seed:1501026,mode:'new',targetCoef:.5,extraBaggage:true,conditions:0,threats:2,constructiveUnmet:unmet,samples:rows}
const out=path.join(__dirname,'../../reports/matrix/matrix-simulation.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2))
