FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY src ./src
RUN npm run build

ENV NODE_ENV=production

CMD ["npm", "run", "start"]
