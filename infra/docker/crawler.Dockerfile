FROM mcr.microsoft.com/playwright:v1.49.0-jammy
WORKDIR /app
COPY package.json ./
COPY apps/crawler/package.json ./apps/crawler/package.json
RUN npm install
COPY apps/crawler ./apps/crawler
CMD ["npm", "--workspace", "apps/crawler", "run", "start"]
