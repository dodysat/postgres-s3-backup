FROM node:22-alpine

# Install PostgreSQL client tools
RUN apk add --no-cache postgresql-client

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built app
COPY dist/ ./dist/

# Use non-root user for security
USER node

CMD ["node", "dist/index.js"] 