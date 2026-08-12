import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types'
import { LobbyManager } from './lobby'

type IO = Server<ClientToServerEvents, ServerToClientEvents>
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>

interface SocketData {
  name: string
  lobbyCode: string
}

/** Подключает все обработчики socket-событий к серверу. */
export function registerSocketHandlers(io: IO): void {
  const manager = new LobbyManager(io)

  io.on('connection', (socket: GameSocket) => {
    const { name, lobbyCode } = socket.handshake.query as Partial<SocketData>

    if (!name || !lobbyCode) {
      socket.disconnect()
      return
    }

    socket.data.name = name
    socket.data.lobbyCode = lobbyCode
    socket.join(lobbyCode)

    const lobby = manager.getOrCreate(lobbyCode)
    const joined = lobby.addPlayer(socket.id, name)
    if (!joined) {
      socket.emit('errorMessage', { message: 'Не удалось присоединиться к лобби' })
      socket.disconnect()
      return
    }

    console.log(`${name} подключился к лобби ${lobbyCode}`)

    socket.on('startGame', () => lobby.start(socket.id))
    socket.on('revealCharacteristic', ({ characteristicType }) =>
      lobby.reveal(socket.id, characteristicType),
    )
    socket.on('vote', ({ targetId }) => lobby.vote(socket.id, targetId))
    socket.on('resolveVote', () => lobby.resolveVote(socket.id))
    socket.on('pauseGame', () => lobby.pause(socket.id))
    socket.on('resumeGame', () => lobby.resume(socket.id))
    socket.on('resetTimer', ({ timerValue } = {}) => lobby.resetTimer(socket.id, timerValue))
    socket.on('nextStage', ({ timerValue } = {}) => lobby.nextStage(socket.id, timerValue))

    socket.on('disconnect', () => {
      lobby.removePlayer(socket.id)
      if (lobby.isEmpty()) manager.remove(lobbyCode)
      console.log(`${name} отключился от лобби ${lobbyCode}`)
    })
  })
}
