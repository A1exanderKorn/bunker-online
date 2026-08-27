import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@shared/types'
import { SERVER_URL } from '@/config'

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export type JoinMode = 'create' | 'join'

let socket: GameSocket | null = null
let visibilityHooked = false
const CLIENT_ID_KEY = 'bunker.tabClientId'

/** Стабильный id вкладки: переживает F5, но не делится с другими вкладками. */
function clientId(): string {
  let value = sessionStorage.getItem(CLIENT_ID_KEY)
  if (!value) {
    value = globalThis.crypto?.randomUUID?.() ?? `c_${Date.now()}_${Math.random().toString(36).slice(2)}`
    sessionStorage.setItem(CLIENT_ID_KEY, value)
  }
  return value
}

/**
 * Форсируем реконнект при возврате на вкладку. На iOS Safari и части
 * андроид-браузеров свёрнутая вкладка замораживается, и socket.io не всегда
 * сам понимает, что соединение умерло. При разворачивании будим его вручную.
 */
function ensureVisibilityReconnect(): void {
  if (visibilityHooked || typeof document === 'undefined') return
  visibilityHooked = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (socket && !socket.connected) socket.connect()
  })
  // На некоторых браузерах focus приходит раньше visibilitychange.
  window.addEventListener('focus', () => {
    if (socket && !socket.connected) socket.connect()
  })
  // Возврат сети (например, переключение Wi-Fi/мобильные данные).
  window.addEventListener('online', () => {
    if (socket && !socket.connected) socket.connect()
  })
}

/** Создаёт (или пересоздаёт) подключение к серверу для данного лобби. */
export function connectSocket(name: string, lobbyCode: string, mode: JoinMode): GameSocket {
  if (socket) socket.disconnect()
  socket = io(SERVER_URL, {
    query: { name, lobbyCode, mode, clientId: clientId() },
    // Разрешаем socket.io-клиенту автоматически переподключаться после обрыва —
    // сервер восстановит игрока по имени в течение grace-периода.
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5_000,
    // На мобилках первый поллинг-транспорт надёжнее проходит через прокси,
    // затем socket.io сам апгрейдится до websocket.
    transports: ['polling', 'websocket'],
  })
  ensureVisibilityReconnect()
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
