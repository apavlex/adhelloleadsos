FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
