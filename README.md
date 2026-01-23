# 自助求片网站

一个基于 React + Chakra UI 的自助求片网站，用户可以搜索影片并自动发送请求到 Telegram。

## 功能特点

- 🎨 使用 Chakra UI 组件库，界面精美
- 🔍 集成 TMDB API，实时搜索影视剧
- 🤖 使用 Telegram 用户账号自动发送请求并点击确认
- 📱 完全响应式设计，支持移动端
- ⚡ React 单页应用，流畅体验

## 安装步骤

1. 安装后端依赖：
```bash
npm install
```

2. 安装前端依赖：
```bash
cd client
npm install
cd ..
```

3. 配置环境变量：
   - 复制 `.env.example` 为 `.env`
   - 填写以下信息：
     - `TMDB_API_KEY`: 从 https://www.themoviedb.org/settings/api 获取
     - `TG_API_ID` 和 `TG_API_HASH`: 从 https://my.telegram.org/apps 获取
     - `TG_PHONE_NUMBER`: 你的 Telegram 手机号（带国际区号，如 +8613800138000）
     - `TG_GROUP_ID`: 目标群组的用户名（如 @groupname）或 ID

4. 首次启动后端服务器：
```bash
npm start
```
   - 首次启动会要求输入 Telegram 验证码
   - 如果有两步验证，还需要输入密码
   - 登录成功后会显示 Session String，复制它

5. 将 Session String 添加到 `.env` 文件：
```
TG_SESSION=你的session_string
```

6. 启动前端开发服务器（新终端窗口）：
```bash
cd client
npm start
```

7. 访问 http://localhost:3001

## 生产环境部署

1. 构建前端：
```bash
cd client
npm run build
cd ..
```

2. 设置环境变量：
```bash
export NODE_ENV=production
```

3. 启动服务器：
```bash
npm start
```

4. 访问 http://localhost:3000

## 获取配置信息

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

## 技术栈

- 前端：React, Chakra UI, Framer Motion
- 后端：Node.js, Express
- API：TMDB API, Telegram Client API (MTProto)
