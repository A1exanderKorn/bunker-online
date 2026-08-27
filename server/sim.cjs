// Monte-Carlo симуляция выживания в бункере.
// Использует реальную игровую логику из dist/.
const { dealCharacteristics } = require('./dist/server/characteristics.js')
const { calculateSurvival } = require('./dist/server/survival.js')
const { pickCatastrophe, threatQueue, loadBunkerData } = require('./dist/server/bunker.js')

const N = Number(process.argv[2] || 10000)
const NUM_PLAYERS = 6
const CHOOSE = 3
const NUM_THREATS = 2

function makePlayers(n) {
  const players = []
  for (let i = 0; i < n; i++) {
    players.push({
      id: `p${i}`, clientId: `c${i}`, name: `P${i}`,
      isAlive: true, connected: true, characteristics: [],
    })
  }
  dealCharacteristics(players, {})
  return players
}

// Все C(6,3)=20 подмножеств из 3 игроков.
function combinations(arr, k) {
  const res = []
  const rec = (start, combo) => {
    if (combo.length === k) { res.push(combo.slice()); return }
    for (let i = start; i < arr.length; i++) { combo.push(arr[i]); rec(i + 1, combo); combo.pop() }
  }
  rec(0, [])
  return res
}

function chanceFor(subset, bunker) {
  // survival учитывает только isAlive-игроков — выставим флаги на копиях-ссылках.
  const alive = new Set(subset)
  const all = subset // передаём только выбранных; все они живые
  return calculateSurvival(all, bunker).chance
}

function pickRandom(players, k) {
  const idx = [...players.keys()]
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  return idx.slice(0, k).map((i) => players[i])
}

const data = loadBunkerData()
console.log(`Данные: катастроф=${data.catastrophes.length}, угроз=${data.threats.length}, условий=${data.conditions.length}`)
console.log(`Симуляция: N=${N}, игроков=${NUM_PLAYERS}, выбираем=${CHOOSE}, угроз=${NUM_THREATS}\n`)

let sumOpt = 0, sumRand = 0
let survOpt = 0, survRand = 0 // «выжил» = chance >= 50 (условный порог)
const distOpt = {}, distRand = {}
const optChances = [], randChances = []
// Diagnostics: сколько раз оптимум == 100 или == 0
let opt100 = 0, opt0 = 0, rand100 = 0, rand0 = 0

for (let iter = 0; iter < N; iter++) {
  const players = makePlayers(NUM_PLAYERS)
  const catastrophe = pickCatastrophe()
  const threats = threatQueue(NUM_THREATS)
  const bunker = { catastrophe, years: 1, threats, conditions: [] }

  // Оптимальный выбор 3 из 6
  const combos = combinations(players, CHOOSE)
  let best = -1
  for (const combo of combos) {
    const ch = chanceFor(combo, bunker)
    if (ch > best) best = ch
  }
  sumOpt += best
  optChances.push(best)
  if (best >= 50) survOpt++
  if (best === 100) opt100++
  if (best === 0) opt0++
  const bOptBucket = Math.floor(best / 10) * 10
  distOpt[bOptBucket] = (distOpt[bOptBucket] || 0) + 1

  // Случайный выбор 3 из 6
  const rnd = pickRandom(players, CHOOSE)
  const rndChance = chanceFor(rnd, bunker)
  sumRand += rndChance
  randChances.push(rndChance)
  if (rndChance >= 50) survRand++
  if (rndChance === 100) rand100++
  if (rndChance === 0) rand0++
  const rBucket = Math.floor(rndChance / 10) * 10
  distRand[rBucket] = (distRand[rBucket] || 0) + 1
}

function pct(x) { return (x / N * 100).toFixed(1) + '%' }
function median(a) { const s=[...a].sort((x,y)=>x-y); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2 }
function printDist(dist, label) {
  console.log(`\nРаспределение шанса (${label}):`)
  for (let b = 0; b <= 100; b += 10) {
    const c = dist[b] || 0
    const bar = '#'.repeat(Math.round(c / N * 50))
    console.log(`  ${String(b).padStart(3)}-${String(Math.min(b+9,100)).padStart(3)}: ${String(c).padStart(6)} ${pct(c).padStart(6)} ${bar}`)
  }
}

console.log('=== РЕЗУЛЬТАТЫ ===')
console.log(`Средний шанс (оптимальные 3): ${(sumOpt / N).toFixed(1)}%  | медиана ${median(optChances)}%`)
console.log(`Средний шанс (случайные 3):   ${(sumRand / N).toFixed(1)}%  | медиана ${median(randChances)}%`)
console.log(`Доля игр с шансом >=50% (опт): ${pct(survOpt)}`)
console.log(`Доля игр с шансом >=50% (рнд): ${pct(survRand)}`)
console.log(`Оптимум = 100%: ${pct(opt100)}, = 0%: ${pct(opt0)}`)
console.log(`Случайный = 100%: ${pct(rand100)}, = 0%: ${pct(rand0)}`)
printDist(distOpt, 'оптимальные 3')
printDist(distRand, 'случайные 3')
