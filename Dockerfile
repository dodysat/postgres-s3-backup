# Use Node.js 22 Alpine as base image for smaller size
FROM node:22-alpine

# Install PostgreSQL client tools required for pg_dump
RUN apk add --no-cache postgresql-client

# Create app directory
WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy the built application
COPY dist/ ./dist/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of the app directory to nodejs user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose no ports as this is a background service

# Set the command to run the application
CMD ["node", "dist/index.js"]