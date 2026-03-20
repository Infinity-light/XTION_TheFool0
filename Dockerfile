FROM node:20-alpine AS builder

WORKDIR /app

# 换用阿里云 alpine 镜像源
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

# 复制所有 package.json
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

RUN apk add --no-cache python3 make g++
RUN npm install

COPY . .
RUN npm run build:server && npm run build:client

FROM node:20-alpine AS production

WORKDIR /app

# 换用阿里云 alpine 镜像源
RUN sed -i 's/dl-cdn.alpinelinux.org/mirrors.aliyun.com/g' /etc/apk/repositories

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/server/package*.json ./server/
RUN apk add --no-cache python3 make g++
RUN npm install --workspace=server --omit=dev && npm cache clean --force

COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

EXPOSE 3000

CMD ["node", "server/dist/index.js"]
