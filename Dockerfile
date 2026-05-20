# better-sqlite3 compiles native bindings via node-gyp (needs Python + build tools).
FROM node:20-slim AS deps

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-slim

WORKDIR /app

# Runtime library for SQLite (used by better-sqlite3).
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY . .

RUN mkdir -p /app/data

ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "server.js"]
