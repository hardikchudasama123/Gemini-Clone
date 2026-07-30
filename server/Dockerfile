# ---------- API server ----------
# Build context is ./server, so this image contains no frontend code at all.
# index.js only mounts express.static when ../web/dist exists, which it never
# does here — the container is API-only by construction.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . ./

EXPOSE 8787

# Compose gates the web container on this, so nginx never starts before the
# upstream it proxies to. No curl in the base image; node's fetch is enough.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
