# ==========================================
# ALPHA ENGINE CONTROL PLANE - DOCKERFILE
# ==========================================

# Use the official Node 20 alpine image for a compact and secure container
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency configuration files
COPY package*.json ./

# Install all dependencies (development + production) needed to build the app
RUN npm ci

# Copy the rest of the application files
COPY . .

# Build the front-end (Vite) and back-end (ESBuild) production bundles
RUN npm run build

# --- Runtime stage ---
FROM node:20-bookworm-slim

WORKDIR /app

# Ensure we're running under production environment
ENV NODE_ENV=production

# Install system runtime requirements (Python 3, pip, curl, ca-certificates)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy configuration files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy Python requirements and install pinned quantitative dependencies
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt || true

# Copy the compiled artifacts from the builder context
COPY --from=builder /app/dist ./dist

# Copy quant python engines and config resources
COPY *.py ./
COPY *.json ./

# Google Cloud Run injects PORT (default 8080)
ENV PORT=8080
EXPOSE 8080

# Start modern hybrid low-latency server
CMD ["node", "dist/server.cjs"]
