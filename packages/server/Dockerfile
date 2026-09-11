FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install -g pnpm@12 && pnpm install --prod --ignore-scripts
COPY dist ./dist
EXPOSE 2567
CMD ["node", "src/index.ts"]