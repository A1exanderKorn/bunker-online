import express from 'express'
import fs from 'fs'
import http from 'http'
import path from 'path'
import cors from 'cors'
import { Server } from 'socket.io'

import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types'
import { PORT } from './config'
import { loadCharacteristics } from './data'
import { loadCards } from './cards'
import { loadBunkerData } from './bunker'
import { registerSocketHandlers } from './socket'
import { migrate } from './database'
import { appOrigin, authenticatedProfile, profileApi, sessionToken, digest } from './auth'
import { startHistoryWriter } from './matchHistory'

const app = express()
// Caddy is the only trusted proxy in Compose; never trust arbitrary forwarded hops.
app.set('trust proxy', 'loopback, linklocal, uniquelocal')
app.use(cors({ origin: appOrigin, credentials: true }))
app.use(express.json({ limit: '4kb' }))
app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: appOrigin, credentials: true },
  // Мобильные браузеры замораживают свёрнутую вкладку (JS и WebSocket-пинги встают).
  // Даём больше времени на пинг, чтобы короткое сворачивание не рвало соединение.
  pingInterval: 25_000,
  pingTimeout: 60_000,
})

try {
  loadCharacteristics()
  loadCharacteristics('new')
  loadCards()
  loadBunkerData()
  loadBunkerData('new')
} catch (err) {
  console.error('Не удалось загрузить игровые JSON:', err)
}

io.use(async (socket, next) => {
  try {
    if (socket.handshake.headers.origin && socket.handshake.headers.origin !== appOrigin) {
      next(new Error('Недопустимый источник подключения')); return
    }
    const token = sessionToken(socket.handshake.headers.cookie)
    const profile = await authenticatedProfile(socket.handshake.headers.cookie)
    if (token && !profile) { next(new Error('Сессия истекла. Войдите заново или выйдите из профиля.')); return }
    socket.data.profile = profile || undefined
    socket.data.sessionHash = token ? digest(token) : undefined
    if (profile) {
      // Keep long-lived sockets from outliving or reviving a revoked session.
      socket.use(async (_packet, proceed) => {
        try {
          const current = await authenticatedProfile(socket.handshake.headers.cookie)
          if (current?.id === profile.id) { proceed(); return }
        } catch { /* Fail closed when the session cannot be checked. */ }
        socket.disconnect(true)
        proceed(new Error('Сессия недоступна'))
      })
      const expiryCheck = setInterval(() => {
        void authenticatedProfile(socket.handshake.headers.cookie).then(current => {
          if (current?.id !== profile.id) socket.disconnect(true)
        }).catch(() => socket.disconnect(true))
      }, 60000)
      expiryCheck.unref()
      socket.on('disconnect', () => clearInterval(expiryCheck))
    }
    next()
  } catch { next(new Error('Авторизация временно недоступна')) }
})
app.use('/api', profileApi(hash => {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.sessionHash === hash) socket.disconnect(true)
  }
}))
registerSocketHandlers(io)

const frontendDist = [
  path.join(__dirname, '../frontend/dist'),
  path.join(__dirname, '../../../frontend/dist'),
  path.join(process.cwd(), 'frontend/dist'),
  path.join(process.cwd(), '../frontend/dist'),
].find((p) => fs.existsSync(path.join(p, 'index.html')))

if (frontendDist) {
  app.use(express.static(frontendDist))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/socket.io')) return next()
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
  console.log(`Статика фронтенда: ${frontendDist}`)
}

void migrate().then(() => {
  startHistoryWriter()
  server.listen(PORT, '0.0.0.0', () => console.log(`Сервер запущен на http://0.0.0.0:${PORT}`))
}).catch(() => {
  console.error('Database migration failed; refusing to start')
  process.exit(1)
})
