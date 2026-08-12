import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types'
import { SERVER_URL } from '@/config'

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

let socket: GameSocket | null = null

/** Создаёт (или пересоздаёт) подключение к серверу для данного лобби. */
export function connectSocket(name: string, lobbyCode: string): GameSocket {
  if (socket) socket.disconnect()
  socket = io(SERVER_URL, { query: { name, lobbyCode } })
  return socket
}

/** Текущий сокет, если подключение установлено. */
export function getSocket(): GameSocket | null {
  return socket
}

export function disconnectSocket(): void {
  socket?.disconnect()
  socket = null
}
