# Sales Assist 2.0 — image produksi (multi-stage). better-sqlite3 dikompilasi/diunduh pada stage build.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3001 DB_PATH=/app/data/sales_assist.db
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json server.js ./
COPY src ./src
COPY public ./public
COPY data/master_data_seed.json data/Template_SE.xlsx ./seed/
# Template SE & seed dibaca dari ./data; folder data dijadikan volume sehingga berkas bawaan disalin saat start.
RUN mkdir -p /app/data && chown -R node:node /app
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
