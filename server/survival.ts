import type {
  BunkerState,
  Player,
  SurvivalChallengeResult,
  SurvivalFactor,
  SurvivalReport,
} from '../shared/types'
import { challengeByText, type BunkerChallenge } from './bunker'

const TAG_LABELS: Record<string, string> = {
  agriculture: 'сельское хозяйство', food: 'пища', fishing: 'рыбалка', water: 'чистая вода',
  medical: 'медицина', infectious: 'инфекционные заболевания', biology: 'биология', science: 'наука',
  engineering: 'инженерия', repair: 'ремонт', tools: 'инструменты', plumbing: 'сантехника',
  power: 'энергия', ventilation: 'вентиляция', chemistry: 'химия', radiation: 'радиация',
  nuclear: 'ядерные технологии', protection: 'защита', construction: 'строительство',
  survival: 'выживание', rescue: 'спасательные работы', weapon: 'оружие', security: 'безопасность',
  strength: 'физическая сила', leadership: 'лидерство', psychology: 'психология', computing: 'IT',
  culture: 'культура', geology: 'геология', navigation: 'навигация', communication: 'связь',
  animals: 'работа с животными', fire: 'пожарная безопасность', logistics: 'логистика',
  reproductive_edge: 'условие репродуктивного сканера',
}

function labelTag(tag: string): string {
  return TAG_LABELS[tag] ?? tag
}

interface TeamTags {
  tags: Set<string>
  sources: Map<string, Set<string>>
}

function buildTeamTags(players: Player[], bunker: BunkerState): TeamTags {
  const tags = new Set<string>()
  const sources = new Map<string, Set<string>>()
  const add = (tag: string, source: string) => {
    tags.add(tag)
    if (!sources.has(tag)) sources.set(tag, new Set())
    sources.get(tag)!.add(source)
  }

  for (const player of players) {
    for (const characteristic of player.characteristics) {
      for (const tag of characteristic.tags ?? []) add(tag, `${player.name}: ${characteristic.value}`)
    }
    const biology = player.biology
    if (!biology) continue
    if (biology.sex === 'М' || biology.sex === 'Гермафродит') add('male', player.name)
    if (biology.sex === 'Ж' || biology.sex === 'Гермафродит') add('female', player.name)
    if (biology.sex === 'Андроид') add('engineering', `${player.name}: андроид`)
    if (
      biology.infertile ||
      ((biology.sex === 'Ж' || biology.sex === 'Гермафродит') && biology.age > 50) ||
      (biology.sex === 'М' && biology.age > 60)
    ) {
      add('reproductive_edge', player.name)
    }
  }

  for (const condition of bunker.conditions) {
    const challenge = challengeByText(condition.text)
    for (const tag of challenge?.grants ?? []) add(tag, `условие бункера: ${condition.text}`)
  }
  return { tags, sources }
}

function evaluateChallenge(challenge: BunkerChallenge, team: TeamTags): SurvivalChallengeResult {
  const matched: string[] = []
  const missing: string[] = []
  for (const group of challenge.requirements) {
    const tag = group.find((candidate) => team.tags.has(candidate))
    if (tag) {
      const source = [...(team.sources.get(tag) ?? [])][0]
      matched.push(`${labelTag(tag)}${source ? ` — ${source}` : ''}`)
    } else {
      missing.push(group.map(labelTag).join(' или '))
    }
  }
  const total = challenge.requirements.length
  const closed = matched.length
  const success = missing.length === 0
  // Частичный зачёт: линейно между провалом и успехом по доле закрытых групп.
  // Если требований нет — считаем полным успехом.
  const ratio = total === 0 ? 1 : closed / total
  const delta = Math.round(
    challenge.failureDelta + (challenge.successDelta - challenge.failureDelta) * ratio,
  )
  const detail = total === 0
    ? 'Специальные ресурсы не требуются.'
    : success
      ? `Закрыто полностью: ${matched.join('; ')}.`
      : closed > 0
        ? `Закрыто ${closed} из ${total}: ${matched.join('; ')}. Не хватает: ${missing.join('; ')}.`
        : `Не хватает: ${missing.join('; ')}.`
  return {
    kind: challenge.kind === 'catastrophe' ? 'catastrophe' : 'threat',
    text: challenge.text,
    success,
    delta,
    detail,
  }
}

function healthCharacteristic(player: Player) {
  return player.characteristics.find((characteristic) => characteristic.type === 'Здоровье')
}

function factor(
  id: SurvivalFactor['id'], label: string, status: string, delta: number, detail: string,
): SurvivalFactor {
  return { id, label, status, delta, detail }
}

const BASE_SURVIVAL_CHANCE = 50

export function calculateSurvival(players: Player[], bunker: BunkerState): SurvivalReport {
  const survivors = players.filter((player) => player.isAlive)
  const team = buildTeamTags(survivors, bunker)
  const factors: SurvivalFactor[] = []

  const ages = survivors.flatMap((player) => player.biology ? [player.biology.age] : [])
  const averageAge = ages.length ? ages.reduce((sum, age) => sum + age, 0) / ages.length : 50
  const ageStatus = averageAge <= 40 ? 'Отличный' : averageAge <= 60 ? 'Удовлетворительный' : 'Ужасный'
  const ageDelta = averageAge <= 40 ? 8 : averageAge <= 60 ? 0 : -10
  factors.push(factor('age', 'Возраст группы', ageStatus, ageDelta, `Средний возраст: ${averageAge.toFixed(1)}.`))

  const health = survivors.map(healthCharacteristic).filter((item) => item != null)
  const averageHealth = health.length ? health.reduce((sum, item) => sum + item.coef, 0) / health.length : 0.5
  const contagious = health.filter((item) => item.tags?.includes('contagious')).length
  const critical = health.filter((item) => item.tags?.includes('critical')).length
  const hasMedicine = team.tags.has('medical')
  const hasInfectious = team.tags.has('infectious')
  let healthDelta = averageHealth >= 0.75 ? 8 : averageHealth >= 0.5 ? 3 : averageHealth >= 0.3 ? -5 : -12
  if (contagious > 0) healthDelta += hasMedicine && hasInfectious ? -2 : -12
  if (critical > 0) healthDelta -= Math.min(15, critical * (hasMedicine ? 2 : 5))
  const healthStatus = contagious && !(hasMedicine && hasInfectious)
    ? 'Критическое' : averageHealth >= 0.7 && critical === 0 ? 'Хорошее' : averageHealth >= 0.4 ? 'Удовлетворительное' : 'Плохое'
  factors.push(factor('health', 'Здоровье группы', healthStatus, healthDelta,
    `Средний КФ здоровья: ${averageHealth.toFixed(2)}. Заразных состояний: ${contagious}, критических: ${critical}.`))

  const needMedicine = averageHealth < 0.65 || contagious > 0 || critical > 0
  // Вода не входит в общий фактор: подходящих карт мало, а отдельные водные
  // угрозы по-прежнему честно проверяют тег water в своих требованиях.
  const needs = [team.tags.has('food') || team.tags.has('agriculture')]
  if (needMedicine) needs.push(hasMedicine)
  const satisfiedNeeds = needs.filter(Boolean).length
  const needsStatus = satisfiedNeeds === needs.length ? 'Удовлетворены' : satisfiedNeeds === 0 ? 'Не удовлетворены' : 'Частично удовлетворены'
  const needsDelta = satisfiedNeeds === needs.length ? 10 : satisfiedNeeds === 0 ? -10 : 0
  factors.push(factor('needs', 'Базовые потребности', needsStatus, needsDelta, ''))

  const mixedSexes = team.tags.has('male') && team.tags.has('female')
  factors.push(factor('sex', 'Половой состав', mixedSexes ? 'Удовлетворительный' : 'Плохой', mixedSexes ? 2 : -2,
    mixedSexes ? 'В группе представлены мужчины и женщины.' : 'В группе нет хотя бы одного мужчины и одной женщины.'))

  const dangerousPlayers = survivors.filter((player) => player.characteristics.some((item) =>
    item.tags?.some((tag) => ['dangerous', 'psychopath', 'maniac', 'suicidal'].includes(tag)),
  ))
  const conflictPlayers = survivors.filter((player) => player.characteristics.some((item) => item.tags?.includes('conflict')))
  const mitigation = team.tags.has('psychology') || team.tags.has('leadership')
  const dangerDelta = -Math.min(20, dangerousPlayers.length * (mitigation ? 3 : 6) + conflictPlayers.length * 2)
  const dangerNames = [...new Set([...dangerousPlayers, ...conflictPlayers].map((player) => player.name))]
  factors.push(factor('danger', 'Внутренние риски', dangerNames.length ? (mitigation ? 'Контролируемые' : 'Опасные') : 'Не обнаружены', dangerDelta,
    dangerNames.length ? `Риск создают: ${dangerNames.join(', ')}.${mitigation ? ' Есть лидерство или психологическая поддержка.' : ''}` : 'Психопаты, маньяки и выраженно конфликтные участники не обнаружены.'))

  const conditionDelta = bunker.conditions.reduce((sum, condition) => sum + (challengeByText(condition.text)?.successDelta ?? 0), 0)
  factors.push(factor('conditions', 'Условия бункера', bunker.conditions.length ? 'Использованы' : 'Нет дополнительных', conditionDelta,
    bunker.conditions.length ? `Полезных дополнительных условий: ${bunker.conditions.length}.` : 'Дополнительные условия не открыты.'))

  const challengeTexts = [bunker.catastrophe, ...bunker.threats].filter(Boolean)
  const challenges = challengeTexts.map((text) => {
    const challenge = challengeByText(text)
    if (!challenge) return { kind: text === bunker.catastrophe ? 'catastrophe' as const : 'threat' as const, text, success: false, delta: -8, detail: 'Для события не настроены требования в Excel.' }
    return evaluateChallenge(challenge, team)
  })

  const rawChance = BASE_SURVIVAL_CHANCE + factors.reduce((sum, item) => sum + item.delta, 0) + challenges.reduce((sum, item) => sum + item.delta, 0)
  return {
    baseChance: BASE_SURVIVAL_CHANCE,
    chance: Math.max(0, Math.min(100, Math.round(rawChance))),
    factors,
    challenges,
  }
}
