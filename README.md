# Бункер онлайн

Браузерная версия карточной игры «Бункер»: лобби, вскрытие характеристик, голосование, карты действия из `server/data.xlsx`.

## Локальный запуск

```bash
# сервер
cd server && npm i && npm run dev

# фронтенд (другой терминал)
cd frontend && npm i && npm run dev
```

Фронтенд: http://localhost:5173 · API/сокеты: http://localhost:3000

## Деплой

Проект рассчитан на **один Node-сервис** (Express раздаёт собранный Vue + Socket.io). Подходят [Render](https://render.com), [Railway](https://railway.app) или [Fly.io](https://fly.io) — у всех есть WebSocket. Vercel/Netlify как serverless для сокетов не подойдут.

### Render (рекомендуется)

1. Репозиторий на GitHub.
2. New → Web Service → Docker (есть `Dockerfile` и `render.yaml`).
3. Либо без Docker:
   - Build: `npm run build`
   - Start: `npm start`
   - Node 22.

После сборки фронтенд лежит в `frontend/dist`, сервер его раздаёт сам. `VITE_SERVER_URL` в этом режиме не нужен.

### Данные

Карты, характеристики и угрозы читаются из `server/data.xlsx`. Новые категории характеристик на первом листе подхватываются автоматически (кроме «Биология» — она генерируется по правилам).
