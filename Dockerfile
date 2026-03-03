# Use Playwright image for crawler capability (needed for worker)
FROM mcr.microsoft.com/playwright:v1.50.1-jammy

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
# Copy workspace package.jsons if needed for npm ci to work correctly with workspaces
COPY apps/crawler/package.json apps/crawler/
COPY apps/web/package.json apps/web/

# Install dependencies (include dev deps because Cloud Run worker uses tsx at runtime)
# Note: legacy-peer-deps might be needed depending on angular versions
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build step if needed (skipping for tsx runtime, but recommended for production to build)
# RUN npm run build

# Default to API (server)
ENV NODE_ENV=production
EXPOSE 3000

# Start script wrapper to choose service (api or worker)
CMD ["npm", "run", "start:api"]
