#!/bin/sh
set -e

# Substitute only ${BACKEND_URL} in the nginx config template,
# leaving nginx's own $host, $uri, $remote_addr, etc. untouched.
envsubst '${BACKEND_URL}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

exec nginx -g 'daemon off;'
