# 第一阶段：使用标准镜像编译依赖
FROM node:18 AS builder

WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装所有依赖（包括需要编译的）
RUN npm install --production

# 第二阶段：使用 Alpine 镜像运行
FROM node:18-alpine

WORKDIR /app

# 从构建阶段复制 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 复制 package.json
COPY package*.json ./

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
