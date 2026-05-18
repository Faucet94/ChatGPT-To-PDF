FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build -w packages/shared -w packages/core -w packages/queue -w packages/renderer -w packages/templates -w packages/storage -w apps/api
EXPOSE 3027
CMD ["node", "apps/api/dist/index.js"]
