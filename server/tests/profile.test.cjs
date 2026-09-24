const test = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID, randomBytes } = require('node:crypto')
const express = require('express')
const { PGlite } = require('@electric-sql/pglite')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bunker-history-test-'))
process.env.HISTORY_OUTBOX_DIR = outboxDir

// Real PostgreSQL engine (WASM), isolated from DATABASE_URL and production data.
delete process.env.DATABASE_URL
process.env.APP_ORIGIN = 'http://localhost:5173'
process.env.DISCORD_CLIENT_ID = 'test-client'
process.env.DISCORD_CLIENT_SECRET = 'test-secret'
const database = require('../dist/server/database.js')
const pg = new PGlite()
const adapter = {
  async query(sql, params) {
    const result = params ? await pg.query(sql, params) : (await pg.exec(sql)).at(-1)
    return { rows: result?.rows || [], rowCount: result?.affectedRows || result?.rows?.length || 0 }
  },
  async connect() { return { query: adapter.query, release() {} } },
}
database.db = adapter
const { profileApi, digest, validNickname, discordAvatar } = require('../dist/server/auth.js')
const { MatchRecorder, persistMatch, enqueueMatch, drainHistory } = require('../dist/server/matchHistory.js')
let server, base
const fetchReal = global.fetch
const token = randomBytes(32).toString('hex')
const otherToken = randomBytes(32).toString('hex')
const userId = randomUUID(), otherId = randomUUID()
const headers = { Cookie: `bunker_session=${token}`, Origin: 'http://localhost:5173',
  'X-Profile-Request': '1', 'Content-Type': 'application/json' }
let revoked = []
test.before(async () => {
  await database.migrate()
  await database.migrate()
  for (const [id, nick, session] of [[userId, 'Локальный ник', token], [otherId, 'Второй', otherToken]]) {
    await adapter.query('INSERT INTO profiles (id,discord_id,nickname,avatar_url) VALUES ($1,$2,$3,$4)', [id, id === userId ? '1234567890' : '2345678901', nick, 'https://cdn.discordapp.com/embed/avatars/0.png'])
    await adapter.query("INSERT INTO auth_sessions VALUES ($1,$2,now()+interval '1 day')", [digest(session), id])
  }
  const app = express()
  app.use(express.json())
  app.use('/api', profileApi(hash => revoked.push(hash)))
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}/api`
})
test.after(async () => {
  global.fetch = fetchReal
  await new Promise(resolve => server.close(resolve))
  await pg.close()
  fs.rmSync(outboxDir, {recursive:true,force:true})
})

test('nickname validation and Discord avatar defaults', () => {
  assert.equal(validNickname('  Игрок  '), true)
  for (const value of ['', ' '.repeat(10), 'a'.repeat(33), 'hi\nthere', 123]) assert.equal(validNickname(value), false)
  assert.match(discordAvatar({ id: '1234567890', avatar: 'a_abc', discriminator: '0' }), /avatars\/1234567890\/a_abc.png/)
  assert.match(discordAvatar({ id: '1234567890', avatar: null, discriminator: '1234' }), /avatars\/4.png/)
})
test('guest cannot read profile/history; authenticated nickname update requires CSRF protection', async () => {
  assert.equal((await fetchReal(base+'/profile')).status, 401)
  assert.equal((await fetchReal(base+'/profile/matches')).status, 401)
  const invalid = await fetchReal(base+'/profile', { method: 'PATCH', headers: { Cookie: headers.Cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({nickname:'Stolen'}) })
  assert.equal(invalid.status, 403)
  assert.equal((await fetchReal(base+'/profile', { method:'PATCH', headers, body:'{"nickname":""}' })).status,400)
  const saved = await fetchReal(base+'/profile', { method:'PATCH', headers, body:'{"nickname":"Новый ник"}' })
  assert.equal(saved.status, 200)
  assert.equal((await saved.json()).user.nickname, 'Новый ник')
  assert.equal(saved.headers.get('cache-control'), 'no-store')
})
test('initial snapshot stays unchanged; guest elimination counts; repeated finish/write is idempotent; history is private', async () => {
  const players = [
    { id:'guest', name:'Гость', characteristics:[], biology:null },
    { id:'one', profileId:userId, characteristics:[{ type:'Багаж', value:'Аптечка', coef:.8, occ:0 }, {type:'Багаж',value:'Рация',coef:.6,occ:1}], biology:{sex:'Ж',age:24,experience:3,infertile:false,coef:.9} },
    { id:'two', profileId:otherId, characteristics:[], biology:null },
  ]
  const expectedCoef = require('../dist/server/cards.js').averageCoef(players[1], 'classic')
  const recorder = new MatchRecorder(players,'classic',0.65,false)
  players[1].characteristics[0].value = 'После обмена'
  players[1].biology.age = 70
  recorder.eliminate('guest')
  recorder.eliminate('one')
  recorder.eliminate('one')
  const match = recorder.finish(['two'])
  assert.equal(recorder.finish(['two']),null)
  assert.equal(match.players.length,2)
  assert.equal(match.players[0].eliminationOrder,2)
  await persistMatch(match)
  await persistMatch(match)
  const list = await (await fetchReal(base+'/profile/matches', {headers})).json()
  assert.equal(list.matches.length,1)
  assert.equal(list.matches[0].playerCount,3)
  assert.equal(list.matches[0].admitted,false)
  assert.equal(list.matches[0].eliminationOrder,2)
  assert.equal(list.matches[0].targetCoef,0.65)
  assert.equal(list.matches[0].randomTargetCoef,false)
  assert.ok(Math.abs(list.matches[0].startingCoef - expectedCoef) < 0.00001)
  assert.equal(list.matches[0].characteristics,undefined)
  const details = await (await fetchReal(base+`/profile/matches/${match.id}`, {headers})).json()
  assert.match(details.characteristics[0].value,/24 лет/)
  assert.equal(details.characteristics[1].value,'Аптечка')
  assert.equal(details.characteristics[1].type,'Багаж #1')
  assert.equal(details.characteristics[1].coef,0.8)
  const other = await (await fetchReal(base+`/profile/matches/${match.id}`, {headers:{Cookie:`bunker_session=${otherToken}`}})).json()
  assert.equal(other.admitted,true)
  assert.deepEqual(other.characteristics,[])
  assert.equal((await fetchReal(base+`/profile/matches/${randomUUID()}`, {headers})).status,404)
  assert.equal((await fetchReal(base+'/profile/matches/invalid', {headers})).status,404)
})
test('expired sessions are rejected and stale browser cookie is cleared', async () => {
  const expired = randomBytes(32).toString('hex')
  await adapter.query("INSERT INTO auth_sessions VALUES ($1,$2,now()-interval '1 second')", [digest(expired), userId])
  const cookie = {Cookie:`bunker_session=${expired}`}
  assert.equal((await fetchReal(base+'/profile', {headers:cookie})).status,401)
  const response = await fetchReal(base+'/auth/session', {headers:cookie})
  assert.equal((await response.json()).user,null)
  assert.match(response.headers.get('set-cookie'),/Max-Age=0/)
})
test('Discord OAuth state binding, single use, nickname preservation and avatar refresh', async () => {
  let exchanged = 0
  global.fetch = async (url, options) => {
    if (String(url).startsWith('https://discord.com/api/oauth2/token')) {
      exchanged++
      assert.equal(options.body.get('client_secret'),'test-secret')
      return Response.json({access_token:'fake-test-access-token'})
    }
    if (String(url).startsWith('https://discord.com/api/v10/users/@me')) {
      return Response.json({id:'1234567890',username:'Discord name',global_name:'Changed Discord',avatar:'abc',discriminator:'0'})
    }
    return fetchReal(url, options)
  }
  const start = await fetchReal(base+'/auth/discord', {redirect:'manual'})
  const state = new URL(start.headers.get('location')).searchParams.get('state')
  assert.equal(new URL(start.headers.get('location')).searchParams.get('scope'),'identify')
  assert.match(start.headers.get('set-cookie'),/HttpOnly/)
  const invalid = await fetchReal(base+`/auth/discord/callback?code=test&state=${state}`, {redirect:'manual'})
  assert.equal(invalid.headers.get('location'),'/profile?authError=state')
  assert.equal(exchanged,0)
  const cookie = start.headers.get('set-cookie').split(';')[0]
  const callback = await fetchReal(base+`/auth/discord/callback?code=test&state=${state}`, {redirect:'manual',headers:{Cookie:cookie}})
  assert.equal(callback.headers.get('location'),'/profile')
  const profile = (await adapter.query('SELECT * FROM profiles WHERE id=$1',[userId])).rows[0]
  assert.equal(profile.nickname,'Новый ник')
  assert.match(profile.avatar_url,/\/abc.png/)
  assert.equal(exchanged,1)
  await fetchReal(base+`/auth/discord/callback?code=test&state=${state}`, {redirect:'manual',headers:{Cookie:cookie}})
  assert.equal(exchanged,1)
  global.fetch = fetchReal
})
test('logout revokes server session and notifies sockets', async () => {
  assert.equal((await fetchReal(base+'/auth/logout',{method:'POST',headers})).status,204)
  assert.deepEqual(revoked,[digest(token)])
  assert.equal((await fetchReal(base+'/profile',{headers})).status,401)
})

test('completed match survives a DB outage in the on-disk queue and retries without duplicates', async () => {
  const match = {id:randomUUID(),startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),playerCount:2,gameMode:'new',
    players:[{profileId:userId,admitted:true,eliminationOrder:null,characteristics:[]}]}
  database.db = { async connect() { throw new Error('Simulated outage') } }
  enqueueMatch(match)
  await new Promise(resolve=>setTimeout(resolve,30))
  assert.ok(fs.existsSync(path.join(outboxDir,match.id+'.json')))
  database.db = adapter
  await drainHistory()
  assert.equal(fs.existsSync(path.join(outboxDir,match.id+'.json')),false)
  await persistMatch(match)
  assert.equal((await adapter.query('SELECT count(*)::int AS count FROM matches WHERE id=$1',[match.id])).rows[0].count,1)
})
