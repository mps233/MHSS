# 第一阶段：使用标准镜像编译依赖
FROM node:18 AS builder

WORKDIR /app

# 复制 package.json
COPY package.json ./

# 显示 yarn 版本和 package.json 内容
RUN echo "=== Yarn 版本 ===" && yarn --version && \
    echo "=== package.json 内容 ===" && cat package.json && \
    echo "=== 开始安装依赖（不使用 --production）===" && \
    yarn install && \
    echo "=== 安装完成，检查 node_modules ===" && \
    ls -la node_modules/ | head -20 && \
    echo "=== 检查 node-schedule ===" && \
    ls -la node_modules/node-schedule || echo "⚠️  node-schedule 未安装"

# 第二阶段：使用 Alpine 镜像运行
FROM node:18-alpine

WORKDIR /app

# 从构建阶段复制 node_modules
COPY --from=builder /app/node_modules ./node_modules

# 复制 package.json
COPY package.json ./

# 复制项目文件
COPY . .

# 验证 node-schedule 是否存在
RUN echo "=== 验证 node-schedule ===" && \
    ls -la node_modules/node-schedule || echo "⚠️  node-schedule 未找到"

# 创建 data 目录并设置权限
RUN mkdir -p /app/data && chmod 777 /app/data

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/emby/stats', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server.js"]
