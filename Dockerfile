FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
COPY src/ src/

RUN npm install && npm run build

FROM node:20-alpine

RUN apk add --no-cache python3 py3-pip \
    && pip3 install --break-system-packages yt-dlp

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 3004

CMD ["node", "dist/index.js"]
