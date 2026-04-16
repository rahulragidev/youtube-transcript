FROM oven/bun:1-debian AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Download yt-dlp binary (prebuild script equivalent for Docker)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ./yt-dlp \
    && chmod +x ./yt-dlp \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY src/ src/

FROM oven/bun:1-debian

WORKDIR /app

# Install curl + ca-certs (needed by yt-dlp for HTTPS)
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/src ./src
COPY --from=builder /app/yt-dlp ./yt-dlp

EXPOSE 3004

CMD ["bun", "run", "src/index.ts"]
