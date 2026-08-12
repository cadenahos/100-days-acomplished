# Build stage
FROM node:22-alpine AS build
WORKDIR /app
# corepack picks the exact pnpm from package.json's "packageManager" field,
# so the image can never drift onto a different pnpm than CI uses.
RUN corepack enable

# Only the Google client ID is a genuine build-time constant. The API URL is
# NOT baked in any more — nginx proxies /api at runtime instead.
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

# pnpm-workspace.yaml carries the allowBuilds approval; without it the install
# fails with ERR_PNPM_IGNORED_BUILDS.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm config set minimumReleaseAge 0
RUN pnpm install --frozen-lockfile
COPY . .
RUN if [ -z "$VITE_GOOGLE_CLIENT_ID" ]; then \
      echo "WARNING: VITE_GOOGLE_CLIENT_ID is empty — Google sign-in will not work." >&2; \
    fi
RUN pnpm run build

# Runtime stage
FROM nginx:alpine AS final
RUN apk add --no-cache gettext curl
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/nginx.conf.template
COPY docker-entrypoint.sh /docker-entrypoint-custom.sh
RUN chmod +x /docker-entrypoint-custom.sh

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/docker-entrypoint-custom.sh"]
