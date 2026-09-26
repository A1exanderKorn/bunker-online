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

  function connect(id, query, profile) {
    const handlers = new Map()
    const direct = []
    const socket = {
      id,
      handshake: { query },
      data: { profile },
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
    return { socket, direct, send: (event, payload) => handlers.get(event)?.(payload) }
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

test('аккаунт использует серверный ник, гостевой clientId не перехватывает аккаунт', () => {
  const { connect, emitted } = createHarness()
  const profile = {id:'trusted-profile',nickname:'Профиль',avatarUrl:'https://cdn.discordapp.com/embed/avatars/0.png'}
  const host = connect('account-one',{name:'Поддельное имя',lobbyCode:'AUTH',mode:'create',clientId:'one'},profile)
  const hostId = lastEvent(emitted,'account-one','welcome').playerId
  connect('fake',{name:'Гость',lobbyCode:'AUTH',mode:'join',clientId:'account:trusted-profile',profileId:'trusted-profile'})
  const fakeId = lastEvent(emitted,'fake','welcome').playerId
  assert.notEqual(fakeId,hostId)
  assert.equal(host.socket.disconnected,false)
  connect('account-two',{name:'Другое',lobbyCode:'AUTH',mode:'join',clientId:'different-device'},profile)
  assert.equal(lastEvent(emitted,'account-two','welcome').playerId,hostId)
  assert.equal(host.socket.disconnected,true)
  const roster = lastEvent(emitted,'account-two','updatePlayers')
  assert.deepEqual(roster.map(p=>p.name),['Профиль','Гость'])
  assert.equal(roster[0].avatarUrl,profile.avatarUrl)
  assert.equal(roster[0].profileId,undefined)
})

test('сокет кикает гостя только по команде актуального хоста и разрешает ему вернуться', () => {
  const { connect, emitted } = createHarness()
  const query = { name: 'Хост', lobbyCode: 'KICK', mode: 'create', clientId: 'host-kick' }
  const host = connect('kick-host', query)
  const guestQuery = { name: 'Гость', lobbyCode: 'KICK', mode: 'join', clientId: 'guest-kick' }
  const guest = connect('kick-guest', guestQuery)
  const guestId = lastEvent(emitted, 'kick-guest', 'welcome').playerId
  const hostId = lastEvent(emitted, 'kick-host', 'welcome').playerId
  guest.send('kickPlayer', { playerId: hostId })
  assert.equal(host.socket.disconnected, false)
  const nextHost = connect('kick-host-new', query)
  host.send('kickPlayer', { playerId: guestId })
  assert.equal(guest.socket.disconnected, false)
  nextHost.send('kickPlayer', { playerId: guestId })
  assert.equal(guest.socket.disconnected, true)
  assert.ok(guest.direct.some(e => e.event === 'kicked'))
  const returned = connect('kick-guest-new', guestQuery)
  assert.equal(returned.socket.disconnected, false)
  assert.ok(lastEvent(emitted, 'kick-guest-new', 'welcome').playerId)
})
