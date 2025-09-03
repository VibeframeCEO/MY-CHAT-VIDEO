# Use Node 20 (compatible with canvas v2)
FROM node:20-bullseye

# Install runtime/build deps for node-canvas
# (these names are for Debian; Railway base images use Debian)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (better layer caching)
COPY package*.json ./
# Use npm install (not ci) so it works even without a lock file sync
RUN npm install --omit=dev

# Copy the rest
COPY . .

# (Optional) make PORT explicit; Railway will set it anyway
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
