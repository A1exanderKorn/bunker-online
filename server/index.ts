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

const app = express()
app.use(cors())
app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: '*' },
})

try {
  loadCharacteristics()
  loadCards()
  loadBunkerData()
} catch (err) {
  console.error('Не удалось загрузить data.xlsx:', err)
}

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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Сервер запущен на http://0.0.0.0:${PORT}`)
})
