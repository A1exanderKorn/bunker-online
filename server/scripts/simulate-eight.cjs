// Reproducible 8 -> 4 simulation using the real dealer and survival calculator.
// node server/scripts/simulate-eight.cjs [label] [trials] [seed]
const fs = require('node:fs'), path = require('node:path')
const { dealCharacteristics } = require('../dist/server/characteristics')
const { loadBunkerData } = require('../dist/server/bunker')
const { calculateSurvival } = require('../dist/server/survival')
const label = process.argv[2] || 'current', trials = Number(process.argv[3] || 1000), initialSeed = Number(process.argv[4] || 18102026)
let seed = initialSeed
const original = Math.random
const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
const combinations = []
function choose(ids, next) { if (ids.length === 4) { combinations.push(ids); return } for (let i = next; i < 8; i++) choose([...ids, i], i + 1) }
choose([], 0)
const data = loadBunkerData().challenges
const cats = data.filter(c => c.kind === 'catastrophe'), threats = data.filter(c => c.kind === 'threat')
const results = { random: [], best: [] }, events = {}
const raw = r => r.baseChance + r.factors.reduce((s, f) => s + f.delta, 0) + r.challenges.reduce((s, c) => s + c.delta, 0)
Math.random = random
try {
  for (let trial = 0; trial < trials; trial++) {
    const players = Array.from({ length: 8 }, (_, i) => ({ id: 'p' + i, name: 'p' + i, clientId: 'p' + i, connected: true, isAlive: true, characteristics: [], biology: null }))
    dealCharacteristics(players, { gameMode: 'new', targetCoef: .5, extraBaggage: true, noPhobias: false })
    const cat = cats[Math.floor(random() * cats.length)]
    const pool = [...threats], selected = [cat]
    for (let i = 0; i < 2; i++) selected.push(pool.splice(Math.floor(random() * pool.length), 1)[0])
    const bunker = { catastrophe: cat.text, threats: selected.slice(1).map(c => c.text), conditions: [], years: 0 }
    const randomIndex = Math.floor(random() * combinations.length)
    const reports = combinations.map(ids => calculateSurvival(players.map((p, i) => ({ ...p, isAlive: ids.includes(i) })), bunker, 'new'))
    const best = reports.reduce((a, b) => raw(a) >= raw(b) ? a : b)
    for (const [strategy, report] of Object.entries({ random: reports[randomIndex], best })) {
      results[strategy].push(report)
      report.challenges.forEach((c, i) => {
        const e = selected[i], key = strategy + '/' + e.id
        const row = events[key] ||= { strategy, id: e.id, title: e.title, kind: e.kind, failureDelta: e.failureDelta, n: 0, delta: 0, deficit: 0, solved: 0 }
        row.n++; row.delta += c.delta; row.solved += Number(c.success)
        const required = c.coverage.reduce((s, x) => s + x.required, 0)
        row.deficit += required ? c.coverage.reduce((s, x) => s + x.missing, 0) / required : 0
      })
    }
  }
} finally { Math.random = original }
const mean = a => a.reduce((s, x) => s + x, 0) / a.length
const round = x => Math.round(x * 100) / 100
const summarize = reports => {
  const chances = reports.map(r => r.chance), sorted = [...chances].sort((a, b) => a - b), avg = mean(chances)
  const factors = [...reports[0].factors.map(f => f.id), 'catastrophe', 'threats']
  if (!factors.includes('bunker_assistance')) factors.push('bunker_assistance')
  const delta = (r, key) => key === 'catastrophe' ? r.challenges[0].delta : key === 'threats' ? r.challenges.slice(1).reduce((s, c) => s + c.delta, 0) : (r.factors.find(f => f.id === key)?.delta || 0)
  return { mean: round(avg), meanRaw: round(mean(reports.map(raw))), ci95HalfWidth: round(1.96 * Math.sqrt(mean(chances.map(x => (x - avg) ** 2)) / trials)), median: sorted[Math.floor(trials / 2)], p10: sorted[Math.floor(trials * .1)], p90: sorted[Math.floor(trials * .9)], zeroPercent: round(chances.filter(x => x === 0).length / trials * 100), base: reports[0].baseChance,
    factors: Object.fromEntries(factors.map(key => [key, { net: round(mean(reports.map(r => delta(r, key)))), penalties: round(mean(reports.map(r => Math.min(0, delta(r, key))))) }])) }
}
const output = { label, trials, seed: initialSeed, settings: { players: 8, survivors: 4, mode: 'new', targetCoef: .5, extraBaggage: true, threats: 2, conditions: 0, actionCards: false, best: 'all 70 whole-player combinations, full information' }, results: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, summarize(v)])), events: Object.values(events).map(e => ({ ...e, delta: round(e.delta / e.n), deficit: round(e.deficit / e.n * 100), solved: round(e.solved / e.n * 100) })).sort((a, b) => a.delta - b.delta) }
const dir = path.join(__dirname, '../../reports/matrix'); fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(path.join(dir, 'eight-' + label.replace(/[^a-z0-9-]/gi, '') + '.json'), JSON.stringify(output, null, 2))
console.log(JSON.stringify({ ...output, events: output.events.filter(e => e.strategy === 'best' && e.kind === 'catastrophe') }, null, 2))
