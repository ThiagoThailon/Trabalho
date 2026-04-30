FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY README.md ./README.md
COPY src ./src
COPY test ./test

ENV NODE_ENV=production
ENV PORT=3000
ENV SIM_MINUTES_PER_SECOND=10

EXPOSE 3000

CMD ["node", "src/index.js"]