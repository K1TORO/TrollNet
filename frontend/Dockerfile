# Build context: ./frontend
FROM node:22-alpine AS build
WORKDIR /app

# Uses the lockfile when present (reproducible), otherwise resolves the pinned versions in package.json.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install --no-audit --no-fund; fi

COPY . .
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
