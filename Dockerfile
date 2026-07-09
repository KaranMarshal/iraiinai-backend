# Build stage
FROM node:20-alpine AS builder

WORKDIR /usr/src/app

# Install dependencies for building
COPY package*.json ./
RUN npm ci

# Copy source code and build
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /usr/src/app

# Set Node environment to production
ENV NODE_ENV=production

# Copy only package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy the built dist directory from the builder stage
COPY --from=builder /usr/src/app/dist ./dist

# Create uploads directory for local media fallback
RUN mkdir -p uploads

# Expose the port the app runs on
EXPOSE 5000

# Start the application
CMD ["node", "dist/server.js"]
