FROM oven/bun:1-debian AS builder

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ src/

# Bun runs TypeScript directly — no build step needed

FROM oven/bun:1-debian

WORKDIR /app

# Download latest yt-dlp binary (Debian/glibc — no Python needed)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY --from=builder /app/src ./src

EXPOSE 3004

CMD ["bun", "run", "src/index.ts"]
