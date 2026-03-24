FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV PORT=8080

EXPOSE 8080

CMD ["node", "server.js"]
