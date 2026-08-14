FROM node:22-alpine
WORKDIR /app

COPY shared ./shared
COPY server ./server
COPY frontend ./frontend
COPY package.json ./

RUN npm --prefix server ci
RUN npm --prefix frontend ci
RUN npm --prefix frontend run build-only
RUN npm --prefix server run build

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/dist/server/index.js"]
