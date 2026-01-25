# 使用 Ubuntu 24.04 基础镜像（支持 Python 3.12）
FROM ubuntu:24.04

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=18

# 设置工作目录
WORKDIR /app

# 安装 Node.js 18, Python 3.12 和必要的系统依赖
RUN apt-get update && apt-get install -y \
    # Node.js 依赖
    curl \
    ca-certificates \
    gnupg \
    # Python 3.12（Ubuntu 24.04 自带）
    python3.12 \
    python3-pip \
    # Playwright Chromium 依赖
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 18
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# 验证版本
RUN node --version && npm --version && python3.12 --version

# 安装 Python 依赖
RUN pip3 install --break-system-packages --no-cache-dir pyjwt requests playwright

# 安装 Playwright Chromium Headless Shell（轻量版，约 158MB）
# 用于 HDHive 自动登录获取 Cookie
RUN python3.12 -m playwright install chromium-headless-shell

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装 Node.js 依赖
RUN npm install --production

# 复制项目文件
COPY . .

# 确保 hdhive_module 目录存在
RUN mkdir -p hdhive_module

# 删除 macOS 版本的 hdhive 模块（如果存在）
RUN rm -f hdhive_module/*.dylib hdhive_module/*-darwin.so

# 下载 Linux x86_64 版本的 hdhive 模块
RUN curl -L "https://raw.githubusercontent.com/mrtian2016/hdhive_resource/main/hdhive.cpython-312-x86_64-linux-gnu.so" \
    -o hdhive_module/hdhive.cpython-312-x86_64-linux-gnu.so \
    && chmod +x hdhive_module/*.so

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/emby/stats', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server.js"]
