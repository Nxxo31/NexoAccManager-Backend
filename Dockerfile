# NexoAccManager Backend - Dockerfile for Railway deployment
# Uses prisma/schema.postgresql.prisma for the production build

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy Prisma files (both schemas, we'll swap at build time)
COPY prisma ./prisma/

# Install dependencies
RUN npm ci && npm cache clean --force

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Copy built files and runtime node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
# Use PostgreSQL schema for production
COPY --from=builder /app/prisma/schema.postgresql.prisma /app/prisma/schema.prisma
COPY --from=builder /app/prisma/migrations ./prisma/migrations

# Copy RSA keys
COPY --from=builder /app/private.key ./private.key
COPY --from=builder /app/public.key ./public.key

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

# Listen on the port assigned by Railway (auto-injected)
EXPOSE 3000

# Railway runs healthcheck automatically; fallback:
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# At runtime: apply migrations then start server
CMD ["sh", "-c", "npx prisma migrate deploy && node build/server.js"]