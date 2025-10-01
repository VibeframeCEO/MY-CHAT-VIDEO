# Use Node 20 (Debian based)
FROM node:20-bullseye

# Install runtime/build deps for node-canvas + ffmpeg + fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    ffmpeg \
    fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first (layer caching)
COPY package*.json ./
RUN npm install --omit=dev

# Copy custom font into image
COPY font /app/font

# Copy the rest of your code
COPY . .

# (Optional) make PORT explicit; Railway sets it anyway
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
