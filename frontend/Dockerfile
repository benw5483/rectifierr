FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Place config in nginx's template directory so BACKEND_URL is substituted at start.
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Default works for docker-compose (service name resolves via compose network).
# Override with the Unraid host IP when running via native Docker Add Container.
ENV BACKEND_URL=http://backend:8000

# Only substitute ${BACKEND_URL} — leave nginx's own $host, $uri, $remote_addr alone.
ENV NGINX_ENVSUBST_FILTER='${BACKEND_URL}'

EXPOSE 80
