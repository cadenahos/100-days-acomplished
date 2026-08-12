#!/bin/sh
set -eu

# Cloud Run injects PORT; default to 8080 for local runs.
export PORT="${PORT:-8080}"

# BACKEND_URL is the Cloud Run URL of hundred-days-backend.
# It is read HERE, at container start — not baked into the JS bundle — so
# changing the backend URL never requires rebuilding the frontend image.
BACKEND_URL="${BACKEND_URL:-}"

if [ -z "$BACKEND_URL" ]; then
  echo "FATAL: BACKEND_URL is not set." >&2
  echo "  The frontend proxies /api to the backend and cannot start without it." >&2
  echo "  Set it on the Cloud Run service, e.g.:" >&2
  echo "    gcloud run services update hundred-days-frontend \\" >&2
  echo "      --region us-central1 \\" >&2
  echo "      --set-env-vars BACKEND_URL=https://hundred-days-backend-xxxx.run.app" >&2
  exit 1
fi

# Strip any trailing slash. With a trailing slash nginx treats proxy_pass as
# having a URI component and rewrites the path, which silently breaks /api.
BACKEND_URL="${BACKEND_URL%/}"
export BACKEND_URL

echo "[entrypoint] PORT=${PORT}"
echo "[entrypoint] BACKEND_URL=${BACKEND_URL}"

envsubst '${PORT} ${BACKEND_URL}' \
  < /etc/nginx/templates/nginx.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "[entrypoint] rendered nginx config:"
sed 's/^/[nginx.conf] /' /etc/nginx/conf.d/default.conf

nginx -t

echo "[entrypoint] starting nginx"
exec nginx -g 'daemon off;'
