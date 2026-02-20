FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html

# Config template — processed by entrypoint.sh at start.
COPY nginx.conf /etc/nginx/templates/default.conf.template

# Custom entrypoint: runs envsubst '${BACKEND_URL}' explicitly so that
# nginx's own variables ($host, $uri, $remote_addr, etc.) are left untouched.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Default works for docker-compose (service name resolves via compose network).
# Override with the Unraid host IP when running via native Docker Add Container.
ENV BACKEND_URL=http://backend:8000

EXPOSE 80
CMD ["/entrypoint.sh"]
