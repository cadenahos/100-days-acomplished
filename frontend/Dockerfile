# Build stage
FROM node:22-alpine AS build
WORKDIR /app
# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate
ARG VITE_API_URL
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set minimumReleaseAge 0
RUN pnpm install
COPY . .
RUN pnpm run build

# Runtime stage
FROM nginx:alpine AS final
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
