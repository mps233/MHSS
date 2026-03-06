# 使用 Node.js 18 官方镜像（Alpine 版本，更小更快）
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 安装 yarn
RUN corepack enable && corepack prepare yarn@stable --activate

# 复制 package.json
COPY package.json ./

# 使用 yarn 安装依赖
RUN yarn install --production --frozen-lockfile

# 复制项目文件
COPY . .

# 创建 data 目录并设置权限
RUN mkdir -p /app/data && chmod 777 /app/data

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/emby/stats', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server.js"]
