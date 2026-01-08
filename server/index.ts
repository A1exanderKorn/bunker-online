import express from "express";
import http from "http";
import { Server } from "socket.io";

import {
  generateBiology,
  generateCharacteristics,
  loadCharacteristicsFromExcel,
  shuffleArray,
} from "./functions";

export interface ExcelRow {
  Категория: string;
  Название: string;
  КФ: number;
  Подсказка: string;
}

export type GameStage =
  | "discussionAll"
  | "firstVoting"
  | "secondVoting"
  | "discussionSingle"
  | "end";

export interface gameState {
  players: Player[];
  revealed: Record<string, string[]>;
  stage: GameStage;
  currentTurnPlayerId?: string;
  turnDeadline?: number;
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

export interface Characteristic {
  type: string;
  value: string;
  coef: number;
  hint: string;
  isVisible: boolean;
}

export interface Biology {
  sex: "М" | "Ж" | "Андроид" | "Гермафродит";
  age: number;
  experience: number;
  coef: number;
  infertile?: boolean;
  isVisible: boolean;
  hint?: string;
}

export interface Player {
  id: string;
  name: string;
  characteristics?: Characteristic[];
  biology?: Biology;
  isAlive: boolean;
}

const lobbies: Record<string, gameState> = {};

io.on("connection", (socket) => {
  const { name, lobbyCode } = socket.handshake.query as {
    name?: string;
    lobbyCode?: string;
  };
  socket.data.name = name;
  socket.data.lobbyCode = lobbyCode;

  socket.data.id = socket.id;

  if (!name || !lobbyCode) {
    socket.disconnect();
    return;
  }

  socket.join(lobbyCode);

  if (!lobbies[lobbyCode]) {
    lobbies[lobbyCode] = {
      players: [],
      revealed: {},
      stage: "discussionAll",
      currentTurnPlayerId: "",
      turnDeadline: 30,
    };
  }

  lobbies[lobbyCode].players.push({ id: socket.id, name, isAlive: true });
  lobbies[lobbyCode].revealed[socket.id] = [];

  console.log(`${name} подключился к лобби ${lobbyCode}`);

  io.to(lobbyCode).emit(
    "updatePlayers",
    lobbies[lobbyCode].players.map((p) => p.name)
  );

  socket.on("disconnect", () => {
    const lobbyCode = socket.data.lobbyCode;
    const name = socket.data.name;

    if (lobbies[lobbyCode]) {
      lobbies[lobbyCode].players = lobbies[lobbyCode].players.filter(
        (player) => player.id !== socket.id
      );

      if (lobbies[lobbyCode].players.length === 0) {
        delete lobbies[lobbyCode];
      } else {
        io.to(lobbyCode).emit(
          "updatePlayers",
          lobbies[lobbyCode].players.map((p) => p.name)
        );
      }
    }
  });

  socket.on("startGame", async () => {
    console.log("emit startGame");
    const lobby = lobbies[lobbyCode];
    if (lobby.players && lobby.players[0].id === socket.id) {
      const data = await loadCharacteristicsFromExcel("./data.xlsx");
      const byType = (type: string) =>
        data.filter((d) => d["Категория"] === type);

      let used = new Set<string>();
      const biologies: Biology[] = [];

      for (const player of lobby.players) {
        const characteristics: Characteristic[] = [];
        const biology = generateBiology(biologies);
        biologies.push(biology);

        let currentCoef = biology.coef;

        for (const category of [
          "Профессия",
          "Здоровье",
          "Хобби",
          "Фобия",
          "Багаж",
          "Факт",
        ]) {
          const result = generateCharacteristics(
            byType(category),
            used,
            currentCoef,
            characteristics.length
          );
          used = result.usedValues;
          currentCoef = result.newCoef;
          characteristics.push(result.chosen);
        }

        player.characteristics = characteristics;
        player.biology = biology;

        lobby.revealed[player.id] = []; // инициализируем массив открытых характеристик

        io.to(player.id).emit("yourCharacteristics", {
          characteristics,
          biology,
        });
      }

      lobby.players = shuffleArray(lobby.players); //todo - добавить решафл нормально
      lobby.currentTurnPlayerId = lobby.players[0].id;
      lobby.turnDeadline = 30;
      lobby.stage = "discussionAll";

      io.to(lobbyCode).emit("gameStarted", {
        players: lobby.players.map((p) => ({
          id: p.id,
          name: p.name,
          characteristics: [], // все скрыты
          biology: undefined,
          isAlive: true,
        })),
      });

      let arrayOfAlive = lobby.players.map((p) => {
        p.isAlive === true;
      });

      io.to(lobbyCode).emit("setGameStage", {
        gameStage: {
          stage: lobby.stage,
          timer: lobby.turnDeadline,
        },
      });

      console.log(`🎮 Игра в лобби ${lobbyCode} началась!`);
      for (const player of lobby.players) {
        console.log(player.name);
        console.log(player.biology);
        console.log(player.characteristics);
      }
    }
  });

  socket.on("revealCharacteristic", ({ playerId, characteristicType }) => {
    const lobby = lobbies[lobbyCode];
    if (!lobby) return;

    const isBiology = characteristicType === "Биология";
    // Проверяем, что игрок существует
    const player = lobby.players.find((p) => p.id === playerId);
    if (!player || !player.characteristics) return;

    // Находим характеристику

    const char = !isBiology
      ? player.characteristics.find((c) => c.type === characteristicType)
      : player.biology;
    if (!char) {
      return;
    }

    char.isVisible = true;

    lobby.revealed[playerId].push(characteristicType);

    io.to(lobbyCode).emit("characteristicsUpdated", {
      players: lobby.players.map((p) => ({
        id: p.id,
        name: p.name,
        characteristics: p.characteristics?.filter((c) => c.isVisible),
        biology: p.biology?.isVisible ? p.biology : undefined,
      })),
    });

    // if(lobby[get])

    io.to(lobbyCode).emit("setGameStage", {});
  });

  socket.on("registerVote", ({ playerId }) => {
    //todo
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
