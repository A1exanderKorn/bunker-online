import type { Server, Socket } from 'socket.io'
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types'
import { LobbyManager } from './lobby'

type IO = Server<ClientToServerEvents, ServerToClientEvents>
type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>

interface HandshakeQuery {
  name: string
  lobbyCode: string
  /** 'create' — создать новое лобби, 'join' — войти в существующее. */
  mode: 'create' | 'join'
}

const CODE_RE = /^[A-Z]{4}$/

/** Подключает все обработчики socket-событий к серверу. */
export function registerSocketHandlers(io: IO): void {
  const manager = new LobbyManager(io)

  io.on('connection', (socket: GameSocket) => {
    const q = socket.handshake.query as Partial<HandshakeQuery>
    const name = (q.name ?? '').trim()
    const lobbyCode = (q.lobbyCode ?? '').toUpperCase()
    const mode = q.mode === 'create' ? 'create' : 'join'

    if (!name || !CODE_RE.test(lobbyCode)) {
      socket.emit('errorMessage', { message: 'Некорректное имя или код лобби' })
      socket.disconnect()
      return
    }

    // Разделяем создание и присоединение, чтобы опечатка в коде не плодила
    // пустые лобби, а вход в несуществующее лобби давал внятную ошибку.
    let lobby = manager.get(lobbyCode)
    if (mode === 'create') {
      if (lobby && !lobby.isEmpty()) {
        socket.emit('errorMessage', { message: 'Лобби с таким кодом уже существует' })
        socket.disconnect()
        return
      }
      lobby = manager.getOrCreate(lobbyCode)
    } else {
      if (!lobby || lobby.isEmpty()) {
        socket.emit('errorMessage', { message: 'Лобби не найдено' })
        socket.disconnect()
        return
      }
    }

    // Входим в комнату ДО добавления игрока, чтобы broadcast со списком дошёл и до нас (I.5).
    socket.join(lobbyCode)
    const playerId = lobby.addOrReconnect(socket.id, name)
    if (!playerId) {
      socket.leave(lobbyCode)
      socket.emit('errorMessage', {
        message: lobby.started
          ? 'Игра уже началась, вход закрыт (или имя занято)'
          : 'Не удалось присоединиться к лобби (имя занято или лобби заполнено)',
      })
      socket.disconnect()
      return
    }

    socket.data.playerId = playerId
    socket.data.lobbyCode = lobbyCode

    // Отправляем приветствие + полный снапшот состояния (важно для реконнекта).
    lobby.snapshotFor(playerId)

    console.log(`${name} (${playerId}) подключился к лобби ${lobbyCode} [${mode}]`)

    socket.on('updateSettings', ({ settings }) => lobby!.updateSettings(playerId, settings))
    socket.on('startGame', () => lobby!.start(playerId))
    socket.on('beginRounds', () => lobby!.beginRounds(playerId))
    socket.on('newGame', () => lobby!.newGame(playerId))
    socket.on('playCard', ({ instanceId, targets }) => lobby!.playCard(playerId, instanceId, targets))
    socket.on('adminGiveCard', ({ cardId }) => lobby!.adminGiveCard(playerId, cardId))
    socket.on('requestCatalog', () => lobby!.sendCatalog(playerId))
    socket.on('revealCharacteristic', ({ characteristicType, occ }) =>
      lobby!.reveal(playerId, characteristicType, occ ?? 0),
    )
    socket.on('endTurn', () => lobby!.endTurn(playerId))
    socket.on('vote', ({ targetId }) => lobby!.vote(playerId, targetId))
    socket.on('resolveVote', () => lobby!.resolveVote(playerId))
    socket.on('pauseGame', () => lobby!.pause(playerId))
    socket.on('resumeGame', () => lobby!.resume(playerId))
    socket.on('resetTimer', () => lobby!.resetTimer(playerId))

    socket.on('disconnect', () => {
      lobby!.handleDisconnect(playerId)
      if (lobby!.isEmpty()) manager.remove(lobbyCode)
      console.log(`${name} (${playerId}) отключился от лобби ${lobbyCode}`)
    })
  })
}
