import { io, Socket } from 'socket.io-client'
import { useLobbyStore } from '@/stores/lobby'

let socket: Socket

export function connectSocket(name: string, code: string, isHost: boolean) {
  const store = useLobbyStore()
  socket = io('http://localhost:5173/lobby')

  socket.on('connect', () => {
    socket.emit(isHost ? 'create_lobby' : 'join_lobby', { name, code })
    console.log(1)
  })

  socket.on('lobby_update', (players: string[]) => {
    store.updatePlayers(players)
    console.log(2)
  })
}

export function startGame() {
  socket.emit('start_game')
  console.log(3)
}
