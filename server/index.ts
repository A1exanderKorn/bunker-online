import express from 'express'
import http from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import * as XLSX from 'xlsx'
import fs from 'fs'

interface ExcelRow {
  type: string
  value: string
  coef: number
}


const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*', 
  }
})


interface Characteristic {
  type: string
  value: string
  coef: number
  isVisible: boolean
}

interface Biology {
  sex: 'М' | 'Ж' | 'Андроид' | 'Гермафродит'
  age: number
  experience: number
  coef: number
  infertile?: boolean
  isVisible: boolean
}

interface Player {
  id: string
  name: string
  characteristics?: Characteristic[]
  biology?: Biology
}

const lobbies: Record<string, Player[]> = {}

io.on('connection', (socket) => {
  const { name, lobbyCode } = socket.handshake.query as { name?: string; lobbyCode?: string }
  socket.data.name = name
  socket.data.lobbyCode = lobbyCode

  socket.data.id = socket.id

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

  socket.on('startGame', async () => {
    console.log("emit startGame")
    if (lobbies[lobbyCode] && lobbies[lobbyCode][0].id === socket.id) {
      const data = await loadCharacteristicsFromExcel('./data.xlsx')
  
      const byType = (type: string) => data.filter(d => d.type === type)
  
      const used = new Set<string>()
      const players = lobbies[lobbyCode]
  
      const biologies: Biology[] = []
  
      for (const player of players) {
        console.log(player.name)
        const biology = generateBiology(biologies)
        biologies.push(biology)
  
        const characteristics = [
          ...generateCharacteristics(byType('Профессия'), 1, used, biology.coef),
          ...generateCharacteristics(byType('Здоровье'), 1, used, biology.coef),
          ...generateCharacteristics(byType('Хобби'), 1, used, biology.coef),
          ...generateCharacteristics(byType('Фобия'), 1, used, biology.coef),
          ...generateCharacteristics(byType('Багаж'), 1, used, biology.coef),
          ...generateCharacteristics(byType('Факт'), 1, used, biology.coef),
          ...generateCharacteristics(byType('Карта действия'), 1, used, biology.coef),
        ]
  
        player.characteristics = characteristics
        player.biology = biology
        console.log(characteristics, biology)
        io.to(player.id).emit('yourCharacteristics', {
          characteristics,
          biology
        })
      }
  
      io.to(lobbyCode).emit('gameStarted')
      console.log(`🎮 Игра в лобби ${lobbyCode} началась!`)
    }
  })
})

const PORT = 3000
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`)
})


async function loadCharacteristicsFromExcel(path: string): Promise<ExcelRow[]> {
  const workbook = XLSX.readFile(path)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet) as ExcelRow[]
  return rows
}

function generateBiology(existing: Biology[]): Biology {
  const total = existing.length
  const hasAndroid = existing.some(b => b.sex === 'Андроид')
  const hasHerm = existing.some(b => b.sex === 'Гермафродит')

  const rand = Math.random() * 100

  let sex: 'М' | 'Ж' | 'Андроид' | 'Гермафродит'
  if (rand <= 1.75 && !hasHerm) sex = 'Гермафродит'
  else if (rand <= 1.75 + 2.75 && !hasAndroid) sex = 'Андроид'
  else sex = Math.random() < 0.5 ? 'М' : 'Ж'

  const age = Math.floor(Math.random() * (85 - 19 + 1)) + 19
  const experience = Math.floor((Math.random() * (age - 16.5)) * 2) / 2

  let coef = 0.5
  if (sex === 'Ж') {
    if (age <= 49) coef = 1.0 - 0.04 * Math.abs(32 - age)
    else coef = 0.4 - 0.01 * Math.abs(50 - age)
  } else if (sex === 'М') {
    if (age <= 59) coef = 1.0 - 0.04 * Math.abs(35 - age)
    else coef = 0.4 - 0.01 * Math.abs(60 - age)
  }

  let infertile = false
  if ((sex === 'Ж' && age <= 49) || (sex === 'М' && age <= 59)) {
    if (Math.random() < 0.25) {
      coef -= 0.4
      infertile = true
    }
  }

  return { sex, age, experience, coef, infertile, isVisible: false }
}

function generateCharacteristics(
  allData: ExcelRow[],
  count: number,
  usedValues: Set<string>,
  targetCoef: number
): Characteristic[] {
  const available = allData.filter(row => !usedValues.has(row.value))

  const selected: Characteristic[] = []

  while (selected.length < count && available.length > 0) {
    // Находим характеристику, максимально приближающую итог к 0.5
    available.sort((a, b) => {
      const distA = Math.abs((a.coef + targetCoef) / 2 - 0.5)
      const distB = Math.abs((b.coef + targetCoef) / 2 - 0.5)
      return distA - distB
    })

    const best = available.shift()!
    usedValues.add(best.value)
    selected.push({ ...best, isVisible: false })

    // Пересчитываем текущий КФ
    const sum = selected.reduce((s, c) => s + c.coef, 0)
    targetCoef = sum / selected.length
  }

  return selected
}