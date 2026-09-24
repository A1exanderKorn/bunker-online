<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useProfileStore, profileRequest, discordLoginUrl } from '@/stores/profile'
import { useSessionStore } from '@/stores/session'
import type { MatchSummary, MatchDetail } from '@shared/profile'

const profile = useProfileStore()
const session = useSessionStore()
const route = useRoute()
const nickname = ref('')
const error = ref('')
const notice = ref('')
const busy = ref(false)
const historyBusy = ref(false)
const matches = ref<MatchSummary[]>([])
const hasMore = ref(false)
const historyLoaded = ref(false)
const selected = ref<MatchDetail | null>(null)
const dialog = ref<HTMLDialogElement>()
const detailLoading = ref(false)
const date = (value: string) => new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' })
const coefficient = (value: number | null) => value == null ? 'не сохранён' : value.toFixed(2)
const algorithm = (match: MatchSummary) => match.gameMode === 'new' ? 'Новый алгоритм' : 'Старый алгоритм'
const target = (match: MatchSummary) => match.randomTargetCoef
  ? `Без притяжения к цели (настройка КФ ${coefficient(match.targetCoef)})`
  : `Целевой КФ: ${coefficient(match.targetCoef)}`
function outcome(match: MatchSummary) {
  if (match.admitted) return 'Прошёл в бункер'
  return match.eliminationOrder ? `Не прошёл · исключён ${match.eliminationOrder}-м` : 'Не прошёл в бункер'
}
async function loadHistory() {
  if (historyBusy.value) return
  historyBusy.value = true
  error.value = ''
  try {
    const data = await profileRequest<{ matches: MatchSummary[]; hasMore: boolean }>(`/profile/matches?offset=${matches.value.length}`)
    matches.value.push(...data.matches)
    hasMore.value = data.hasMore
    historyLoaded.value = true
  } catch (e) { error.value = (e as Error).message }
  finally { historyBusy.value = false }
}
async function openMatch(match: MatchSummary) {
  detailLoading.value = true
  error.value = ''
  try {
    selected.value = await profileRequest<MatchDetail>(`/profile/matches/${match.id}`)
    dialog.value?.showModal()
  } catch (e) { error.value = (e as Error).message }
  finally { detailLoading.value = false }
}
async function save() {
  busy.value = true; error.value = ''; notice.value = ''
  try {
    await profile.save(nickname.value)
    session.setName(profile.user!.nickname)
    nickname.value = profile.user!.nickname
    notice.value = 'Ник сохранён. В текущей партии имя не меняется.'
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
async function logout() {
  busy.value = true; error.value = ''
  try {
    await profile.logout()
    session.setName('')
    matches.value = []; selected.value = null; historyLoaded.value = false
    notice.value = ''
  } catch (e) { error.value = (e as Error).message }
  finally { busy.value = false }
}
onMounted(async () => {
  await profile.load()
  if (route.query.authError) error.value = 'Не удалось войти через Discord. Попробуйте ещё раз.'
  if (profile.user) { nickname.value = profile.user.nickname; await loadHistory() }
})
</script>

<template>
  <main class="profile-page">
    <RouterLink to="/" class="back-link">← К игре</RouterLink>
    <h1>Профиль игрока</h1>
    <p v-if="profile.loading" role="status">Загружаем профиль…</p>
    <p v-if="error || profile.error" role="alert" class="error">{{ error || profile.error }}</p>
    <template v-if="!profile.loading && !profile.user">
      <section class="panel">
        <h2>Играйте с профилем</h2>
        <p>Войдите через Discord, чтобы сохранить ник, аватар и историю завершённых игр.</p>
        <a v-if="profile.authEnabled" :href="discordLoginUrl" class="action">Войти через Discord</a>
        <p v-else>Вход через Discord пока не настроен на сервере.</p>
        <p>Без авторизации можно играть гостем. История гостевых игр не сохраняется и не переносится в профиль.</p>
      </section>
    </template>
    <template v-if="profile.user && !profile.loading">
      <section class="panel identity">
        <img :src="profile.user.avatarUrl" alt="Аватар Discord" class="avatar" referrerpolicy="no-referrer" />
        <form @submit.prevent="save">
          <label for="nickname">Ник в игре</label>
          <input id="nickname" v-model="nickname" maxlength="32" required autocomplete="nickname" :disabled="busy" />
          <p class="muted">Аватар берётся из Discord и обновляется при входе.</p>
          <div class="actions">
            <button class="action" :disabled="busy || !nickname.trim()">{{ busy ? 'Подождите…' : 'Сохранить ник' }}</button>
            <button type="button" :disabled="busy" @click="logout">Выйти</button>
          </div>
          <p v-if="notice" role="status">{{ notice }}</p>
        </form>
      </section>
      <section class="panel">
        <h2>История игр</h2>
        <p class="muted">Нажмите на матч, чтобы посмотреть свою стартовую раздачу. Результат — попадание в бункер, а не итоговый шанс выживания.</p>
        <p v-if="historyLoaded && !matches.length">Здесь появится первая завершённая игра.</p>
        <ul class="matches">
          <li v-for="match in matches" :key="match.id">
            <button class="match" :disabled="detailLoading" @click="openMatch(match)">
              <span class="result" :class="match.admitted ? 'admitted' : 'excluded'">{{ outcome(match) }}</span>
              <span>{{ date(match.finishedAt) }}</span>
              <span>{{ match.playerCount }} игроков · {{ algorithm(match) }}</span>
              <span>Стартовый КФ карточки: {{ coefficient(match.startingCoef) }}</span>
              <span>{{ target(match) }}</span>
              <span class="muted">Стартовые характеристики →</span>
            </button>
          </li>
        </ul>
        <p v-if="historyBusy" role="status">Загружаем историю…</p>
        <button v-if="hasMore || !historyLoaded" :disabled="historyBusy" @click="loadHistory">{{ historyLoaded ? 'Ещё матчи' : 'Загрузить историю' }}</button>
      </section>
    </template>
    <dialog ref="dialog" aria-labelledby="match-title" @click="(e) => { if (e.target === dialog) dialog?.close() }">
      <article v-if="selected" class="match-detail">
        <button class="close" autofocus aria-label="Закрыть характеристики" @click="dialog?.close()">Закрыть ×</button>
        <h2 id="match-title">Стартовая раздача</h2>
        <p>{{ date(selected.finishedAt) }} · {{ selected.playerCount }} игроков</p>
        <p>{{ algorithm(selected) }} · Стартовый КФ карточки: {{ coefficient(selected.startingCoef) }}</p>
        <p>{{ target(selected) }}</p>
        <p :class="selected.admitted ? 'admitted' : 'excluded'">{{ outcome(selected) }}</p>
        <dl>
          <div v-for="(trait, index) in selected.characteristics" :key="index" class="trait">
            <dt>{{ trait.type }}</dt><dd>{{ trait.value }} <small>КФ {{ trait.coef.toFixed(2) }}</small></dd>
          </div>
        </dl>
      </article>
    </dialog>
  </main>
</template>

<style scoped>
.profile-page { max-width: 850px; margin: 0 auto; padding: 28px 16px 60px; color: var(--text); }
.back-link { color: var(--accent); }
h1 { margin: 24px 0; } h2 { margin-top: 0; }
.panel { background: var(--surface); border: 1px solid #7775; border-radius: 16px; padding: 24px; margin-bottom: 24px; }
.identity { display: flex; gap: 24px; align-items: flex-start; }
.avatar { width: 88px; height: 88px; border-radius: 50%; }
form { flex: 1; min-width: 0; } label { display: block; margin-bottom: 8px; }
input { box-sizing: border-box; width: 100%; padding: 12px; border: 1px solid #888; border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; }
button, .action { cursor: pointer; border: 1px solid #8888; border-radius: 8px; padding: 10px 16px; font: inherit; color: var(--text); background: var(--surface); text-decoration: none; display: inline-block; }
.action { background: #5865f2; color: white; }
button:disabled { opacity: .55; cursor: wait; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; }
.muted { opacity: .72; font-size: .9rem; line-height: 1.5; }
.error, .excluded { color: #b42332; } .admitted { color: #187743; }
:global(:root[data-theme='dark']) .error, :global(:root[data-theme='dark']) .excluded { color: #f48787; }
:global(:root[data-theme='dark']) .admitted { color: #77d7a1; }
@media (prefers-color-scheme: dark) {
  :global(:root:not([data-theme])) .error, :global(:root:not([data-theme])) .excluded { color: #f48787; }
  :global(:root:not([data-theme])) .admitted { color: #77d7a1; }
}
.matches { list-style: none; padding: 0; display: grid; gap: 12px; }
.match { display: grid; gap: 8px; text-align: left; width: 100%; padding: 18px; }
.match:hover { border-color: var(--accent); } .result { font-weight: 700; }
dialog { color: var(--text); background: var(--surface); border: 1px solid #8888; border-radius: 16px; padding: 0; max-width: 600px; width: calc(100% - 32px); max-height: 85dvh; }
dialog::backdrop { background: #000b; } .match-detail { padding: 24px; overflow-wrap: anywhere; }
.close { display: block; margin: 0 0 16px auto; } .trait { padding: 12px 0; border-bottom: 1px solid #8884; }
dt { opacity: .7; font-size: .85rem; } dd { margin: 6px 0 0; } small { display: block; opacity: .65; margin-top: 4px; }
@media (max-width: 520px) { .identity { flex-direction: column; } .panel { padding: 18px; } }
</style>
