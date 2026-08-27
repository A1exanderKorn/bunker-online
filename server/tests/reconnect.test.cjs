const assert = require('node:assert/strict')
const test = require('node:test')

const { registerSocketHandlers } = require('../dist/server/socket.js')

function createHarness() {
  const emitted = []
  let connectHandler

  const io = {
    sockets: { sockets: new Map() },
    on(event, handler) {
      if (event === 'connection') connectHandler = handler
    },
    to(target) {
      return {
        emit(event, payload) {
          emitted.push({ target, event, payload })
        },
      }
    },
  }

  registerSocketHandlers(io)

  function connect(id, query) {
    const handlers = new Map()
    const direct = []
    const socket = {
      id,
      handshake: { query },
      data: {},
      disconnected: false,
      join() {},
      leave() {},
      on(event, handler) {
        handlers.set(event, handler)
      },
      emit(event, payload) {
        direct.push({ event, payload })
      },
      disconnect() {
        if (this.disconnected) return
        this.disconnected = true
        handlers.get('disconnect')?.()
      },
    }
    io.sockets.sockets.set(id, socket)
    connectHandler(socket)
    return { socket, direct }
  }

  return { connect, emitted }
}

function lastEvent(emitted, target, event) {
  return emitted.filter((item) => item.target === target && item.event === event).at(-1)?.payload
}

test('новая вкладка добавляет игрока, а F5 восстанавливает того же хоста', () => {
  const { connect, emitted } = createHarness()
  const lobbyCode = 'TEST'

  const firstHost = connect('socket-host-1', {
    name: 'Хост',
    lobbyCode,
    mode: 'create',
    clientId: 'tab-host',
  })
  const firstWelcome = lastEvent(emitted, 'socket-host-1', 'welcome')
  assert.ok(firstWelcome?.playerId)
  assert.equal(firstWelcome.isHost, true)

  const guest = connect('socket-guest', {
    name: 'Игрок',
    lobbyCode,
    mode: 'join',
    clientId: 'tab-guest',
  })
  const guestWelcome = lastEvent(emitted, 'socket-guest', 'welcome')
  assert.ok(guestWelcome?.playerId)
  assert.notEqual(guestWelcome.playerId, firstWelcome.playerId)
  assert.equal(guestWelcome.isHost, false)
  assert.equal(guest.direct.length, 0)

  // Реальный F5 часто сначала присылает disconnect старого сокета и только
  // затем открывает новое соединение. Игрок не должен за это время исчезнуть.
  firstHost.socket.disconnect()

  const reloadedHost = connect('socket-host-2', {
    name: 'Хост',
    lobbyCode,
    mode: 'create',
    clientId: 'tab-host',
  })
  const reconnectWelcome = lastEvent(emitted, 'socket-host-2', 'welcome')
  assert.equal(reconnectWelcome.playerId, firstWelcome.playerId)
  assert.equal(reconnectWelcome.isHost, true)
  assert.equal(reloadedHost.direct.length, 0)
  assert.equal(firstHost.socket.disconnected, true)

  guest.socket.disconnect()
  const reloadedGuest = connect('socket-guest-2', {
    name: 'Игрок',
    lobbyCode,
    mode: 'join',
    clientId: 'tab-guest',
  })
  const guestReconnectWelcome = lastEvent(emitted, 'socket-guest-2', 'welcome')
  assert.equal(guestReconnectWelcome.playerId, guestWelcome.playerId)
  assert.equal(guestReconnectWelcome.isHost, false)
  assert.equal(reloadedGuest.direct.length, 0)

  const roster = lastEvent(emitted, 'socket-guest-2', 'updatePlayers')
  assert.deepEqual(
    roster.map((player) => player.name),
    ['Хост', 'Игрок'],
  )
})
