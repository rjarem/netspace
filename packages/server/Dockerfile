FROM node:22-alpine
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY ../../pnpm-lock.yaml ./
RUN npm install -g pnpm@12
COPY . .
CMD ["node", "dist/index.js"]