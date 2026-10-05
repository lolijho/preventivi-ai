# Immagine runtime: Node + Chromium (per i PDF) + font metricamente compatibili
# con Helvetica/Arial/Liberation usati dai template.
FROM node:22-alpine

RUN apk add --no-cache \
      chromium \
      fontconfig \
      font-liberation \
      ttf-freefont \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
  && fc-cache -f

# Chromium di Alpine espose /usr/bin/chromium-browser (wrapper)
ENV CHROME_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production \
    PORT=3000

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY lib/ lib/
COPY templates/ templates/
COPY public/ public/
COPY server.js ./

EXPOSE 3000
CMD ["node", "server.js"]