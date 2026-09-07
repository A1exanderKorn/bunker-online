const fs = require('node:fs')
const path = require('node:path')

const serverDir = path.resolve(__dirname, '..')
const dataDir = process.env.DATA_DIR || path.join(serverDir, 'data')

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, relativePath), 'utf8'))
}

function loadCharacteristics() {
  const index = readJson(path.join('characteristics', 'index.json'))
  const items = []
  for (const slot of index.slots) {
    if (!slot.file) continue
    const file = readJson(path.join('characteristics', slot.file))
    const category = file.category || slot.category
    for (const item of file.items ?? []) {
      if (!String(item.name ?? '').trim()) continue
      items.push({
        category,
        name: String(item.name).trim(),
        coef: Number(item.coef) || 0,
        tags: Array.isArray(item.tags) ? item.tags : [],
      })
    }
  }
  return items
}

function loadBunkerKind(kind, fileName) {
  return (readJson(path.join('bunker', fileName)).items ?? [])
    .filter((item) => String(item.text ?? '').trim())
    .map((item) => ({
      id: String(item.id ?? ''),
      kind,
      text: String(item.text).trim(),
      groups: Array.isArray(item.requirements) ? item.requirements : [],
      grants: Array.isArray(item.grants) ? item.grants : [],
    }))
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const characteristics = loadCharacteristics()
characteristics.push({
  category: 'Биология',
  name: 'Бесплодие; также Ж старше 50 лет или М старше 60 лет',
  coef: null,
  tags: ['reproductive_edge'],
})

const conditionRows = loadBunkerKind('condition', 'conditions.json')
const conditions = conditionRows.map((row) => ({ text: row.text, tags: row.grants }))
const challenges = [
  ...loadBunkerKind('catastrophe', 'catastrophes.json'),
  ...loadBunkerKind('threat', 'threats.json'),
]

function sourceList(group) {
  const characteristicSources = characteristics
    .map((item) => ({ ...item, matches: item.tags.filter((tag) => group.includes(tag)) }))
    .filter((item) => item.matches.length)
    .sort((a, b) => (b.coef ?? -1) - (a.coef ?? -1) || a.category.localeCompare(b.category, 'ru'))
  const conditionSources = conditions
    .map((item) => ({ ...item, matches: item.tags.filter((tag) => group.includes(tag)) }))
    .filter((item) => item.matches.length)
  return { characteristicSources, conditionSources }
}

function sourceRows(items) {
  if (!items.length) return '<li class="empty">Нет источников</li>'
  return items.map((item) => `
    <li>
      <span class="source-main">${escapeHtml(item.category ? `${item.category}: ${item.name}` : item.text)}</span>
      ${item.category
        ? item.coef === null
          ? '<span class="condition-mark">правило биологии</span>'
          : `<span class="coef">КФ ${item.coef.toFixed(2)}</span>`
        : '<span class="condition-mark">доп. условие</span>'}
      <span class="tags">${item.matches.map((tag) => `<code>${escapeHtml(tag)}</code>`).join(' ')}</span>
    </li>`).join('')
}

function groupMarkup(group, index) {
  const sources = sourceList(group)
  const empty = sources.characteristicSources.length === 0 && sources.conditionSources.length === 0
  return `
    <section class="requirement-group${empty ? ' uncovered' : ''}">
      <h3>Группа ${index + 1}: ${group.map((tag) => `<code>${escapeHtml(tag)}</code>`).join(' или ')}</h3>
      <div class="source-section">
        <h4>Характеристики <span>${sources.characteristicSources.length}</span></h4>
        <ul>${sourceRows(sources.characteristicSources)}</ul>
      </div>
      <div class="source-section">
        <h4>Дополнительные условия <span>${sources.conditionSources.length}</span></h4>
        <ul>${sourceRows(sources.conditionSources)}</ul>
      </div>
    </section>`
}

const cards = challenges.map((challenge) => {
  const groups = challenge.groups.length
    ? challenge.groups.map(groupMarkup).join('')
    : '<p class="no-requirements">Требования отсутствуют — событие закрывается автоматически.</p>'
  const searchable = [challenge.id, challenge.text, ...challenge.groups.flat()].join(' ').toLocaleLowerCase('ru-RU')
  return `
  <article class="challenge" data-kind="${challenge.kind}" data-search="${escapeHtml(searchable)}">
    <header>
      <span class="kind">${challenge.kind === 'catastrophe' ? 'Катастрофа' : 'Угроза'}</span>
      <code>${escapeHtml(challenge.id)}</code>
    </header>
    <h2>${escapeHtml(challenge.text)}</h2>
    <div class="groups groups-${Math.min(challenge.groups.length, 3)}">${groups}</div>
  </article>`
}).join('')

const generatedAt = new Date().toISOString().slice(0, 16).replace('T', ' ')
const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Покрытие катастроф и угроз</title>
  <style>
    :root { color-scheme: dark; --bg:#10141c; --panel:#171d28; --panel2:#202838; --text:#edf2fb; --muted:#9ea9bb; --line:#344055; --accent:#69a6ff; --cat:#e06c75; --threat:#e5b567; --ok:#78c091; --bad:#ff7b72; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
    main { width:min(1500px,100%); margin:0 auto; padding:28px clamp(14px,3vw,40px) 56px; }
    h1 { margin:0 0 6px; font-size:clamp(24px,4vw,38px); }
    .intro { margin:0 0 20px; color:var(--muted); }
    .toolbar { position:sticky; top:0; z-index:5; display:flex; flex-wrap:wrap; gap:10px; align-items:center; padding:12px 0; background:color-mix(in srgb,var(--bg) 92%,transparent); backdrop-filter:blur(8px); }
    input,button { min-height:40px; border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--text); padding:8px 12px; font:inherit; }
    input { flex:1 1 280px; }
    button { cursor:pointer; }
    button.active { border-color:var(--accent); background:color-mix(in srgb,var(--accent) 16%,var(--panel)); }
    .count { margin-left:auto; color:var(--muted); font-variant-numeric:tabular-nums; }
    .challenge { margin:16px 0; padding:18px; border:1px solid var(--line); border-left:5px solid var(--threat); border-radius:14px; background:var(--panel); }
    .challenge[data-kind="catastrophe"] { border-left-color:var(--cat); }
    .challenge > header { display:flex; justify-content:space-between; gap:12px; color:var(--muted); }
    .challenge > h2 { margin:8px 0 15px; font-size:18px; font-weight:650; }
    .kind { text-transform:uppercase; letter-spacing:.08em; font-size:12px; font-weight:700; }
    .groups { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr)); gap:12px; align-items:start; }
    .requirement-group { min-width:0; padding:13px; border-radius:10px; background:var(--panel2); }
    .requirement-group.uncovered { box-shadow:inset 0 0 0 2px var(--bad); }
    h3,h4 { margin:0; }
    h3 { font-size:14px; font-weight:650; }
    h4 { display:flex; justify-content:space-between; margin-top:13px; color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; }
    ul { list-style:none; margin:5px 0 0; padding:0; }
    li { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:2px 10px; padding:7px 0; border-top:1px solid var(--line); }
    .source-main { min-width:0; overflow-wrap:anywhere; }
    .coef,.condition-mark { color:var(--ok); white-space:nowrap; font-variant-numeric:tabular-nums; }
    .tags { grid-column:1/-1; color:var(--muted); }
    code { color:var(--accent); font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:.92em; }
    .empty,.no-requirements { color:var(--muted); }
    .empty { display:block; }
    [hidden] { display:none !important; }
    @media (max-width:600px) { main{padding-top:18px}.count{width:100%;margin-left:0}.challenge{padding:14px}.challenge>h2{font-size:16px} }
  </style>
</head>
<body>
  <main>
    <h1>Покрытие катастроф и угроз</h1>
    <p class="intro">Каждая группа обязательна; внутри группы достаточно одного тега. Источники отсортированы по КФ. Сформировано ${generatedAt} UTC из server/data.</p>
    <div class="toolbar" aria-label="Фильтры">
      <input id="search" type="search" placeholder="Текст, id или тег…" aria-label="Поиск">
      <button type="button" class="active" data-filter="all">Все</button>
      <button type="button" data-filter="catastrophe">Катастрофы</button>
      <button type="button" data-filter="threat">Угрозы</button>
      <span class="count" id="count" aria-live="polite"></span>
    </div>
    <section id="cards">${cards}</section>
  </main>
  <script>
    const search = document.getElementById('search')
    const count = document.getElementById('count')
    const buttons = [...document.querySelectorAll('[data-filter]')]
    const cards = [...document.querySelectorAll('.challenge')]
    let filter = 'all'
    function update() {
      const query = search.value.trim().toLocaleLowerCase('ru-RU')
      let visible = 0
      for (const card of cards) {
        const show = (filter === 'all' || card.dataset.kind === filter) && (!query || card.dataset.search.includes(query))
        card.hidden = !show
        if (show) visible += 1
      }
      count.textContent = 'Показано: ' + visible + ' из ' + cards.length
    }
    search.addEventListener('input', update)
    for (const button of buttons) button.addEventListener('click', () => {
      filter = button.dataset.filter
      for (const item of buttons) item.classList.toggle('active', item === button)
      update()
    })
    update()
  </script>
</body>
</html>`

const outputDir = path.resolve(serverDir, '..', 'reports')
fs.mkdirSync(outputDir, { recursive: true })
const outputPath = path.join(outputDir, 'survival-coverage.html')
fs.writeFileSync(outputPath, html, 'utf8')
console.log(`Создан ${outputPath}: ${challenges.length} событий`)
