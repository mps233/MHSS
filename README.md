# Self-service subscription fro Mediahelp

一个基于Mediahelp的自助求片网站，用户可以搜索影片并自动发送请求到MH机器人或者绑定了MH机器人的Telegram 群组。

## 项目截图

### PC端
<img src="image/1.png" width="70%" />
<img src="image/2.png" width="70%" />

### 移动端
<img src="image/3.png" width="30%" /> <img src="image/4.png" width="30%" />



## 功能特点

- 🔍 集成 TMDB API，实时搜索影视剧
- 🤖 使用 Telegram 用户账号自动发送请求并点击确认
- 📊 显示热门电影和电视剧
- 📱 完全响应式设计，支持移动端
- 💾 记录已请求的影片，避免重复请求
- 📈 支持 Emby 库统计和入库趋势展示

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，并填写以下信息：

```env
# TMDB API Key（必需）
TMDB_API_KEY=你的TMDB_API_KEY

# Telegram 配置（必需）
TG_API_ID=你的API_ID
TG_API_HASH=你的API_HASH
TG_PHONE_NUMBER=你的手机号（如+8613800138000）
TG_GROUP_ID=目标群组ID或用户名（如@groupname）
TG_SESSION=你的session_string（首次启动后获取）

# Emby 配置（可选）
EMBY_URL=你的Emby服务器地址
EMBY_API_KEY=你的Emby_API_KEY

# 服务器端口（可选）
PORT=3000
```

### 3. 首次启动

```bash
npm start
```

首次启动时：
- 会要求输入 Telegram 验证码
- 如果有两步验证，还需要输入密码
- 登录成功后会显示 Session String
- 将 Session String 复制到 `.env` 文件的 `TG_SESSION` 变量中

### 4. 后续启动

配置好 `TG_SESSION` 后，直接运行：

```bash
npm start
```

访问 http://localhost:3000

## Docker 部署

### 配置 GitHub Actions 自动构建（首次设置）

1. **在 Docker Hub 创建仓库**
   - 访问 https://hub.docker.com/
   - 创建一个名为 `mhss` 的仓库

2. **在 GitHub 仓库设置 Secrets**
   - 进入你的 GitHub 仓库
   - Settings → Secrets and variables → Actions
   - 添加以下 secrets：
     - `DOCKER_USERNAME`: 你的 Docker Hub 用户名
     - `DOCKER_PASSWORD`: 你的 Docker Hub 密码或 Access Token

3. **推送代码触发构建**
   - 每次推送到 main 分支会自动构建并推送镜像
   - 也可以在 Actions 标签手动触发

### 使用预构建的 Docker 镜像

如果已经配置了自动构建，可以直接使用：

```bash
# 拉取镜像
docker pull miaona/mhss:latest

# 运行容器
docker run -d \
  --name mhss \
  -p 3000:3000 \
  --env-file .env \
  -v $(pwd)/requested-movies.json:/app/requested-movies.json \
  miaona/mhss:latest
```

### 使用 Docker Compose（推荐）

1. **确保已安装 Docker 和 Docker Compose**

2. **配置环境变量**
   - 复制 `.env.example` 为 `.env`
   - 填写所有必需的环境变量

3. **构建并启动容器**
   ```bash
   docker-compose up -d
   ```

4. **查看日志**
   ```bash
   docker-compose logs -f
   ```

5. **停止容器**
   ```bash
   docker-compose down
   ```

### 使用 Docker 命令

1. **构建镜像**
   ```bash
   docker build -t mhss-app .
   ```

2. **运行容器**
   ```bash
   docker run -d \
     --name mhss \
     -p 3000:3000 \
     --env-file .env \
     -v $(pwd)/requested-movies.json:/app/requested-movies.json \
     mhss-app
   ```

3. **查看日志**
   ```bash
   docker logs -f mhss
   ```

4. **停止容器**
   ```bash
   docker stop mhss
   docker rm mhss
   ```

## 技术栈

- 后端：Node.js, Express
- 前端：原生 HTML/CSS/JavaScript
- API：TMDB API, Telegram Client API (MTProto), Emby API
- 容器化：Docker

### TMDB API Key
1. 访问 https://www.themoviedb.org/
2. 注册账号并登录
3. 进入 Settings -> API
4. 申请 API Key

### Telegram API ID 和 Hash
1. 访问 https://my.telegram.org/apps
2. 使用你的 Telegram 账号登录
3. 创建一个新应用
4. 获取 `api_id` 和 `api_hash`

### Telegram 群组 ID
- 如果群组有公开用户名，直接使用 `@groupname`
- 如果是私有群组，使用数字 ID（负数，如 `-1001234567890`）

### Emby 配置（可选）
如果你有 Emby 服务器，可以配置以显示库统计信息：
- `EMBY_URL`: Emby 服务器地址（如 http://localhost:8096）
- `EMBY_API_KEY`: 在 Emby 设置中生成的 API 密钥

