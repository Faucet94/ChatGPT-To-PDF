FROM mcr.microsoft.com/playwright:v1.40.0-jammy
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build -w packages/shared -w packages/core -w packages/queue -w packages/renderer -w packages/templates -w packages/storage -w apps/worker
CMD ["node", "apps/worker/dist/index.js"]
