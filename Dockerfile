# use Node base that is easier to use with canvas deps
FROM node:18-bullseye-slim

# install build deps required by canvas
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# copy package files first (cache npm install)
COPY package.json package-lock.json* /app/

RUN npm ci --production

# copy rest
COPY . /app

EXPOSE 8080

ENV PORT=8080
CMD ["node", "server.js"]
