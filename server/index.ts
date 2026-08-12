import express from 'express'
import http from 'http'
import cors from 'cors'
import { Server } from 'socket.io'

import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types'
import { PORT } from './config'
import { loadCharacteristics } from './data'
import { registerSocketHandlers } from './socket'

const app = express()
app.use(cors())

const server = http.createServer(app)
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: '*' },
})

// Прогреваем кэш характеристик на старте, а не при каждой игре.
loadCharacteristics()

registerSocketHandlers(io)

server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`)
})
