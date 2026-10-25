# ---- 运行阶段 ----
FROM node:20-alpine

WORKDIR /app

# 单独拷贝依赖清单，充分利用镜像缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY server.js ./
COPY shared/ ./shared/
COPY public/ ./public/

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# 容器直接跑 node，方便 Docker/K8s 发送 SIGTERM 时优雅退出
CMD ["node", "server.js"]
