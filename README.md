# MHSS - MediaHelper 自助订阅系统

一个基于 MediaHelper 的自助求片网站，用户可以搜索影片并自动在 MediaHelper 上创建订阅。

## 项目截图

### PC端
<img src="image/1.png" width="70%" />
<img src="image/2.png" width="70%" />

### 移动端
<img src="image/3.png" width="30%" /> <img src="image/4.png" width="30%" />

## 功能特点

- 🔍 集成 TMDB API，实时搜索影视剧
- 🤖 自动在 MediaHelper 上创建订阅
- 🎁 **自动获取影巢（HDHive）免费 115 链接**（可选）
- 🔐 Emby 账号登录认证
- 👥 **用户请求限制管理**（每个用户最多 3 次搜索，管理员不受限制）
- 📊 显示热门电影和电视剧，支持动态分页
- 📋 未完成订阅管理，实时显示订阅进度
- 📱 完全响应式设计，支持移动端
- 💾 记录已请求的影片，避免重复请求
- 📈 支持 Emby 库统计展示和入库趋势图表
- 🎨 深色/浅色主题切换
- ⏰ 定时任务管理，支持自动批量查找影巢资源
- 📝 实时日志查看，监控任务执行状态
- 🔄 智能缓存机制，提升加载速度

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env`，并填写以下信息：

```env
# TMDB API Key（必需）- 从 https://www.themoviedb.org/settings/api 获取
TMDB_API_KEY=你的TMDB_API_KEY

# Emby 配置（必需）- 用于登录认证
EMBY_URL=你的Emby服务器地址
EMBY_API_KEY=你的Emby_API_KEY

# MediaHelper 配置（必需）- 用于创建订阅
MEDIAHELPER_URL=你的MediaHelper地址
MEDIAHELPER_USERNAME=你的MediaHelper用户名
MEDIAHELPER_PASSWORD=你的MediaHelper密码

# 服务器端口（可选）
PORT=3000

# HTTP 代理配置（可选）- 用于访问 TMDB API
# 如果在中国大陆访问 TMDB 较慢，可以配置代理
# HTTP_PROXY=http://127.0.0.1:7890
# HTTPS_PROXY=http://127.0.0.1:7890

# HDHive 配置（可选）- 自动获取免费 115 链接
# 详细配置说明请查看 HDHIVE_SETUP.md
# HDHIVE_ENABLED=false
# HDHIVE_COOKIE=
```

### 3. 启动服务

```bash
npm start
```

访问 http://localhost:3000

### 4. 开发模式

支持热重载：

```bash
npm run dev
```

访问 http://localhost:3001

## Docker 部署

### 使用 docker-compose（推荐）

1. 创建 `docker-compose.yml` 文件：

```yaml
services:
  mhss:
    image: miaona/mhss:latest
    container_name: mhss-app
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # 持久化数据目录（重要！）
      - ./data:/app/data
    environment:
      # 必需配置
      - NODE_ENV=production
      - TMDB_API_KEY=你的TMDB_API_KEY
      - EMBY_URL=你的Emby服务器地址
      - EMBY_API_KEY=你的Emby_API_KEY
      - MEDIAHELPER_URL=你的MediaHelper服务器地址
      - MEDIAHELPER_USERNAME=你的MediaHelper用户名
      - MEDIAHELPER_PASSWORD=你的MediaHelper密码
      - PORT=3000
      
      # 可选：影巢配置（自动获取免费 115 链接）
      - HDHIVE_ENABLED=true
      - HDHIVE_USERNAME=你的影巢账号
      - HDHIVE_PASSWORD=你的影巢密码
      
      # 可选：代理配置（访问 TMDB）
      # - HTTP_PROXY=http://192.168.1.100:7890
      # - HTTPS_PROXY=http://192.168.1.100:7890
```

2. 修改环境变量为你的实际配置

3. 启动容器：
```bash
docker-compose up -d
```

4. 访问 http://localhost:3000

### 使用 docker run

```bash
docker run -d \
  --name mhss \
  -p 3000:3000 \
  -v ./data:/app/data \
  -e TMDB_API_KEY=你的TMDB_API_KEY \
  -e EMBY_URL=你的Emby服务器地址 \
  -e EMBY_API_KEY=你的Emby_API_KEY \
  -e MEDIAHELPER_URL=你的MediaHelper地址 \
  -e MEDIAHELPER_USERNAME=你的MediaHelper用户名 \
  -e MEDIAHELPER_PASSWORD=你的MediaHelper密码 \
  -e HDHIVE_ENABLED=true \
  -e HDHIVE_USERNAME=你的影巢账号 \
  -e HDHIVE_PASSWORD=你的影巢密码 \
  miaona/mhss:latest
```

### Docker 镜像说明

Docker 镜像已包含：
- ✅ Node.js 18 运行环境
- ✅ Python 3.12 + HDHive 模块（x86_64）
- ✅ Playwright + Chromium Headless Shell（~158MB）
- ✅ 所有必需的依赖包
- ✅ 自动健康检查

**基础镜像**：Ubuntu 24.04 LTS（支持 Python 3.12）

**镜像大小**：约 500-550MB（包含完整的影巢自动登录功能）

**架构支持**：x86_64 (amd64)

**重要提示**：
- 首次运行会使用 Playwright 自动登录获取 Cookie（约 5-10 秒）
- **必须挂载 data 目录以持久化数据**，否则重启容器后会丢失所有状态
- 所有状态数据统一保存在 `data/app_state.json` 文件中
- 旧版本的多个 JSON 文件会自动迁移到新的单文件格式
- Cookie 有效期约 7 天，过期后自动刷新

## 配置说明

### TMDB API Key
1. 访问 https://www.themoviedb.org/settings/api
2. 注册账号并申请 API Key
3. 将 API Key 填入 `TMDB_API_KEY`

### Emby 配置
1. `EMBY_URL`: Emby 服务器地址，例如 `http://192.168.1.100:8096`
2. `EMBY_API_KEY`: 在 Emby 设置 -> API 密钥中生成

### MediaHelper 配置
1. `MEDIAHELPER_URL`: MediaHelper 服务器地址
2. `MEDIAHELPER_USERNAME`: MediaHelper 登录用户名
3. `MEDIAHELPER_PASSWORD`: MediaHelper 登录密码

**注意**：系统会自动使用 MediaHelper 的默认配置（云盘类型、目录、定时任务等），无需额外配置。

### 影巢配置（可选）

如果想要自动获取影巢（HDHive）免费 115 链接，推荐使用账号密码配置：

#### 推荐方式：使用账号密码（智能自动处理）

```env
HDHIVE_ENABLED=true
HDHIVE_USERNAME=你的影巢账号
HDHIVE_PASSWORD=你的影巢密码
```

**工作原理**（自动优化，无需手动干预）：
1. **首次运行**：使用 Playwright 自动登录获取 Cookie 并保存（需要浏览器，仅一次）
2. **后续查询**：直接使用保存的 Cookie（快速，无需浏览器）
3. **Cookie 过期**：自动重新登录获取新 Cookie（约 7 天一次）

**优点**：
- ✅ 一次配置永久有效
- ✅ Cookie 自动管理，过期自动刷新
- ✅ 大部分时间不需要浏览器（只在首次和过期时需要）
- ✅ 无需手动维护

**环境要求**：
- Python 3.12+（已包含在 Docker 镜像中）
- hdhive 模块（已包含在 Docker 镜像中）
- Playwright + 浏览器（首次运行时需要）：
  ```bash
  pip install playwright
  
  # 推荐：轻量版浏览器（~180MB，专为无头模式优化）
  playwright install chromium-headless-shell
  
  # 或标准版（~280MB）
  playwright install chromium
  
  # 或更轻量的 WebKit（~180MB，可能有兼容性问题）
  playwright install webkit
  ```
  
**Docker 用户注意**：
- Docker 镜像已包含 Playwright 和轻量版 Chromium（~180MB）
- 首次运行会自动获取 Cookie 并保存到容器内
- **必须挂载 data 目录以持久化数据**：
  ```yaml
  volumes:
    - ./data:/app/data
  ```
- 所有状态数据统一保存在 `data/app_state.json` 文件中
- 如果想进一步减小镜像大小，可以手动提供 Cookie（见下方"备选方式"）

#### 备选配置：手动 Cookie（仅适用于无法安装浏览器的环境）

```env
HDHIVE_ENABLED=true
HDHIVE_COOKIE=token=xxx; csrf_access_token=xxx
```

**获取 Cookie 方法**：
1. 在浏览器登录 https://hdhive.com
2. 按 F12 打开开发者工具 → Network 标签
3. 刷新页面，找到任意请求
4. 复制 Request Headers 中的 Cookie 值
5. 格式：`token=xxx; csrf_access_token=xxx`

**优点**：
- ✅ 不需要 Playwright 和浏览器
- ✅ 配置简单

**缺点**：
- ❌ Cookie 会过期（约 7 天）
- ❌ 过期后需要手动重新获取
- ❌ 无法自动刷新

**不推荐原因**：需要每周手动更新，不如账号密码方便。

---

#### 配置后的功能

- **批量定时查找**：每 7 天自动为所有未完成订阅查找影巢资源
- **手动触发查找**：在任务面板中随时手动执行批量查找
- **实时日志查看**：查看每个订阅的查找结果和找到的资源数量
- **自动添加链接**：将找到的分享链接自动添加到 MediaHelper 订阅中

这大大提高了资源获取成功率，特别是对于冷门或新上映的影片。

## 使用说明

### 基本功能

1. **登录**: 使用 Emby 账号登录系统
2. **搜索订阅**: 在搜索框中输入影片名称，点击 ➕ 按钮订阅
3. **查看热门**: 浏览热门电影和电视剧，支持分页查看
4. **未完成订阅**: 查看所有未完成的订阅，实时显示进度
5. **最近请求**: 查看最近的订阅请求记录

### 高级功能

#### 影巢批量查找

系统支持定时批量查找影巢（HDHive）免费资源：

1. 点击导航栏的"任务"按钮
2. 开启"影巢批量查找"开关
3. 系统会每 7 天自动查找一次
4. 也可以点击"立即执行"手动触发查找

#### 查看日志

点击导航栏的"日志"按钮，可以实时查看：
- 影巢查找任务的执行状态
- 每个订阅的查找结果
- 找到的免费资源数量

#### 主题切换

点击导航栏右侧的主题按钮，可以切换：
- 🌙 深色模式
- ☀️ 浅色模式
- 🔄 跟随系统

### 服务状态监控

点击导航栏的"状态"下拉菜单，可以查看：
- Emby 服务状态和响应延迟
- MediaHelper 服务状态和响应延迟
- TMDB 服务状态和响应延迟

## 技术栈

- **后端**: Node.js + Express
- **前端**: 原生 JavaScript + CSS
- **图表**: Chart.js
- **API**: TMDB API, Emby API, MediaHelper API, HDHive API
- **Python**: Python 3.12 + HDHive 模块（用于影巢资源查询）
- **部署**: Docker

## 性能优化

- 智能缓存机制，减少 API 调用
- 批量查询优化，提升加载速度
- 响应式图片加载，节省带宽
- Service Worker 支持，离线可用
- 防抖和节流优化，提升用户体验

## 开源协议

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 致谢

- [TMDB](https://www.themoviedb.org/) - 提供影片数据
- [Emby](https://emby.media/) - 媒体服务器
- [MediaHelper](https://github.com/tymdun/MediaHelp) - 自动化订阅工具
- [HDHive](https://hdhive.com/) - 影巢资源站
- [Chart.js](https://www.chartjs.org/) - 图表库

## 常见问题

### 1. 为什么搜索不到影片？
- 检查 TMDB_API_KEY 是否正确配置
- 如果在中国大陆，可能需要配置 HTTP_PROXY

### 2. 订阅失败怎么办？
- 检查 MediaHelper 服务是否正常运行
- 确认 MediaHelper 的用户名和密码是否正确
- 查看浏览器控制台的错误信息

### 3. 影巢查找不工作？
- 确认已按照 [HDHIVE_SETUP.md](HDHIVE_SETUP.md) 正确配置
- 检查 Python 3.12 是否已安装
- 查看日志面板中的错误信息

### 4. 如何更新到最新版本？
```bash
# Docker 部署
docker-compose pull
docker-compose up -d

# 源码部署
git pull
npm install
npm start
```
