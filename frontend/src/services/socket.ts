import { io, Socket } from 'socket.io-client'

export let socket: Socket

export function connectSocket(name: string, lobbyCode: string) {
  if (!socket || !socket.connected) {
    socket = io('ws://localhost:3000', {
      query: { name, lobbyCode }
    })

    socket.on('connect', () => {
      console.log('Connected to server')
    })

    socket.on('disconnect', () => {
      console.log('Disconnected from server')
    })
  }
}