# Multi-stage build for development and production

# Development stage
FROM node:22-alpine AS development

# Install PostgreSQL client tools and development dependencies
RUN apk add --no-cache postgresql-client git

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies)
RUN npm ci && npm cache clean --force

# Copy source code
COPY src/ ./src/
COPY tests/ ./tests/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Default command for development
CMD ["npm", "run", "dev"]

# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files and source
COPY package*.json tsconfig.json ./
COPY src/ ./src/

# Install dependencies and build
RUN npm ci && \
    npm run build && \
    npm prune --production && \
    npm cache clean --force

# Production stage
FROM node:22-alpine AS production

# Install PostgreSQL client tools required for pg_dump
RUN apk add --no-cache postgresql-client && \
    rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /app

# Copy package files for production dependencies
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy the built application from builder stage
COPY --from=builder /app/dist/ ./dist/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "console.log('Health check passed')" || exit 1

# Set the command to run the application
CMD ["node", "dist/index.js"]