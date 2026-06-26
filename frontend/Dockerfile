FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine
RUN npm install -g serve

WORKDIR /app
COPY --from=builder /app/dist ./dist

CMD ["serve", "-s", "dist", "-l", "3000"]
