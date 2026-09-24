import { createHash, randomBytes, randomUUID } from 'crypto'
import { Router, type Request, type Response, type NextFunction } from 'express'
import type { Profile } from '../shared/profile'
import { db } from './database'

export const appOrigin = new URL(process.env.APP_ORIGIN || 'http://localhost:5173').origin
const secure = appOrigin.startsWith('https:')
const sessionCookie = secure ? '__Host-bunker_session' : 'bunker_session'
const stateCookie = secure ? '__Host-bunker_oauth' : 'bunker_oauth'
const sessionMs = 30 * 24 * 60 * 60 * 1000
export const authEnabled = !!(db && process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
if (authEnabled && process.env.NODE_ENV === 'production' && !secure) {
  throw new Error('Discord authentication requires an HTTPS APP_ORIGIN in production')
}
const callbackUrl = `${appOrigin}/api/auth/discord/callback`
export const digest = (token: string): string => createHash('sha256').update(token).digest('hex')

function cookieValue(header: string | undefined, name: string): string | undefined {
  return header?.split(';').map(s => s.trim()).find(s => s.startsWith(`${name}=`))?.slice(name.length + 1)
}
function cookie(res: Response, name: string, value: string, maxAge: number): void {
  res.cookie(name, value, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge })
}
export function sessionToken(header?: string): string | undefined { return cookieValue(header, sessionCookie) }
export async function authenticatedProfile(header?: string): Promise<Profile | null> {
  const token = sessionToken(header)
  if (!token || !db || !/^[a-f0-9]{64}$/.test(token)) return null
  const { rows } = await db.query(`SELECT p.id, p.nickname, p.avatar_url AS "avatarUrl"
    FROM auth_sessions s JOIN profiles p ON p.id=s.profile_id
    WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(token)])
  return rows[0] || null
}
export function validNickname(value: unknown): value is string {
  return typeof value === 'string' && [...value.trim()].length >= 1 && [...value.trim()].length <= 32
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
}
export function discordAvatar(user: { id: string; avatar: string | null; discriminator: string }): string {
  if (user.avatar && /^[a-zA-Z0-9_]+$/.test(user.avatar)) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
  }
  const index = user.discriminator && user.discriminator !== '0'
    ? Number(user.discriminator) % 5 : Number((BigInt(user.id) >> 22n) % 6n)
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

export function profileApi(onLogout: (tokenHash: string) => void = () => {}): Router {
  const router = Router()
  const limits = new Map<string, { until: number; count: number }>()
  router.use((req, res, next) => {
    if (req.path !== '/auth/discord' && req.method === 'GET') { next(); return }
    const now = Date.now()
    for (const [key, entry] of limits) if (entry.until <= now) limits.delete(key)
    const key = req.ip || 'unknown'
    const entry = limits.get(key) || { until: now + 60000, count: 0 }
    if (++entry.count > 30 || (!limits.has(key) && limits.size >= 10000)) {
      res.set('Retry-After', '60').status(429).json({ error: 'Слишком много запросов. Подождите минуту.' }); return
    }
    limits.set(key, entry)
    next()
  })
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  // No wildcard credentialed CORS. Custom header + exact origin protect mutations.
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      (req.headers.origin !== appOrigin || req.headers['x-profile-request'] !== '1')) {
      res.status(403).json({ error: 'Недопустимый источник запроса' }); return
    }
    next()
  })
  router.get('/auth/session', async (req, res) => {
    const user = await authenticatedProfile(req.headers.cookie)
    if (!user && sessionToken(req.headers.cookie)) cookie(res, sessionCookie, '', 0)
    res.json({ user, authEnabled })
  })
  router.get('/auth/discord', async (_req, res) => {
    if (!authEnabled) { res.status(503).json({ error: 'Вход через Discord ещё не настроен' }); return }
    const state = randomBytes(32).toString('hex')
    await db!.query('DELETE FROM oauth_states WHERE expires_at < now()')
    await db!.query('DELETE FROM auth_sessions WHERE expires_at < now()')
    await db!.query("INSERT INTO oauth_states VALUES ($1, now() + interval '10 minutes')", [digest(state)])
    cookie(res, stateCookie, state, 10 * 60 * 1000)
    const params = new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID!,
      redirect_uri: callbackUrl, response_type: 'code', scope: 'identify', state })
    res.redirect(`https://discord.com/oauth2/authorize?${params}`)
  })
  router.get('/auth/discord/callback', async (req, res) => {
    const state = cookieValue(req.headers.cookie, stateCookie)
    cookie(res, stateCookie, '', 0)
    if (!authEnabled || !state || state !== req.query.state || !/^[a-f0-9]{64}$/.test(state)) {
      res.redirect('/profile?authError=state'); return
    }
    const consumed = await db!.query('DELETE FROM oauth_states WHERE token_hash=$1 AND expires_at>now() RETURNING token_hash', [digest(state)])
    if (!consumed.rowCount || typeof req.query.code !== 'string' || req.query.code.length > 2048) {
      res.redirect('/profile?authError=cancelled'); return
    }
    try {
      const response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        body: new URLSearchParams({ client_id: process.env.DISCORD_CLIENT_ID!, client_secret: process.env.DISCORD_CLIENT_SECRET!,
          grant_type: 'authorization_code', code: req.query.code, redirect_uri: callbackUrl }),
      })
      if (!response.ok) throw new Error('Discord token exchange failed')
      const tokens = await response.json() as { access_token: string }
      const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
        signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${tokens.access_token}` },
      })
      if (!userResponse.ok) throw new Error('Discord identity fetch failed')
      const user = await userResponse.json() as { id: string; username: string; global_name: string | null; avatar: string | null; discriminator: string }
      if (!/^\d{1,24}$/.test(user.id)) throw new Error('Invalid Discord identity')
      const candidate = [...(user.global_name || user.username || 'Игрок').trim()].slice(0, 32).join('')
      const nickname = validNickname(candidate) ? candidate : 'Игрок'
      // Existing local nickname is never replaced by the Discord display name.
      const { rows } = await db!.query(`INSERT INTO profiles (id,discord_id,nickname,avatar_url) VALUES ($1,$2,$3,$4)
        ON CONFLICT (discord_id) DO UPDATE SET avatar_url=EXCLUDED.avatar_url,updated_at=now() RETURNING id`,
        [randomUUID(), user.id, nickname, discordAvatar(user)])
      const token = randomBytes(32).toString('hex')
      const old = sessionToken(req.headers.cookie)
      if (old) {
        await db!.query('DELETE FROM auth_sessions WHERE token_hash=$1', [digest(old)])
        onLogout(digest(old))
      }
      await db!.query('INSERT INTO auth_sessions VALUES ($1,$2,$3)', [digest(token), rows[0].id, new Date(Date.now() + sessionMs)])
      cookie(res, sessionCookie, token, sessionMs)
      res.redirect('/profile')
    } catch {
      console.error('Discord login failed (credentials and tokens omitted)')
      res.redirect('/profile?authError=discord')
    }
  })
  router.post('/auth/logout', async (req, res) => {
    const token = sessionToken(req.headers.cookie)
    if (token && db) {
      await db.query('DELETE FROM auth_sessions WHERE token_hash=$1', [digest(token)])
      onLogout(digest(token))
    }
    cookie(res, sessionCookie, '', 0)
    res.sendStatus(204)
  })
  router.use('/profile', async (req, res, next) => {
    const user = await authenticatedProfile(req.headers.cookie)
    if (!user) { res.status(401).json({ error: 'Войдите через Discord' }); return }
    res.locals.profile = user
    next()
  })
  router.get('/profile', (_req, res) => { res.json({ user: res.locals.profile }) })
  router.patch('/profile', async (req, res) => {
    if (!validNickname(req.body?.nickname)) { res.status(400).json({ error: 'Ник: от 1 до 32 символов, без управляющих символов' }); return }
    const { rows } = await db!.query('UPDATE profiles SET nickname=$1,updated_at=now() WHERE id=$2 RETURNING id,nickname,avatar_url AS "avatarUrl"',
      [req.body.nickname.trim(), res.locals.profile.id])
    res.json({ user: rows[0] })
  })
  const columns = `m.id,m.finished_at AS "finishedAt",m.player_count AS "playerCount",m.game_mode AS "gameMode",
    m.target_coef AS "targetCoef",m.random_target_coef AS "randomTargetCoef",p.starting_coef AS "startingCoef",
    p.admitted,p.elimination_order AS "eliminationOrder"`
  router.get('/profile/matches', async (req, res) => {
    const offset = Math.min(100000, Math.max(0, Number(req.query.offset) || 0)) | 0
    const { rows } = await db!.query(`SELECT ${columns} FROM match_players p JOIN matches m ON m.id=p.match_id
      WHERE p.profile_id=$1 ORDER BY m.finished_at DESC,m.id DESC LIMIT 21 OFFSET $2`, [res.locals.profile.id, offset])
    res.json({ matches: rows.slice(0, 20), hasMore: rows.length > 20 })
  })
  router.get('/profile/matches/:id', async (req, res) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(req.params.id))) { res.sendStatus(404); return }
    const { rows } = await db!.query(`SELECT ${columns},p.starting_traits AS characteristics FROM match_players p
      JOIN matches m ON m.id=p.match_id WHERE p.profile_id=$1 AND m.id=$2`, [res.locals.profile.id, req.params.id])
    if (!rows[0]) { res.status(404).json({ error: 'Матч не найден' }); return }
    res.json(rows[0])
  })
  router.use((_req, res) => { res.status(404).json({ error: 'API endpoint not found' }) })
  router.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Profile API request failed (details omitted)')
    res.status(503).json({ error: 'Профиль временно недоступен. Попробуйте позже.' })
  })
  return router
}
