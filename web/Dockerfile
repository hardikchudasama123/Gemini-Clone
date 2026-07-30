# ---------- build the static bundle ----------
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . ./
RUN npm run build

# ---------- serve it ----------
# nginx serves the built assets and proxies /api to the api container, so the
# browser stays same-origin and the frontend's relative fetch('/api/…') calls
# work untouched. Nothing about the API's location is baked into the bundle.
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
