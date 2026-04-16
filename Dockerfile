FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY src/ src/

RUN npm ci && npm run build

FROM node:20-alpine

WORKDIR /app

# Download latest yt-dlp binary directly (no Python needed)
RUN apk add --no-cache curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3004

CMD ["node", "dist/index.js"]
