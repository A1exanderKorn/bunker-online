/**
 * Собирает колоды нового режима из .cursor/4-новый-режим.md и текущих JSON.
 * Запуск: node server/scripts/build-new-mode.mjs
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', '..')
const specPath = path.join(root, '.cursor', '4-новый-режим.md')
const dataDir = path.join(root, 'server', 'data')
const outChars = path.join(dataDir, 'characteristics-new')
const outBunker = path.join(dataDir, 'bunker-new')

const RETAGS = {
  Инфекционист: { from: 'protection', to: 'ppe' },
  Эпидемиолог: { from: 'protection', to: 'ppe' },
  Аптечка: { remove: 'protection' },
  'Коробка респираторов': { from: 'protection', to: 'ppe' },
  Противогаз: { from: 'protection', to: 'ppe' },
  'Запас хозяйственного мыла': { from: 'protection', to: 'ppe' },
  'Комплект спальных мешков': { add: ['cold'] },
  'Работал на полярной станции': { add: ['cold'] },
  Президент: { add: ['diplomacy'] },
  Переводчик: { add: ['diplomacy'] },
  Психотерапевт: { add: ['diplomacy'] },
  Адвокат: { add: ['diplomacy'] },
}

const OLD_NAME = {
  Онкология: 'Рак легких',
  ВИЧ: 'Вич',
  Туберкулёз: 'Туберкулез',
}

const STAGED = {
  Онкология: { staged: true, stages: ['ранняя', 'средняя', 'терминальная (4 стадия)'] },
  'Почечная недостаточность': { staged: true, stages: [] },
  'Сердечная недостаточность': { staged: true, stages: [] },
  'Болезнь Альцгеймера': { staged: true, stages: ['ранняя', 'средняя', 'терминальная (деменция)'] },
  Цирроз: { staged: true, stages: ['компенсированный', 'субкомпенсированный', 'декомпенсированный'] },
  'Сахарный диабет': { staged: true, stages: [] },
  'Гепатит C': { staged: true, stages: [] },
  ВИЧ: { staged: true, stages: ['ранняя', 'средняя', 'терминальная (СПИД)'] },
  Туберкулёз: { staged: true, stages: ['ранняя', 'средняя', 'терминальная (открытая форма)'] },
  Сифилис: { staged: true, stages: ['первичный', 'вторичный', 'третичный'] },
  Псориаз: { staged: true, stages: ['ранняя', 'средняя', 'терминальная (тяжёлый)'] },
  'Язва желудка': { staged: true, stages: ['ранняя', 'средняя', 'терминальная (кровотечение)'] },
  Эпилепсия: { staged: true, stages: ['ранняя', 'средняя', 'терминальная (неконтролируемая)'] },
}

const TAG_LABELS = JSON.parse(fs.readFileSync(path.join(dataDir, 'tag-labels.json'), 'utf8'))
const TAG_LABELS_NEW = {
  ...TAG_LABELS,
  protection: 'физическая защита',
  ppe: 'противоэпидемическая защита',
  cold: 'холод и тепло',
  diplomacy: 'дипломатия и убеждение',
}

function parseCoef(raw) {
  const s = String(raw ?? '')
    .replace(/\*\*/g, '')
    .replace(/[−–]/g, '-')
    .trim()
  if (!s || s === '—' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function parseTags(raw) {
  const s = String(raw ?? '').trim()
  if (!s || s === '—' || s === '-') return []
  return s.split(',').map((t) => t.trim()).filter(Boolean)
}

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split('|').map((c) => c.trim())
}

function isSep(line) {
  return /^\|[\s:|-]+\|/.test(line.trim()) && /---/.test(line)
}

function tablesIn(md, startMarker, endMarker) {
  const start = md.indexOf(startMarker)
  const end = endMarker ? md.indexOf(endMarker, start + startMarker.length) : md.length
  if (start < 0) throw new Error(`Не найден блок ${startMarker}`)
  return md.slice(start, end < 0 ? md.length : end)
}

function parseTables(block) {
  const lines = block.split(/\r?\n/)
  const tables = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].startsWith('|') && i + 1 < lines.length && isSep(lines[i + 1])) {
      const header = splitRow(lines[i])
      i += 2
      const rows = []
      while (i < lines.length && lines[i].startsWith('|') && !isSep(lines[i])) {
        rows.push(splitRow(lines[i]))
        i += 1
      }
      tables.push({ header, rows })
      continue
    }
    i += 1
  }
  return tables
}

function loadOld(file) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, 'characteristics', file), 'utf8'))
}

function applyRetag(name, tags) {
  const rule = RETAGS[name]
  if (!rule) return [...tags]
  let next = [...tags]
  if (rule.from && rule.to) next = next.map((t) => (t === rule.from ? rule.to : t))
  if (rule.remove) next = next.filter((t) => t !== rule.remove)
  if (rule.add) {
    for (const t of rule.add) if (!next.includes(t)) next.push(t)
  }
  return next
}

function oldLookup(items) {
  const map = new Map()
  for (const item of items) {
    const name = item.name
    if (!map.has(name)) map.set(name, item)
  }
  return map
}

function collectNewMeta(md) {
  const block = tablesIn(md, '## Новые карты', '## Итоговый список колоды нового режима')
  const meta = new Map()
  for (const table of parseTables(block)) {
    const h = table.header.map((x) => x.toLowerCase())
    const nameI = h.findIndex((x) => x.startsWith('имя'))
    const tagsI = h.findIndex((x) => x.startsWith('тег'))
    const hintI = h.findIndex((x) => x.startsWith('hint'))
    if (nameI < 0) continue
    for (const row of table.rows) {
      const name = row[nameI]
      if (!name) continue
      meta.set(name, {
        tags: tagsI >= 0 ? parseTags(row[tagsI]) : [],
        hint: hintI >= 0 ? String(row[hintI] ?? '').replace(/^—$/, '').trim() : '',
      })
    }
  }
  return meta
}

function parseNewSectionRows(md, heading, endHeading) {
  const block = tablesIn(md, heading, endHeading)
  const rows = []
  for (const table of parseTables(block)) {
    const h = table.header.map((x) => x.toLowerCase())
    const nameI = h.findIndex((x) => x.startsWith('имя'))
    const coefI = h.findIndex((x) => x === 'кф' || x.startsWith('кф'))
    const tagsI = h.findIndex((x) => x.startsWith('тег'))
    const hintI = h.findIndex((x) => x.startsWith('hint'))
    if (nameI < 0 || coefI < 0) continue
    for (const row of table.rows) {
      const name = row[nameI]
      const coef = parseCoef(row[coefI])
      if (!name || coef == null) continue
      rows.push({
        name,
        coef,
        tags: tagsI >= 0 ? parseTags(row[tagsI]) : [],
        hint: hintI >= 0 ? String(row[hintI] ?? '').replace(/^—$/, '').trim() : '',
      })
    }
  }
  return rows
}

function parseFinalCategory(md, heading, colCount) {
  const nextHeadings = [
    '### Профессия (153)',
    '### Здоровье (100)',
    '### Хобби (113)',
    '### Фобия (111)',
    '### Багаж (174)',
    '### Факт (101)',
    '## Алгоритм сборки',
  ]
  const idx = nextHeadings.indexOf(heading)
  const end = nextHeadings[idx + 1]
  const block = tablesIn(md, heading, end)
  const tables = parseTables(block)
  const rows = []
  for (const table of tables) {
    if (table.header[0] !== 'Имя') continue
    for (const row of table.rows) {
      if (row.length < 4) continue
      rows.push({
        name: row[0],
        source: row[1],
        oldCoef: parseCoef(row[2]),
        coef: parseCoef(row[3]),
        hint: colCount >= 5 ? String(row[4] ?? '').trim() : '',
      })
    }
  }
  return rows
}

function labelTag(tag) {
  return TAG_LABELS_NEW[tag] ?? tag
}

function solutionTail(requirements) {
  if (!requirements.length) return ''
  if (requirements.length === 1) {
    const g = requirements[0]
    return ` Для решения подойдёт: ${g.map(labelTag).join(' или ')}.`
  }
  const parts = requirements.map((g, i) => `${i + 1}) ${g.map(labelTag).join(' или ')}`)
  return ` Для решения нужны одновременно: ${parts.join('; ')}.`
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

function buildCategory(specRows, oldFile, category, newMeta) {
  const oldItems = oldLookup(loadOld(oldFile).items)
  const items = []
  for (const row of specRows) {
    if (row.coef == null) throw new Error(`${category}: нет КФ у ${row.name}`)
    const isNew = String(row.source).startsWith('новая')
    const oldName = OLD_NAME[row.name] || row.name.replace(/ →.*$/, '')
    const specName = row.name.includes('→') ? row.name.split('→').pop().replace(/\*\*/g, '').trim() : row.name
    const old = oldItems.get(oldName) || oldItems.get(specName)
    let tags = []
    let hint = ''
    if (isNew) {
      const meta = newMeta.get(specName) || {}
      tags = meta.tags || []
      const dirtyHint = /staged|тег|ppe|cold|infectious/i.test(row.hint || '')
      hint = !dirtyHint && row.hint && !row.hint.startsWith('staged') && !row.hint.startsWith('не staged')
        ? row.hint
        : meta.hint || ''
    } else {
      tags = [...(old?.tags ?? [])]
      hint = String(old?.hint ?? '')
      if (category === 'Фобия' && row.hint) hint = row.hint
      if (category === 'Здоровье' && specName === 'Мигрень') hint = 'лёгкая'
      if (category === 'Здоровье' && specName === 'Близорукость') hint = '−3'
      if (category === 'Фобия' && specName === 'Клаустрофобия' && (!hint || hint === 'F')) {
        hint = 'боязнь замкнутых пространств'
      }
    }
    tags = applyRetag(specName, tags)
    const item = {
      name: specName,
      coef: row.coef,
      hint,
      tags,
    }
    if (category === 'Здоровье') {
      const st = STAGED[specName]
      item.staged = !!st?.staged
      item.stages = st?.stages ? [...st.stages] : []
    }
    items.push(item)
    if (specName === 'Идеально здоров' && String(row.source).includes('×4')) {
      for (let n = 0; n < 3; n += 1) items.push({ ...item, tags: [...item.tags], stages: [...(item.stages || [])] })
    }
    if (specName === 'Нет фобии' && String(row.source).includes('×5')) {
      for (let n = 0; n < 4; n += 1) items.push({ ...item, tags: [...item.tags] })
    }
  }
  items.sort((a, b) => b.coef - a.coef || a.name.localeCompare(b.name, 'ru'))
  return { category, items }
}

function appendNewRows(bundle, extra) {
  const have = new Set(bundle.items.map((item) => item.name))
  for (const row of extra) {
    if (have.has(row.name)) continue
    have.add(row.name)
    const item = {
      name: row.name,
      coef: row.coef,
      hint: row.hint || '',
      tags: row.tags || [],
    }
    if (bundle.category === 'Здоровье') {
      const st = STAGED[row.name]
      item.staged = !!st?.staged
      item.stages = st?.stages ? [...st.stages] : []
    }
    bundle.items.push(item)
  }
  bundle.items.sort((a, b) => b.coef - a.coef || a.name.localeCompare(b.name, 'ru'))
}

const md = fs.readFileSync(specPath, 'utf8')
const newMeta = collectNewMeta(md)

const profession = buildCategory(parseFinalCategory(md, '### Профессия (153)', 4), 'profession.json', 'Профессия', newMeta)
const health = buildCategory(parseFinalCategory(md, '### Здоровье (100)', 5), 'health.json', 'Здоровье', newMeta)
const hobby = buildCategory(parseFinalCategory(md, '### Хобби (113)', 4), 'hobby.json', 'Хобби', newMeta)
const phobia = buildCategory(parseFinalCategory(md, '### Фобия (111)', 5), 'phobia.json', 'Фобия', newMeta)
const baggage = buildCategory(parseFinalCategory(md, '### Багаж (174)', 4), 'baggage.json', 'Багаж', newMeta)
const fact = buildCategory(parseFinalCategory(md, '### Факт (101)', 4), 'fact.json', 'Факт', newMeta)

appendNewRows(hobby, parseNewSectionRows(md, '### Хобби (47)', '### Фобия (46)'))
appendNewRows(phobia, parseNewSectionRows(md, '### Фобия (46)', '### Багаж (72)'))
appendNewRows(baggage, parseNewSectionRows(md, '### Багаж (72)', '### Факт (42)'))
appendNewRows(fact, parseNewSectionRows(md, '### Факт (42)', '## Итоговый список колоды нового режима'))
appendNewRows(health, parseNewSectionRows(md, '### Здоровье (41)', '### Хобби (47)'))

const counts = {
  Профессия: profession.items.length,
  Здоровье: health.items.length,
  Хобби: hobby.items.length,
  Фобия: phobia.items.length,
  Багаж: baggage.items.length,
  Факт: fact.items.length,
}
console.log('counts', counts)

writeJson(path.join(outChars, 'index.json'), {
  slots: [
    { category: 'Профессия', file: 'profession.json', weight: 0.8 },
    { category: 'Здоровье', file: 'health.json', weight: 1 },
    { category: 'Биология', file: null, weight: 1 },
    { category: 'Хобби', file: 'hobby.json', weight: 0.65 },
    { category: 'Фобия', file: 'phobia.json', weight: 0.4 },
    { category: 'Багаж', file: 'baggage.json', weight: 0.5 },
    { category: 'Факт', file: 'fact.json', weight: 0.75 },
  ],
})
writeJson(path.join(outChars, 'profession.json'), profession)
writeJson(path.join(outChars, 'health.json'), health)
writeJson(path.join(outChars, 'hobby.json'), hobby)
writeJson(path.join(outChars, 'phobia.json'), phobia)
writeJson(path.join(outChars, 'baggage.json'), baggage)
writeJson(path.join(outChars, 'fact.json'), fact)
writeJson(path.join(dataDir, 'tag-labels-new.json'), TAG_LABELS_NEW)

const catsOld = JSON.parse(fs.readFileSync(path.join(dataDir, 'bunker', 'catastrophes.json'), 'utf8'))
const threatsOld = JSON.parse(fs.readFileSync(path.join(dataDir, 'bunker', 'threats.json'), 'utf8'))
const condOld = JSON.parse(fs.readFileSync(path.join(dataDir, 'bunker', 'conditions.json'), 'utf8'))

function patchReq(item, id, req, textReplace) {
  if (item.id !== id) return item
  const next = { ...item, requirements: req }
  if (textReplace) next.text = item.text.replaceAll(textReplace.from, textReplace.to)
  return next
}

const cats = catsOld.items.map((item) => {
  let next = item
  next = patchReq(next, 'cat_005', [['infectious'], ['medical', 'biology'], ['ppe']], {
    from: 'средства защиты',
    to: 'противоэпидемическая защита',
  })
  next = patchReq(next, 'cat_012', [['engineering', 'computing'], ['chemistry', 'science'], ['ppe']])
  next = patchReq(next, 'cat_002', [['radiation', 'nuclear'], ['food', 'agriculture'], ['power', 'cold']])
  next = patchReq(next, 'cat_010', [['power'], ['food', 'agriculture'], ['engineering', 'repair', 'cold']])
  return next
})

const NEW_CATS = [
  ['cat_017', 'Гамма-всплеск', 'Близкий гамма-всплеск сжёг озоновый слой. На поверхности за часы стерилизует УФ и вторичная радиация, электроника и посевы мертвы. Жить можно только под метрами породы, пока не восстановят экранирование, медицину лучевой и автономную энергию. Не война и не супершторм: удар один, последствия на годы.', [['radiation'], ['medical'], ['power']], 7, -20],
  ['cat_018', 'Разгон парника', 'Климат ушёл в необратимый парниковый разгон: океаны горячие, у поверхности десятки градусов сверх выживания, влажность убивает за часы. Глубокий бункер — последняя холодная масса. После выхода: химия атмосферы, инженерия охлаждения и энергия, замкнутая вода. Не засуха и не «удушающие водоросли».', [['chemistry'], ['engineering', 'power'], ['water']], 6, -19],
  ['cat_019', 'Коллапс магнитосферы', 'Поле Земли ослабло на годы: солнечный ветер бьёт грунт радиацией, компасы и спутники мертвы. Бункер в породе режет поток. Нужны радиация, энергия без внешней сети, навигация без магнитосферы. Не супершторм (тот — импульс) и не ядерная зима (нет пепла).', [['radiation'], ['power'], ['navigation']], 6, -18],
  ['cat_020', 'Срыв геоинженерии', 'Чтобы сбить жару, в стратосферу закачали аэрозоли серы. Доза ушла в разнос: солнце на годы закрыто пылью, кислотные дожди, посевы мертвы, на улице холод и отёк лёгких. Жить можно только в герметичном объёме с фильтрами и своим теплом. Не ядерная зима (нет войны и пепла) и не вечная зима (светило не погасло — его заслонили). После выхода: химия атмосферы, отопление/энергия, пища в закрытом цикле.', [['chemistry'], ['cold', 'power'], ['food', 'agriculture']], 6, -18],
  ['cat_021', 'Нашествие очень честных инопланетян', 'С орбиты спустились пришельцы, которые физически не умеют врать и считают ложь человечества дефектом, подлежащим стерилизации атмосферы. Бункер — единственное место, куда их протоколы пока не достают. Чтобы они ушли, нужно удержать в голове их конституцию (четыреста страниц исключений) и честно убедить, что они неправы.', [['diplomacy'], ['psychology', 'leadership'], ['culture', 'science']], 6, -18],
  ['cat_022', 'Подписка на Солнце', 'Солнце перевели на лицензию: без принятых оферты и двухфакторки дневной свет на поверхности выжигает всё живое. Пока группа в шахте, лицензия не списывается. После выхода нужны IT, энергия (свой свет) и лидер, который подпишет кабалу за всех — или дипломат, который её оспорит.', [['computing'], ['power'], ['leadership', 'diplomacy']], 6, -17],
  ['cat_023', 'Восьмиминутная петля', 'Планета зациклилась на восьми минутах. На поверхности петля рвёт память и тела; в герметичном объёме бункера часы идут вперёд. Чтобы выйти насовсем, нужны наука (найти шов времени), навигация (не заблудиться в повторе) и психология (не сойти с ума от дежавю).', [['science'], ['navigation'], ['psychology']], 7, -19],
  ['cat_024', 'Выходные гравитации', 'По субботам и воскресеньям g = 0 или 8g без предупреждения. Города сложились. Бункер на скале держит среднее g. После выхода: инженерия (якоря), сила (пережить всплеск), геология (где твердь не улетит).', [['engineering', 'construction'], ['strength'], ['geology']], 6, -18],
  ['cat_025', 'Луна подала на развод', 'Луна ушла с орбиты «по взаимному согласию». Приливы, ось и психика приливозависимых видов рухнули. Бункер глубже зоны новых приливов. Нужны навигация/астрономия, геология и психология (массовая лунная ломка).', [['navigation'], ['geology'], ['psychology']], 6, -17],
  ['cat_026', 'Апокалипсис в тональности', 'Кто на поверхности фальшивит — у того останавливается сердце. Воздух настроен на ля 442. В бункере толстые стены снимают строй. После выхода: культура (держать строй), медицина (срывы ритма), психология (паника фальши).', [['culture'], ['medical'], ['psychology']], 5, -16],
  ['cat_027', 'Обратная эволюция', 'За месяц на свету млекопитающие становятся рыбами. Бункер без спектра дневного запуска держит форму. После выхода: биология, вода (новая среда) и выживание.', [['biology'], ['water'], ['survival']], 6, -18],
]

for (const [id, title, flavor, requirements, successDelta, failureDelta] of NEW_CATS) {
  cats.push({
    id,
    title,
    text: `${title}: ${flavor}${solutionTail(requirements)}`,
    requirements,
    grants: [],
    successDelta,
    failureDelta,
  })
}

const NEW_THREATS = [
  ['threat_042', 'Канализация жилого модуля поднялась в душевую: фекальные воды, риск вспышки. Нужны сантехника и медицина/инфекция.', [['plumbing', 'water'], ['medical', 'infectious']], 5, -13],
  ['threat_043', 'Грунтовые воды затопили нижний ярус, воздух вытесняется, насосы хлещут вхолостую.', [['water', 'plumbing'], ['ventilation', 'construction']], 5, -14],
  ['threat_044', 'Двое жильцов оспаривают право распоряжаться складом по старым бумагам объекта. Без разбора документов начнётся драка.', [['diplomacy'], ['leadership']], 4, -10],
  ['threat_045', 'После вылазки шлюз грязный: без разбора СИЗ и деза группа занесёт заразу внутрь.', [['ppe'], ['infectious']], 5, -14],
  ['threat_046', 'В котельной перекрыли дымоход. Угарный газ заполнил жилые помещения: головная боль, люди теряют сознание. Нужны вентиляция или химия (найти источник и проветрить) и медицина.', [['ventilation', 'chemistry'], ['medical']], 5, -15],
  ['threat_047', 'Партия консервов вздулась: ботулизм. Нужны выбраковка, химия/медицина и не отравить кастрюлю.', [['food'], ['medical', 'chemistry']], 5, -14],
  ['threat_048', 'Чертежи шахты не совпадают с этажами: поисковая группа теряется в служебных тоннелях.', [['navigation'], ['construction', 'geology']], 4, -11],
  ['threat_049', 'Конденсат с потолка льёт на щиток и в забор воздуха. Короткие замыкания и сырость фильтров.', [['water', 'ventilation'], ['power', 'repair']], 4, -12],
  ['threat_050', 'Недели без нагрузки: гиподинамия, отёк, очередь на единственный тренажёр сжигает кислород. Нужны дозированная нагрузка и медицина/психология.', [['strength'], ['medical', 'psychology']], 4, -10],
  ['threat_051', 'Тепловой разгон аккумуляторного ящика на складе еды: дым, риск пожара, порча пайков.', [['chemistry', 'fire'], ['food', 'engineering']], 5, -14],
  ['threat_052', 'Внутреннюю гермодверь клинит под напором с соседнего захваченного отсека. Нужны броня/упор и оружие или безопасность.', [['protection'], ['weapon', 'security']], 5, -14],
  ['threat_053', 'Дежурные ушли по аварийной лестнице к поверхности. Рация молчит, ответа нет, в жилом отсеке паника. Нужны связь/ремонт рации и психология, чтобы не ломанули гермодверь.', [['communication', 'repair'], ['psychology']], 4, -12],
  ['threat_054', 'В шлюзе очередь честных инопланетян: они зачитают устав, пока вы не найдёте ошибку в статье 12.', [['diplomacy'], ['science', 'culture']], 4, -12],
  ['threat_055', 'Генератор работает, только если его оскорблять в рифму.', [['power'], ['culture']], 4, -10],
  ['threat_056', 'Пол по вторникам — вежливая лава: обжигает лишь тех, кто не извинился.', [['fire'], ['psychology', 'diplomacy']], 4, -12],
  ['threat_057', 'Все часы в отсеке идут назад. Дежурства и лекарства сбились.', [['science'], ['medical', 'navigation']], 4, -11],
  ['threat_058', 'Тостер объявил забастовку и отказывается греть, пока не признают профсоюз.', [['leadership', 'diplomacy'], ['food', 'power']], 3, -9],
  ['threat_059', 'Тень одного из жильцов подала жалобу в инопланетный суд.', [['diplomacy'], ['psychology']], 3, -10],
  ['threat_060', 'Аварийный свет моргает азбукой Морзе рецептом борща; щит жизнеобеспечения не включится, пока блюдо не появится на столе.', [['food'], ['power', 'culture']], 3, -8],
  ['threat_061', 'Гермодверь отвечает исключительно пятистопным ямбом.', [['culture'], ['communication', 'engineering']], 3, -8],
  ['threat_062', 'Появился более вежливый двойник хоста и просит ключи.', [['psychology'], ['leadership', 'security']], 4, -12],
  ['threat_063', 'Коты требуют собственную конституцию и печать.', [['animals'], ['diplomacy', 'culture']], 3, -7],
  ['threat_064', 'Шахматы на столе начали гражданскую войну (ферзь требует убежища).', [['culture'], ['leadership', 'weapon']], 3, -8],
  ['threat_065', 'Вежливый призрак не уйдёт, пока не докажете лемму.', [['science'], ['psychology']], 3, -9],
  ['threat_066', 'Длина коридора зависит от кредитной истории группы.', [['computing'], ['leadership']], 3, -8],
  ['threat_067', 'Пожарная сирена зачитывает пользовательское соглашение на 90 минут.', [['fire'], ['computing', 'culture']], 4, -10],
  ['threat_068', 'Открылся портал в отдел кадров. Без оффера не закрыть.', [['psychology'], ['leadership', 'culture']], 3, -9],
  ['threat_069', 'Кодовая панель люка принимает только числа Фибоначчи, надиктованные шёпотом в правильном темпе.', [['science'], ['computing']], 3, -8],
  ['threat_070', 'Температура стала моральной категорией: «добрым» тепло, «злым» −20.', [['cold'], ['psychology', 'diplomacy']], 4, -12],
]

const threats = threatsOld.items.map((item) => {
  if (item.id === 'threat_031') {
    return {
      ...item,
      requirements: [['radiation'], ['ppe', 'medical']],
      text: item.text
        .replace('средства защиты либо специалист по радиации', 'противоэпидемическая защита либо медицина')
        .replace('средства защиты или медицина', 'противоэпидемическая защита или медицина'),
    }
  }
  return item
})

for (const [id, flavor, requirements, successDelta, failureDelta] of NEW_THREATS) {
  threats.push({
    id,
    text: `${flavor}${solutionTail(requirements)}`,
    requirements,
    grants: [],
    successDelta,
    failureDelta,
  })
}

const NEW_CONDS = [
  ['condition_34', 'Склад СИЗ', 'Герметичные ящики с полумасками, перчатками и хлоркой.', ['ppe'], 3],
  ['condition_35', 'Твердотопливная котельная', 'Печь и запас угля на жилой контур.', ['cold', 'fire', 'power'], 3],
  ['condition_36', 'Тир за переборкой', 'Стрелковый рубеж и кевларовые щиты.', ['weapon', 'protection'], 3],
  ['condition_37', 'Изолятор', 'Отдельный бокс с шлюзом.', ['infectious', 'ppe'], 3],
  ['condition_38', 'Метеостанция у входа', 'Датчики мороза и ветра, архив.', ['cold', 'navigation'], 3],
  ['condition_39', 'Собрание конституций', 'Четыреста страниц чужих уставов, оферт и «честных» протоколов.', ['diplomacy', 'culture'], 3],
  ['condition_40', 'Не повезло', 'Увы, вам не повезло.', [], 0],
]

const conditions = [
  ...condOld.items,
  ...NEW_CONDS.map(([id, title, text, grants, successDelta]) => ({
    id,
    title,
    text,
    requirements: [],
    grants,
    successDelta,
    failureDelta: 0,
  })),
]

writeJson(path.join(outBunker, 'catastrophes.json'), { items: cats })
writeJson(path.join(outBunker, 'threats.json'), { items: threats })
writeJson(path.join(outBunker, 'conditions.json'), { items: conditions })

console.log('bunker', cats.length, threats.length, conditions.length)
