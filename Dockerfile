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
FROM node:20-alpine

WORKDIR /app

# Ensure we're running under production environment
ENV NODE_ENV=production

# Copy configuration files and install only production-ready dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the compiled artifacts from the builder context
COPY --from=builder /app/dist ./dist

# Document that the application processes traffic on port 3000 by default (local) or $PORT (on Cloud Run)
EXPOSE 3000

# Start modern hybrid low-latency server
CMD ["node", "dist/server.cjs"]
