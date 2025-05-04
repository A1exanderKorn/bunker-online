import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*', 
  }
})

interface Player {
  id: string
  name: string
}

const lobbies: Record<string, Player[]> = {}

io.on('connection', (socket) => {
  const { name, lobbyCode } = socket.handshake.query as { name?: string; lobbyCode?: string }
  socket.data.name = name
  socket.data.lobbyCode = lobbyCode


  if (!name || !lobbyCode) {
    socket.disconnect()
    return
  }

  socket.join(lobbyCode)

  if (!lobbies[lobbyCode]) {
    lobbies[lobbyCode] = []
  }

  lobbies[lobbyCode].push({ id: socket.id, name })

  console.log(`${name} подключился к лобби ${lobbyCode}`)

  io.to(lobbyCode).emit('updatePlayers', lobbies[lobbyCode].map(p => p.name))

  socket.on('disconnect', () => {
    const lobbyCode = socket.data.lobbyCode
    const name = socket.data.name

    if (lobbies[lobbyCode]) {
      lobbies[lobbyCode] = lobbies[lobbyCode].filter(player => player.id !== socket.id)

      if (lobbies[lobbyCode].length === 0) {
        delete lobbies[lobbyCode]
      } else {
        io.to(lobbyCode).emit('updatePlayers', lobbies[lobbyCode].map(p => p.name))
      }
    }
  })

  socket.on('startGame', () => {
    if (lobbies[lobbyCode] && lobbies[lobbyCode][0].id === socket.id) {
      io.to(lobbyCode).emit('gameStarted')
      console.log(`Игра в лобби ${lobbyCode} началась!`)
    }
  })
})

const PORT = 3000
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`)
})