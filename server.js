require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置代理（如果设置了 HTTP_PROXY 或 HTTPS_PROXY 环境变量）
const proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY;
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;

if (proxyAgent) {
  console.log(`✅ 使用代理: ${proxyUrl}`);
} else {
  console.log('ℹ️  未配置代理，直接连接');
}

// HDHive 配置
const HDHIVE_ENABLED = process.env.HDHIVE_ENABLED === 'true';
const HDHIVE_COOKIE = process.env.HDHIVE_COOKIE || '';
const HDHIVE_USERNAME = process.env.HDHIVE_USERNAME || '';
const HDHIVE_PASSWORD = process.env.HDHIVE_PASSWORD || '';

if (HDHIVE_ENABLED) {
  if (HDHIVE_COOKIE) {
    console.log('✅ HDHive 功能已启用（使用 Cookie）');
  } else if (HDHIVE_USERNAME && HDHIVE_PASSWORD) {
    console.log('✅ HDHive 功能已启用（使用账号密码，支持自动刷新）');
  } else {
    console.log('⚠️  HDHive 已启用但未配置 Cookie 或账号密码');
    console.log('   请在 .env 文件中配置 HDHIVE_COOKIE 或 HDHIVE_USERNAME/HDHIVE_PASSWORD');
  }
}

// 创建带代理的 fetch 函数
function fetchWithProxy(url, options = {}) {
  if (proxyAgent && url.startsWith('https://api.tmdb.org')) {
    return fetch(url, { ...options, agent: proxyAgent });
  }
  return fetch(url, options);
}

// 查询 HDHive 免费 115 链接（使用 Python 桥接）
async function getHDHiveFreeLinks(tmdbId, mediaType) {
  if (!HDHIVE_ENABLED) {
    return [];
  }
  
  // 检查是否配置了 Cookie 或账号密码
  if (!HDHIVE_COOKIE && (!HDHIVE_USERNAME || !HDHIVE_PASSWORD)) {
    return [];
  }
  
  try {
    console.log(`\n🔍 HDHive: 开始查询 tmdb_id=${tmdbId} type=${mediaType}`);
    
    const { exec } = require('child_process');
    const util = require('util');
    const execPromise = util.promisify(exec);
    
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    
    // 构建命令：传递 Cookie、用户名和密码
    const cmd = `python3.12 hdhive_bridge.py ${tmdbId} ${type} "${HDHIVE_COOKIE}" "${HDHIVE_USERNAME}" "${HDHIVE_PASSWORD}"`;
    
    // 设置 2 分钟超时，给 HDHive API 足够的响应时间
    const { stdout, stderr } = await execPromise(cmd, { 
      timeout: 120000,  // 2分钟超时
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });
    
    // 输出 Python 的 stderr（日志信息）到服务器日志
    if (stderr) {
      const lines = stderr.trim().split('\n');
      lines.forEach(line => {
        if (line && !line.includes('DeprecationWarning')) {
          console.log(`   ${line}`);
        }
      });
    }
    
    // 只解析 stdout 的最后一行（JSON 结果）
    const lines = stdout.trim().split('\n');
    const jsonLine = lines[lines.length - 1];
    const result = JSON.parse(jsonLine);
    
    if (result.success) {
      const links = result.links || [];
      console.log(`🎉 HDHive: 查询完成，找到 ${links.length} 个免费链接\n`);
      return links;
    } else {
      console.error(`❌ HDHive: 查询失败: ${result.error}\n`);
      return [];
    }
    
  } catch (error) {
    // 超时错误
    if (error.killed || error.signal === 'SIGTERM') {
      console.error(`⏱️  HDHive: 查询超时（20秒），跳过\n`);
      return [];
    }
    
    console.error(`❌ HDHive: 查询失败: ${error.message}\n`);
    
    // 尝试从 stderr 中提取 JSON（Python 脚本的 stdout 可能被重定向到 stderr）
    let outputToTry = error.stdout || error.stderr || '';
    
    if (outputToTry) {
      try {
        // 查找 JSON 行（以 { 开头的行）
        const lines = outputToTry.trim().split('\n');
        let jsonLine = null;
        
        // 从后往前找第一个 JSON 行
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (line.startsWith('{') && line.endsWith('}')) {
            jsonLine = line;
            break;
          }
        }
        
        if (jsonLine) {
          console.log(`   找到 JSON: ${jsonLine.substring(0, 100)}...`);
          const result = JSON.parse(jsonLine);
          
          if (result.success && result.links && result.links.length > 0) {
            console.log(`✅ HDHive: 成功找到 ${result.links.length} 个链接\n`);
            return result.links;
          } else {
            console.log(`   JSON 解析成功但没有链接: success=${result.success}, count=${result.count}`);
          }
        } else {
          console.log(`   未找到 JSON 行`);
        }
      } catch (parseError) {
        console.error(`   无法解析输出: ${parseError.message}`);
      }
    }
    
    return [];
  }
}

app.use(express.json());
app.use(cookieParser());

// Session管理
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

// 从文件加载sessions
function loadSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = fs.readFileSync(SESSIONS_FILE, 'utf8');
      const sessionsArray = JSON.parse(data);
      return new Map(sessionsArray);
    }
  } catch (error) {
    console.error('加载sessions失败:', error);
  }
  return new Map();
}

// 保存sessions到文件
function saveSessions() {
  try {
    const sessionsArray = Array.from(sessions.entries());
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessionsArray, null, 2));
  } catch (error) {
    console.error('保存sessions失败:', error);
  }
}

const sessions = loadSessions(); // 存储用户session

// MediaHelper Token 管理
let mediaHelperToken = null;
let mediaHelperTokenExpiry = 0;
let mediaHelperDefaults = null; // 缓存默认配置

// 订阅列表缓存
let subscriptionsCache = null;
let subscriptionsCacheExpiry = 0;
const SUBSCRIPTIONS_CACHE_TTL = 2 * 60 * 1000; // 2分钟缓存

// Emby 库缓存
let embyLibraryCache = new Map(); // tmdbId -> boolean
let embyLibraryCacheExpiry = 0;
const EMBY_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

// 入库趋势缓存
let trendsCacheData = null;
let trendsCacheExpiry = 0;
const TRENDS_CACHE_TTL = 5 * 60 * 1000; // 5分钟缓存

// 获取 MediaHelper 默认配置
async function getMediaHelperDefaults() {
  // 如果已经缓存了，直接返回
  if (mediaHelperDefaults) {
    return mediaHelperDefaults;
  }

  const token = await getMediaHelperToken();
  
  try {
    // 获取订阅默认配置（包含默认账号 ID）
    const configResponse = await fetch(`${process.env.MEDIAHELPER_URL}/api/v1/subscription/config/cloud-defaults`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!configResponse.ok) {
      throw new Error('获取默认配置失败');
    }

    const configData = await configResponse.json();
    const config = configData.data || configData;
    
    // 如果有默认账号 ID，获取该账号的云盘类型
    if (config.default_account_id) {
      const accountsResponse = await fetch(`${process.env.MEDIAHELPER_URL}/api/v1/cloud-accounts`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (accountsResponse.ok) {
        const accountsData = await accountsResponse.json();
        const accounts = accountsData.data?.accounts || [];
        
        // 查找默认账号
        const defaultAccount = accounts.find(acc => acc.external_id === config.default_account_id);
        
        if (defaultAccount) {
          config.default_cloud_type = defaultAccount.cloud_type;
        }
      }
    }
    
    // 缓存默认配置
    mediaHelperDefaults = config;
    return mediaHelperDefaults;
  } catch (error) {
    console.error('获取 MediaHelper 默认配置失败:', error);
    // 返回空对象，让后续代码使用环境变量
    return {};
  }
}

// 登录 MediaHelper 获取 Token
async function getMediaHelperToken() {
  // 如果 token 还有效，直接返回
  if (mediaHelperToken && Date.now() < mediaHelperTokenExpiry) {
    return mediaHelperToken;
  }

  if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME || !process.env.MEDIAHELPER_PASSWORD) {
    throw new Error('MediaHelper 未配置');
  }

  try {
    console.log(`正在登录 MediaHelper: ${process.env.MEDIAHELPER_URL}`);
    const response = await fetch(`${process.env.MEDIAHELPER_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username: process.env.MEDIAHELPER_USERNAME,
        password: process.env.MEDIAHELPER_PASSWORD
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('MediaHelper 登录失败响应:', {
        status: response.status,
        statusText: response.statusText,
        body: errorText
      });
      
      // 如果是 404，提示可能的 API 路径问题
      if (response.status === 404) {
        throw new Error(`MediaHelper API 路径错误 (404)。请检查：
1. MediaHelper 版本是否支持 /api/v1/auth/login 路径
2. 尝试访问 ${process.env.MEDIAHELPER_URL}/api/v1/auth/login 确认路径是否正确
3. 查看 MediaHelper 文档确认正确的 API 路径
响应内容: ${errorText}`);
      }
      
      throw new Error(`MediaHelper 登录失败: ${errorText}`);
    }

    const data = await response.json();
    // console.log('MediaHelper 登录响应:', JSON.stringify(data, null, 2));
    
    // 尝试不同的 token 字段名
    mediaHelperToken = data.data?.token || data.token || data.access_token || data.data?.access_token;
    
    if (!mediaHelperToken) {
      throw new Error('无法从响应中获取 token: ' + JSON.stringify(data));
    }
    
    // Token 有效期设为 23 小时（假设 24 小时有效期）
    mediaHelperTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    
    console.log('✅ MediaHelper 登录成功，Token:', mediaHelperToken.substring(0, 20) + '...');
    return mediaHelperToken;
  } catch (error) {
    console.error('MediaHelper 登录错误:', error);
    throw error;
  }
}

// 获取 MediaHelper 订阅列表（带缓存）
async function getMediaHelperSubscriptions(forceRefresh = false) {
  // 如果有缓存且未过期，直接返回
  if (!forceRefresh && subscriptionsCache && Date.now() < subscriptionsCacheExpiry) {
    return subscriptionsCache;
  }

  try {
    const token = await getMediaHelperToken();
    
    // 获取所有订阅（分页获取）
    let allSubscriptions = [];
    let page = 1;
    const pageSize = 100;
    
    while (true) {
      const response = await fetch(`${process.env.MEDIAHELPER_URL}/api/v1/subscription/list?page=${page}&page_size=${pageSize}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('获取订阅列表失败');
      }

      const data = await response.json();
      const subscriptions = data.data?.subscriptions || [];
      
      if (subscriptions.length === 0) {
        break;
      }
      
      allSubscriptions = allSubscriptions.concat(subscriptions);
      
      // 如果返回的数量少于 pageSize，说明已经是最后一页
      if (subscriptions.length < pageSize) {
        break;
      }
      
      page++;
    }
    
    const result = { subscriptions: allSubscriptions };
    
    // 更新缓存
    subscriptionsCache = result;
    subscriptionsCacheExpiry = Date.now() + SUBSCRIPTIONS_CACHE_TTL;
    
    return result;
  } catch (error) {
    console.error('获取 MediaHelper 订阅列表失败:', error);
    // 如果有旧缓存，返回旧缓存
    if (subscriptionsCache) {
      return subscriptionsCache;
    }
    return { subscriptions: [] };
  }
}

// 批量检查 Emby 库中的影片（带缓存）
async function checkEmbyLibraryBatch(tmdbIds, mediaType) {
  if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY || !tmdbIds || tmdbIds.length === 0) {
    return new Map();
  }

  const results = new Map();
  const uncachedIds = [];
  
  // 检查缓存
  const now = Date.now();
  if (now < embyLibraryCacheExpiry) {
    tmdbIds.forEach(id => {
      const cacheKey = `${mediaType}_${id}`;
      if (embyLibraryCache.has(cacheKey)) {
        results.set(id, embyLibraryCache.get(cacheKey));
      } else {
        uncachedIds.push(id);
      }
    });
  } else {
    // 缓存过期，清空
    embyLibraryCache.clear();
    uncachedIds.push(...tmdbIds);
    embyLibraryCacheExpiry = now + EMBY_CACHE_TTL;
  }

  // 如果所有 ID 都有缓存，直接返回
  if (uncachedIds.length === 0) {
    return results;
  }

  try {
    const itemType = mediaType === 'movie' ? 'Movie' : 'Series';
    
    // 一次性获取所有该类型的影片
    const response = await fetch(
      `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=${itemType}&Recursive=true&Fields=ProviderIds&Limit=10000`
    );
    
    if (!response.ok) {
      throw new Error('Emby API 请求失败');
    }
    
    const data = await response.json();
    const items = data.Items || [];
    
    // 构建 TMDB ID 映射
    const embyTmdbIds = new Set();
    items.forEach(item => {
      if (item.ProviderIds && item.ProviderIds.Tmdb) {
        embyTmdbIds.add(parseInt(item.ProviderIds.Tmdb));
      }
    });
    
    // 检查每个 ID 是否在库中
    uncachedIds.forEach(id => {
      const inLibrary = embyTmdbIds.has(id);
      results.set(id, inLibrary);
      
      // 更新缓存
      const cacheKey = `${mediaType}_${id}`;
      embyLibraryCache.set(cacheKey, inLibrary);
    });
    
  } catch (error) {
    console.error('批量检查 Emby 库失败:', error);
    // 失败时，未缓存的 ID 都标记为 false
    uncachedIds.forEach(id => {
      results.set(id, false);
    });
  }

  return results;
}
async function createMediaHelperSubscription(movieData, hdhiveLinks = []) {
  const token = await getMediaHelperToken();
  const defaults = await getMediaHelperDefaults();
  
  // 从 movieData 中提取数据，兼容不同的字段名
  const title = movieData.title || movieData.name || '';
  const originalTitle = movieData.original_title || movieData.original_name || title;
  
  // 使用默认配置或环境变量
  const subscriptionData = {
    tmdb_id: movieData.id,
    title: title,
    original_title: originalTitle,
    media_type: movieData.media_type || movieData.mediaType,
    release_date: movieData.release_date || movieData.first_air_date || '',
    overview: movieData.overview || '',
    poster_path: movieData.poster_path ? `https://image.tmdb.org/t/p/w500${movieData.poster_path}` : '',
    backdrop_path: movieData.backdrop_path ? `https://image.tmdb.org/t/p/w1280${movieData.backdrop_path}` : '',
    vote_average: movieData.vote_average || 0,
    popularity: movieData.popularity || 0,
    search_keywords: title,
    quality_preference: 'auto',
    custom_name: title,
    selected_seasons: [],
    user_custom_links: hdhiveLinks  // HDHive 免费 115 链接
  };

  // 使用 MediaHelper 的默认配置
  // 云盘类型：优先使用 MediaHelper 默认账号的类型，其次使用环境变量，最后默认 drive115
  if (defaults.default_cloud_type) {
    subscriptionData.cloud_type = defaults.default_cloud_type;
  } else if (process.env.MEDIAHELPER_CLOUD_TYPE) {
    subscriptionData.cloud_type = process.env.MEDIAHELPER_CLOUD_TYPE;
  } else {
    subscriptionData.cloud_type = 'drive115';
  }

  if (defaults.default_account_id) {
    subscriptionData.account_identifier = defaults.default_account_id;
  }
  
  if (defaults.account_configs && defaults.default_account_id) {
    const accountConfig = defaults.account_configs[defaults.default_account_id];
    if (accountConfig && accountConfig.default_directory) {
      subscriptionData.target_directory = accountConfig.default_directory;
    }
  }

  console.log('创建订阅请求:', {
    url: `${process.env.MEDIAHELPER_URL}/api/v1/subscription/create`,
    token: token.substring(0, 20) + '...',
    data: subscriptionData,
    hdhiveLinksCount: hdhiveLinks.length
  });

  const response = await fetch(`${process.env.MEDIAHELPER_URL}/api/v1/subscription/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    },
    body: JSON.stringify(subscriptionData)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('创建订阅失败响应:', errorText);
    throw new Error(`创建订阅失败: ${errorText}`);
  }

  const result = await response.json();
  console.log('创建订阅成功:', result);
  return result;
}

// Session 保存防抖
let saveSessionsTimeout = null;
function saveSessionsDebounced() {
  if (saveSessionsTimeout) {
    clearTimeout(saveSessionsTimeout);
  }
  saveSessionsTimeout = setTimeout(() => {
    saveSessions();
    saveSessionsTimeout = null;
  }, 5000); // 5秒内只保存一次
}

// 定期清理过期session并保存
setInterval(() => {
  const now = Date.now();
  let hasChanges = false;
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt) {
      sessions.delete(token);
      hasChanges = true;
    }
  }
  if (hasChanges) {
    saveSessionsDebounced();
  }
}, 60 * 60 * 1000); // 每小时清理一次

// 验证中间件
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  
  const session = sessions.get(token);
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ error: '登录已过期' });
  }
  
  req.user = session.user;
  next();
}

// 页面访问控制中间件
function requireAuthPage(req, res, next) {
  // 允许访问登录页面和静态资源
  if (req.path === '/login' ||
      req.path === '/login.html' || 
      req.path.startsWith('/style.css') ||
      req.path.startsWith('/256.webp') ||
      req.path === '/api/login') {
    return next();
  }
  
  // 检查cookie中的token
  const token = req.cookies.token;
  
  if (!token || !sessions.has(token)) {
    return res.redirect('/login');
  }
  
  const session = sessions.get(token);
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.redirect('/login');
  }
  
  next();
}

// 应用页面访问控制
app.use(requireAuthPage);

// 禁用缓存
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// 静态文件服务 - 优化缓存策略
app.use(express.static('public', {
  setHeaders: (res, path) => {
    // 对 HTML、JS、CSS 文件禁用缓存
    if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    } else if (path.endsWith('.webp') || path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg')) {
      // 图片资源缓存 1 天
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else if (path.endsWith('.json')) {
      // manifest.json 等缓存 1 小时
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  }
}));

// 路由：登录页面
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// 路由：首页
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Emby登录API
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
    return res.status(500).json({ error: 'Emby服务器未配置' });
  }

  try {
    // 使用Emby API验证用户
    const response = await fetch(
      `${process.env.EMBY_URL}/Users/AuthenticateByName`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': `MediaBrowser Client="MHSS", Device="Web", DeviceId="mhss-web", Version="1.0.0"`
        },
        body: JSON.stringify({
          Username: username,
          Pw: password
        })
      }
    );

    if (!response.ok) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }

    const data = await response.json();
    
    // 生成session token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7天
    
    sessions.set(token, {
      user: {
        id: data.User.Id,
        name: data.User.Name
      },
      expiresAt
    });

    // 保存session到文件（防抖）
    saveSessionsDebounced();

    // 设置cookie
    res.cookie('token', token, {
      httpOnly: false, // 允许JavaScript访问，因为前端需要用到
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
      sameSite: 'lax'
    });

    res.json({
      success: true,
      token,
      user: {
        id: data.User.Id,
        name: data.User.Name
      }
    });
  } catch (error) {
    console.error('登录错误:', error);
    res.status(500).json({ error: '登录失败，请稍后重试' });
  }
});

// 登出API
app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    sessions.delete(token);
    saveSessionsDebounced(); // 保存到文件（防抖）
  }
  res.clearCookie('token');
  res.json({ success: true });
});

// 验证token并检查 Emby 账号状态
app.get('/api/verify', requireAuth, async (req, res) => {
  // 检查 Emby 账号是否还存在
  if (process.env.EMBY_URL && process.env.EMBY_API_KEY && req.user) {
    try {
      const userId = req.user.id || req.user.userId;
      const username = req.user.name || req.user.username;
      
      const response = await fetch(
        `${process.env.EMBY_URL}/Users/${userId}?api_key=${process.env.EMBY_API_KEY}`
      );
      
      if (!response.ok) {
        // 账号不存在或被删除，清除该用户的 session
        console.log(`⚠️  Emby 账号已被删除: ${username} (ID: ${userId})`);
        
        // 删除该用户的所有 session
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token && sessions.has(token)) {
          sessions.delete(token);
          saveSessionsDebounced();
          console.log(`   已清除失效的 session`);
        }
        
        return res.status(401).json({ 
          success: false, 
          error: 'account_deleted',
          message: '您的账号已被删除或禁用' 
        });
      }
      
      const userData = await response.json();
      
      // 检查账号是否被禁用
      if (userData.Policy && userData.Policy.IsDisabled) {
        console.log(`⚠️  Emby 账号已被禁用: ${username}`);
        
        // 删除该用户的 session
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token && sessions.has(token)) {
          sessions.delete(token);
          saveSessionsDebounced();
          console.log(`   已清除被禁用账号的 session`);
        }
        
        return res.status(401).json({ 
          success: false, 
          error: 'account_disabled',
          message: '您的账号已被禁用' 
        });
      }
    } catch (error) {
      console.error('检查 Emby 账号状态失败:', error);
      // 如果检查失败，仍然允许访问（避免因网络问题误判）
    }
  }
  
  res.json({ success: true, user: req.user });
});

// 搜索 TMDB
app.get('/api/search', requireAuth, async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: '请输入搜索关键词' });
  }

  try {
    const response = await fetchWithProxy(
      `https://api.tmdb.org/3/search/multi?api_key=${process.env.TMDB_API_KEY}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`
    );
    const data = await response.json();
    
    // 过滤只保留电影和电视剧
    const results = data.results
      .filter(item => item.media_type === 'movie' || item.media_type === 'tv')
      .slice(0, 10)
      .map(item => ({
        id: item.id,
        title: item.title || item.name,
        originalTitle: item.original_title || item.original_name,
        year: (item.release_date || item.first_air_date || '').split('-')[0],
        type: item.media_type === 'movie' ? '电影' : '剧集',
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w200${item.poster_path}` : null,
        mediaType: item.media_type,
        requested: false,
        inLibrary: false,
        // 添加完整的 TMDB 数据供 MediaHelper 使用
        tmdbData: {
          id: item.id,
          title: item.title,
          name: item.name,
          original_title: item.original_title,
          original_name: item.original_name,
          media_type: item.media_type,
          release_date: item.release_date,
          first_air_date: item.first_air_date,
          overview: item.overview,
          poster_path: item.poster_path,
          backdrop_path: item.backdrop_path,
          vote_average: item.vote_average,
          popularity: item.popularity
        }
      }));

    // 检查 MediaHelper 订阅状态
    if (process.env.MEDIAHELPER_URL && process.env.MEDIAHELPER_USERNAME) {
      try {
        const subscriptions = await getMediaHelperSubscriptions();
        const subscriptionMap = new Map();
        
        if (subscriptions && subscriptions.subscriptions) {
          subscriptions.subscriptions.forEach(sub => {
            if (sub.params && sub.params.tmdb_id) {
              subscriptionMap.set(sub.params.tmdb_id, true);
            }
          });
        }
        
        results.forEach(item => {
          item.requested = subscriptionMap.has(item.id);
        });
      } catch (error) {
        console.error('检查 MediaHelper 订阅状态错误:', error);
      }
    }

    // 批量检查 Emby 库中是否已有这些影片
    if (process.env.EMBY_URL && process.env.EMBY_API_KEY) {
      try {
        const movieIds = results.filter(item => item.mediaType === 'movie').map(item => item.id);
        const tvIds = results.filter(item => item.mediaType === 'tv').map(item => item.id);
        
        const [movieLibrary, tvLibrary] = await Promise.all([
          movieIds.length > 0 ? checkEmbyLibraryBatch(movieIds, 'movie') : Promise.resolve(new Map()),
          tvIds.length > 0 ? checkEmbyLibraryBatch(tvIds, 'tv') : Promise.resolve(new Map())
        ]);
        
        results.forEach(item => {
          if (item.mediaType === 'movie') {
            item.inLibrary = movieLibrary.get(item.id) || false;
          } else {
            item.inLibrary = tvLibrary.get(item.id) || false;
          }
        });
      } catch (error) {
        console.error('检查 Emby 库错误:', error);
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('TMDB 搜索错误:', error);
    res.status(500).json({ error: '搜索失败，请稍后重试' });
  }
});

// 获取热门电影
app.get('/api/trending/movies', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 20; // 支持自定义每页数量
    
    const response = await fetchWithProxy(
      `https://api.tmdb.org/3/trending/movie/week?api_key=${process.env.TMDB_API_KEY}&language=zh-CN&page=${page}`
    );
    const data = await response.json();
    
    const results = data.results.slice(0, perPage).map(item => ({
      id: item.id,
      title: item.title,
      year: (item.release_date || '').split('-')[0],
      rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      requested: false,
      inLibrary: false
    }));

    // 检查 MediaHelper 订阅状态
    if (process.env.MEDIAHELPER_URL && process.env.MEDIAHELPER_USERNAME) {
      try {
        const subscriptions = await getMediaHelperSubscriptions();
        const subscriptionMap = new Map();
        
        if (subscriptions && subscriptions.subscriptions) {
          subscriptions.subscriptions.forEach(sub => {
            if (sub.params && sub.params.tmdb_id) {
              subscriptionMap.set(sub.params.tmdb_id, true);
            }
          });
        }
        
        results.forEach(movie => {
          movie.requested = subscriptionMap.has(movie.id);
        });
      } catch (error) {
        console.error('检查 MediaHelper 订阅状态错误:', error);
      }
    }

    // 批量检查 Emby 库中是否已有这些电影
    if (process.env.EMBY_URL && process.env.EMBY_API_KEY) {
      try {
        const movieIds = results.map(movie => movie.id);
        const libraryStatus = await checkEmbyLibraryBatch(movieIds, 'movie');
        
        results.forEach(movie => {
          movie.inLibrary = libraryStatus.get(movie.id) || false;
        });
      } catch (error) {
        console.error('检查 Emby 库错误:', error);
      }
    }

    res.json({ 
      results,
      page,
      total_pages: data.total_pages
    });
  } catch (error) {
    console.error('获取热门电影错误:', error);
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取热门电视剧
app.get('/api/trending/tv', requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 20; // 支持自定义每页数量
    
    const response = await fetchWithProxy(
      `https://api.tmdb.org/3/trending/tv/week?api_key=${process.env.TMDB_API_KEY}&language=zh-CN&page=${page}`
    );
    const data = await response.json();
    
    const results = data.results.slice(0, perPage).map(item => ({
      id: item.id,
      title: item.name,
      year: (item.first_air_date || '').split('-')[0],
      rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      requested: false,
      inLibrary: false
    }));

    // 检查 MediaHelper 订阅状态
    if (process.env.MEDIAHELPER_URL && process.env.MEDIAHELPER_USERNAME) {
      try {
        const subscriptions = await getMediaHelperSubscriptions();
        const subscriptionMap = new Map();
        
        if (subscriptions && subscriptions.subscriptions) {
          subscriptions.subscriptions.forEach(sub => {
            if (sub.params && sub.params.tmdb_id) {
              subscriptionMap.set(sub.params.tmdb_id, true);
            }
          });
        }
        
        results.forEach(show => {
          show.requested = subscriptionMap.has(show.id);
        });
      } catch (error) {
        console.error('检查 MediaHelper 订阅状态错误:', error);
      }
    }

    // 批量检查 Emby 库中是否已有这些电视剧
    if (process.env.EMBY_URL && process.env.EMBY_API_KEY) {
      try {
        const tvIds = results.map(show => show.id);
        const libraryStatus = await checkEmbyLibraryBatch(tvIds, 'tv');
        
        results.forEach(show => {
          show.inLibrary = libraryStatus.get(show.id) || false;
        });
      } catch (error) {
        console.error('检查 Emby 库错误:', error);
      }
    }

    res.json({ 
      results,
      page,
      total_pages: data.total_pages
    });
  } catch (error) {
    console.error('获取热门电视剧错误:', error);
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取 Emby 影片库统计
app.get('/api/emby/stats', async (req, res) => {
  // 计算今日请求数（从 MediaHelper 订阅列表）
  let todayRequests = 0;
  try {
    if (process.env.MEDIAHELPER_URL && process.env.MEDIAHELPER_USERNAME) {
      const data = await getMediaHelperSubscriptions();
      if (data && data.subscriptions) {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        todayRequests = data.subscriptions.filter(sub => {
          const createdDate = (sub.created_at || '').split('T')[0];
          return createdDate === today;
        }).length;
      }
    }
  } catch (error) {
    console.error('统计今日请求数失败:', error);
  }

  if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
    return res.json({ 
      total: null, 
      embyUrl: null,
      todayRequests: todayRequests
    });
  }

  try {
    const response = await fetch(
      `${process.env.EMBY_URL}/Items/Counts?api_key=${process.env.EMBY_API_KEY}`
    );
    
    if (!response.ok) {
      console.error(`❌ Emby 连接失败: HTTP ${response.status} ${response.statusText}`);
      return res.json({ 
        total: null, 
        embyUrl: null,
        todayRequests: todayRequests,
        error: `HTTP ${response.status}: ${response.statusText}`
      });
    }
    
    const data = await response.json();
    
    // 电影 + 剧集的总数
    const total = (data.MovieCount || 0) + (data.SeriesCount || 0);
    
    res.json({ 
      total,
      movies: data.MovieCount || 0,
      series: data.SeriesCount || 0,
      episodes: data.EpisodeCount || 0,
      embyUrl: process.env.EMBY_URL,
      todayRequests: todayRequests
    });
  } catch (error) {
    console.error('❌ Emby 连接错误:', {
      message: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      address: error.address,
      port: error.port
    });
    res.json({ 
      total: null, 
      embyUrl: null,
      todayRequests: todayRequests,
      error: error.message || '连接失败'
    });
  }
});

// 检查 TMDB 状态
app.get('/api/tmdb/status', requireAuth, async (req, res) => {
  try {
    const startTime = Date.now();
    const response = await fetchWithProxy(
      `https://api.tmdb.org/3/configuration?api_key=${process.env.TMDB_API_KEY}`
    );
    const ping = Date.now() - startTime;
    
    if (!response.ok) {
      console.error(`❌ TMDB 连接失败: HTTP ${response.status} ${response.statusText}`);
      return res.json({ 
        online: false,
        ping: 0,
        error: `HTTP ${response.status}: ${response.statusText}`
      });
    }
    
    res.json({ 
      online: true,
      ping
    });
  } catch (error) {
    console.error('❌ TMDB 连接错误:', {
      message: error.message,
      code: error.code
    });
    res.json({ 
      online: false,
      ping: 0,
      error: error.message || '连接失败'
    });
  }
});

// 获取 Emby 入库趋势（最近7天）- 优化版
app.get('/api/emby/trends', async (req, res) => {
  if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
    return res.json({ 
      movies: [],
      tv: []
    });
  }

  // 检查缓存
  const now = Date.now();
  if (trendsCacheData && now < trendsCacheExpiry) {
    return res.json(trendsCacheData);
  }

  try {
    // 获取北京时间（UTC+8）的今天 0 点
    const utcNow = new Date();
    const beijingNow = new Date(utcNow.getTime() + 8 * 60 * 60 * 1000);
    const beijingToday = new Date(Date.UTC(
      beijingNow.getUTCFullYear(),
      beijingNow.getUTCMonth(),
      beijingNow.getUTCDate(),
      0, 0, 0, 0
    ));
    
    // 计算7天前（包含今天，所以是 -6）
    const sevenDaysAgo = new Date(beijingToday);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);
    
    // 转换回 UTC 时间用于 API 查询（减去8小时）
    const minDate = new Date(sevenDaysAgo.getTime() - 8 * 60 * 60 * 1000);
    
    // 并行获取电影和剧集数据
    const [movieResponse, tvResponse] = await Promise.all([
      fetch(
        `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Movie&Recursive=true&MinDateCreated=${minDate.toISOString()}&Fields=DateCreated&Limit=50000`
      ),
      fetch(
        `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Episode&Recursive=true&MinDateCreated=${minDate.toISOString()}&Fields=DateCreated&Limit=50000`
      )
    ]);
    
    const movieResult = await movieResponse.json();
    const tvResult = await tvResponse.json();
    
    const movies = movieResult.Items || [];
    const episodes = tvResult.Items || [];
    
    // 按天统计
    const movieData = new Array(7).fill(0);
    const tvData = new Array(7).fill(0);
    
    // 统计电影
    movies.forEach(item => {
      if (item.DateCreated) {
        // Emby 返回的是 UTC 时间，转换为北京时间
        const utcCreated = new Date(item.DateCreated);
        const beijingCreated = new Date(utcCreated.getTime() + 8 * 60 * 60 * 1000);
        const beijingCreatedDay = new Date(Date.UTC(
          beijingCreated.getUTCFullYear(),
          beijingCreated.getUTCMonth(),
          beijingCreated.getUTCDate(),
          0, 0, 0, 0
        ));
        
        // 计算距离今天的天数（0 = 今天, 1 = 昨天, ...）
        const daysDiff = Math.floor((beijingToday.getTime() - beijingCreatedDay.getTime()) / (24 * 60 * 60 * 1000));
        
        // 数组索引：[6天前, 5天前, ..., 昨天, 今天]
        if (daysDiff >= 0 && daysDiff <= 6) {
          movieData[6 - daysDiff]++;
        }
      }
    });
    
    // 统计剧集
    episodes.forEach(item => {
      if (item.DateCreated) {
        // Emby 返回的是 UTC 时间，转换为北京时间
        const utcCreated = new Date(item.DateCreated);
        const beijingCreated = new Date(utcCreated.getTime() + 8 * 60 * 60 * 1000);
        const beijingCreatedDay = new Date(Date.UTC(
          beijingCreated.getUTCFullYear(),
          beijingCreated.getUTCMonth(),
          beijingCreated.getUTCDate(),
          0, 0, 0, 0
        ));
        
        // 计算距离今天的天数
        const daysDiff = Math.floor((beijingToday.getTime() - beijingCreatedDay.getTime()) / (24 * 60 * 60 * 1000));
        
        if (daysDiff >= 0 && daysDiff <= 6) {
          tvData[6 - daysDiff]++;
        }
      }
    });
    
    const result = { 
      movies: movieData,
      tv: tvData
    };
    
    // 更新缓存
    trendsCacheData = result;
    trendsCacheExpiry = Date.now() + TRENDS_CACHE_TTL;
    
    res.json(result);
  } catch (error) {
    console.error('获取 Emby 趋势错误:', error);
    res.json({ 
      movies: [],
      tv: []
    });
  }
});

// 获取最近请求
app.get('/api/recent-requests', async (req, res) => {
  try {
    // 从 MediaHelper 获取订阅列表
    if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME) {
      return res.json({ requests: [] });
    }

    const data = await getMediaHelperSubscriptions();
    // console.log('MediaHelper 订阅数据:', JSON.stringify(data, null, 2));
    
    if (data && data.subscriptions && data.subscriptions.length > 0) {
      // 转换 MediaHelper 订阅数据为前端需要的格式
      const requestsWithPosters = data.subscriptions.slice(0, 30).map(sub => {
        const info = sub.subscription_info || {};
        const params = sub.params || {};
        
        // 处理海报路径 - 可能是完整 URL 或相对路径
        let posterUrl = info.poster_path || params.poster_path || null;
        if (posterUrl && !posterUrl.startsWith('http')) {
          // 如果是相对路径，添加 TMDB 前缀
          posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
        }
        
        // 处理时间 - MediaHelper 返回的时间是 UTC 时间但没有 Z 后缀
        let requestedAt = sub.created_at || sub.updated_at;
        if (requestedAt && !requestedAt.endsWith('Z')) {
          // MediaHelper 返回的时间格式: "2026-01-24T05:35:45.153747"
          // 这是 UTC 时间，添加 Z 后缀让前端正确解析
          requestedAt = requestedAt + 'Z';
        }
        
        return {
          id: info.tmdb_id || params.tmdb_id,
          title: info.title || params.title || params.custom_name || sub.name,
          mediaType: info.media_type || params.media_type,
          requestedAt: requestedAt,
          poster: posterUrl
        };
      });
      
      // console.log('转换后的订阅数据:', JSON.stringify(requestsWithPosters.slice(0, 3), null, 2));
      return res.json({ requests: requestsWithPosters });
    }
    
    res.json({ requests: [] });
  } catch (error) {
    console.error('获取最近请求错误:', error);
    res.json({ requests: [] });
  }
});

// 未完成订阅缓存
let incompleteSubscriptionsCache = null;
let incompleteSubscriptionsCacheExpiry = 0;
const INCOMPLETE_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

// 获取未完成的订阅（带缓存和增量更新）
app.get('/api/incomplete-subscriptions', requireAuth, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    
    // 如果有缓存且未过期，直接返回
    if (!forceRefresh && incompleteSubscriptionsCache && Date.now() < incompleteSubscriptionsCacheExpiry) {
      console.log('📦 返回缓存的未完成订阅数据');
      return res.json(incompleteSubscriptionsCache);
    }

    if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME) {
      return res.json({ subscriptions: [], total: 0 });
    }

    if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
      return res.json({ subscriptions: [], total: 0 });
    }

    // 1. 获取所有订阅
    const data = await getMediaHelperSubscriptions();
    if (!data || !data.subscriptions || data.subscriptions.length === 0) {
      const result = { subscriptions: [], total: 0 };
      incompleteSubscriptionsCache = result;
      incompleteSubscriptionsCacheExpiry = Date.now() + INCOMPLETE_CACHE_TTL;
      return res.json(result);
    }

    // 2. 获取所有订阅（电影和电视剧）
    const allMediaSubscriptions = data.subscriptions.filter(sub => {
      const params = sub.params || {};
      return params.media_type === 'tv' || params.media_type === 'movie';
    });

    if (allMediaSubscriptions.length === 0) {
      const result = { subscriptions: [], total: 0 };
      incompleteSubscriptionsCache = result;
      incompleteSubscriptionsCacheExpiry = Date.now() + INCOMPLETE_CACHE_TTL;
      return res.json(result);
    }

    console.log(`\n🔍 检查 ${allMediaSubscriptions.length} 个订阅的完成情况...`);
    
    // 统计电影和电视剧数量
    const movieCount = allMediaSubscriptions.filter(s => s.params?.media_type === 'movie').length;
    const tvCount = allMediaSubscriptions.filter(s => s.params?.media_type === 'tv').length;
    console.log(`   📊 电影: ${movieCount} 个, 电视剧: ${tvCount} 个`);

    // 3. 检查每个订阅的情况
    const incompleteSubscriptions = [];

    for (const sub of allMediaSubscriptions) {
      const params = sub.params || {};
      const mediaType = params.media_type;
      const tmdbId = params.tmdb_id;
      const title = params.title || params.custom_name || sub.name;
      
      if (!tmdbId) continue;

      try {
        if (mediaType === 'tv') {
          // 电视剧：检查集数
          const tmdbResponse = await fetchWithProxy(
            `https://api.tmdb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
          );

          if (!tmdbResponse.ok) {
            continue;
          }

          const tmdbData = await tmdbResponse.json();
          
          // TMDB 总集数
          const tmdbTotalEpisodes = tmdbData.number_of_episodes || 0;
          const tmdbStatus = tmdbData.status;
          
          if (tmdbTotalEpisodes === 0) {
            continue; // 跳过没有集数信息的
          }

          // 查询 Emby 中的实际集数
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Series&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );

          let embyEpisodeCount = 0;
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            const items = embyData.Items || [];
            
            if (items.length > 0) {
              const seriesId = items[0].Id;
              
              // 获取该剧集的所有 episodes
              const episodesResponse = await fetch(
                `${process.env.EMBY_URL}/Shows/${seriesId}/Episodes?api_key=${process.env.EMBY_API_KEY}`
              );

              if (episodesResponse.ok) {
                const episodesData = await episodesResponse.json();
                embyEpisodeCount = episodesData.Items?.length || 0;
              }
            }
          }

          const missingCount = tmdbTotalEpisodes - embyEpisodeCount;
          
          // 只显示缺集的（缺集数 > 0）
          if (missingCount > 0) {
            console.log(`   ⚠️  ${title}: ${embyEpisodeCount}/${tmdbTotalEpisodes} 集 (缺 ${missingCount} 集) [${tmdbStatus}]`);
            
            incompleteSubscriptions.push({
              ...sub,
              mediaType: 'tv',
              status: tmdbStatus === 'Ended' || tmdbStatus === 'Canceled' ? 'incomplete' : 'ongoing',
              embyEpisodes: embyEpisodeCount,
              tmdbTotalEpisodes: tmdbTotalEpisodes,
              missingEpisodes: missingCount,
              tmdbStatus: tmdbStatus
            });
          }
        } else if (mediaType === 'movie') {
          // 电影：检查是否已入库
          console.log(`   🎬 检查电影: ${title} (tmdb_id=${tmdbId})`);
          
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );

          let hasMovie = false;
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            hasMovie = (embyData.Items || []).length > 0;
            console.log(`   🔍 Emby 查询结果: ${hasMovie ? '已入库' : '未入库'} (找到 ${embyData.Items?.length || 0} 个)`);
          } else {
            console.log(`   ❌ Emby 查询失败: ${embyResponse.status}`);
          }

          // 如果电影还没入库，显示在未完成列表中
          if (!hasMovie) {
            console.log(`   ⚠️  ${title}: 未入库 [电影]`);
            
            incompleteSubscriptions.push({
              ...sub,
              mediaType: 'movie',
              status: 'pending',
              embyEpisodes: 0,
              tmdbTotalEpisodes: 1,
              missingEpisodes: 1,
              tmdbStatus: 'Movie'
            });
          }
        }
      } catch (error) {
        console.error(`   ❌ 检查 ${title} 失败:`, error.message);
        continue;
      }
    }

    console.log(`\n📊 找到 ${incompleteSubscriptions.length} 个未完成的订阅\n`);

    // 4. 格式化返回数据
    const formattedSubscriptions = incompleteSubscriptions.map(sub => {
      const params = sub.params || {};
      const info = sub.subscription_info || {};
      
      let posterUrl = info.poster_path || params.poster_path || null;
      if (posterUrl && !posterUrl.startsWith('http')) {
        posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
      }

      const statusText = {
        'incomplete': '已完结-缺集',
        'ongoing': '连载中',
        'pending': '等待资源',
        'unknown': '未知'
      }[sub.status] || '未知';

      return {
        id: params.tmdb_id,
        title: params.title || params.custom_name || sub.name,
        poster: posterUrl,
        mediaType: sub.mediaType || params.media_type,
        status: sub.status,
        statusText: statusText,
        subscribedEpisodes: sub.embyEpisodes,
        tmdbTotalEpisodes: sub.tmdbTotalEpisodes,
        missingEpisodes: sub.missingEpisodes,
        progress: sub.tmdbTotalEpisodes > 0 ? Math.round((sub.embyEpisodes / sub.tmdbTotalEpisodes) * 100) : 0,
        tmdbStatus: sub.tmdbStatus,
        subscriptionId: sub.uuid,
        createdAt: sub.created_at
      };
    });

    // 按创建时间排序（最新的排前面）
    formattedSubscriptions.sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA; // 降序，最新的在前
    });

    const result = { 
      subscriptions: formattedSubscriptions,
      total: formattedSubscriptions.length,
      cachedAt: Date.now()
    };
    
    // 更新缓存
    incompleteSubscriptionsCache = result;
    incompleteSubscriptionsCacheExpiry = Date.now() + INCOMPLETE_CACHE_TTL;

    res.json(result);
  } catch (error) {
    console.error('获取未完成订阅错误:', error);
    res.json({ subscriptions: [], total: 0 });
  }
});

// 轻量级更新未完成订阅（检查集数变化 + 检测新订阅）
app.post('/api/incomplete-subscriptions/update', requireAuth, async (req, res) => {
  try {
    const { subscriptions } = req.body; // 前端传来的当前订阅列表
    
    if (!subscriptions || !Array.isArray(subscriptions)) {
      return res.status(400).json({ error: '无效的请求数据' });
    }

    if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME) {
      return res.json({ updates: [], removed: [], newSubscriptions: [] });
    }

    if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
      return res.json({ updates: [], removed: [], newSubscriptions: [] });
    }

    console.log(`\n🔄 轻量级更新 ${subscriptions.length} 个订阅...`);

    const updates = [];
    const removed = [];
    const newSubscriptions = [];

    // 1. 获取 MediaHelper 的所有订阅
    const mhData = await getMediaHelperSubscriptions();
    if (!mhData || !mhData.subscriptions) {
      return res.json({ updates: [], removed: [], newSubscriptions: [] });
    }

    // 2. 筛选出电影和电视剧订阅，按创建时间降序排序
    const allMediaSubscriptions = mhData.subscriptions
      .filter(sub => {
        const params = sub.params || {};
        return params.media_type === 'tv' || params.media_type === 'movie';
      })
      .sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        return dateB - dateA; // 降序，最新的在前
      });

    // 3. 创建已有订阅的 ID 集合（用于快速查找）
    const existingIds = new Set(subscriptions.map(s => s.id));

    console.log(`   📊 MediaHelper 有 ${allMediaSubscriptions.length} 个订阅，缓存中有 ${subscriptions.length} 个`);

    // 4. 检测新订阅（遇到已存在的订阅就停止，因为后面都是旧的）
    let foundExisting = false;
    for (const sub of allMediaSubscriptions) {
      const params = sub.params || {};
      const tmdbId = params.tmdb_id;
      
      if (!tmdbId) continue;

      // 如果这个订阅已经在缓存中，说明后面都是旧订阅，停止检查
      if (existingIds.has(tmdbId)) {
        console.log(`   ✅ 遇到已存在的订阅: ${params.title || sub.name}，停止检查新订阅`);
        foundExisting = true;
        break;
      }

      // 这是新订阅，需要检查
      const mediaType = params.media_type;
      const title = params.title || params.custom_name || sub.name;
      
      console.log(`   🆕 发现新订阅: ${title} [${mediaType === 'movie' ? '电影' : '电视剧'}]`);

      try {
        if (mediaType === 'tv') {
          // 电视剧：检查集数
          const tmdbResponse = await fetchWithProxy(
            `https://api.tmdb.org/3/tv/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
          );

          if (!tmdbResponse.ok) continue;

          const tmdbData = await tmdbResponse.json();
          const tmdbTotalEpisodes = tmdbData.number_of_episodes || 0;
          const tmdbStatus = tmdbData.status;
          
          if (tmdbTotalEpisodes === 0) continue;

          // 查询 Emby 中的实际集数
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Series&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );

          let embyEpisodeCount = 0;
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            const items = embyData.Items || [];
            
            if (items.length > 0) {
              const seriesId = items[0].Id;
              const episodesResponse = await fetch(
                `${process.env.EMBY_URL}/Shows/${seriesId}/Episodes?api_key=${process.env.EMBY_API_KEY}`
              );

              if (episodesResponse.ok) {
                const episodesData = await episodesResponse.json();
                embyEpisodeCount = episodesData.Items?.length || 0;
              }
            }
          }

          const missingCount = tmdbTotalEpisodes - embyEpisodeCount;
          
          if (missingCount > 0) {
            const info = sub.subscription_info || {};
            let posterUrl = info.poster_path || params.poster_path || null;
            if (posterUrl && !posterUrl.startsWith('http')) {
              posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
            }

            newSubscriptions.push({
              id: tmdbId,
              title: title,
              poster: posterUrl,
              mediaType: 'tv',
              status: tmdbStatus === 'Ended' || tmdbStatus === 'Canceled' ? 'incomplete' : 'ongoing',
              statusText: tmdbStatus === 'Ended' || tmdbStatus === 'Canceled' ? '已完结-缺集' : '连载中',
              subscribedEpisodes: embyEpisodeCount,
              tmdbTotalEpisodes: tmdbTotalEpisodes,
              missingEpisodes: missingCount,
              progress: Math.round((embyEpisodeCount / tmdbTotalEpisodes) * 100),
              tmdbStatus: tmdbStatus,
              subscriptionId: sub.uuid,
              createdAt: sub.created_at
            });
          }
        } else if (mediaType === 'movie') {
          // 电影：检查是否已入库
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );

          let hasMovie = false;
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            hasMovie = (embyData.Items || []).length > 0;
          }

          if (!hasMovie) {
            const info = sub.subscription_info || {};
            let posterUrl = info.poster_path || params.poster_path || null;
            if (posterUrl && !posterUrl.startsWith('http')) {
              posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
            }

            newSubscriptions.push({
              id: tmdbId,
              title: title,
              poster: posterUrl,
              mediaType: 'movie',
              status: 'pending',
              statusText: '等待资源',
              subscribedEpisodes: 0,
              tmdbTotalEpisodes: 1,
              missingEpisodes: 1,
              progress: 0,
              tmdbStatus: 'Movie',
              subscriptionId: sub.uuid,
              createdAt: sub.created_at
            });
          }
        }
      } catch (error) {
        console.error(`   ❌ 检查新订阅 ${title} 失败:`, error.message);
        continue;
      }
    }

    // 5. 检查现有订阅的集数变化（使用已经获取的 mhData，避免重复查询）
    const mhSubscriptionsMap = new Map();
    allMediaSubscriptions.forEach(s => {
      const params = s.params || {};
      if (params.tmdb_id) {
        mhSubscriptionsMap.set(params.tmdb_id, s);
      }
    });

    for (const sub of subscriptions) {
      const tmdbId = sub.id;
      
      try {
        // 1. 检查订阅是否还存在
        const stillExists = mhSubscriptionsMap.has(tmdbId);

        if (!stillExists) {
          console.log(`   ❌ 订阅已删除: ${sub.title}`);
          removed.push(tmdbId);
          continue;
        }

        // 2. 根据类型检查
        if (sub.mediaType === 'tv') {
          // 电视剧：查询 Emby 中的最新集数
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Series&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );

          let embyEpisodeCount = 0;
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            const items = embyData.Items || [];
            
            if (items.length > 0) {
              const seriesId = items[0].Id;
              
              const episodesResponse = await fetch(
                `${process.env.EMBY_URL}/Shows/${seriesId}/Episodes?api_key=${process.env.EMBY_API_KEY}`
              );

              if (episodesResponse.ok) {
                const episodesData = await episodesResponse.json();
                embyEpisodeCount = episodesData.Items?.length || 0;
              }
            }
          }

          // 3. 如果集数有变化，记录更新
          if (embyEpisodeCount !== sub.subscribedEpisodes) {
            const missingEpisodes = sub.tmdbTotalEpisodes - embyEpisodeCount;
            console.log(`   🔄 ${sub.title}: ${sub.subscribedEpisodes} → ${embyEpisodeCount} 集`);
            
            updates.push({
              id: tmdbId,
              subscribedEpisodes: embyEpisodeCount,
              missingEpisodes: missingEpisodes,
              progress: sub.tmdbTotalEpisodes > 0 ? Math.round((embyEpisodeCount / sub.tmdbTotalEpisodes) * 100) : 0
            });

            // 如果已经完成（缺集数 <= 0），也标记为移除
            if (missingEpisodes <= 0) {
              console.log(`   ✅ 订阅已完成: ${sub.title}`);
              removed.push(tmdbId);
            }
          }
        } else if (sub.mediaType === 'movie') {
          // 电影：检查是否已入库
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );

          let hasMovie = false;
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            hasMovie = (embyData.Items || []).length > 0;
          }

          // 如果电影已入库，标记为移除
          if (hasMovie) {
            console.log(`   ✅ 电影已入库: ${sub.title}`);
            removed.push(tmdbId);
          }
        }
      } catch (error) {
        console.error(`   ❌ 检查 ${sub.title} 失败:`, error.message);
        continue;
      }
    }

    console.log(`\n📊 更新完成: ${newSubscriptions.length} 个新订阅, ${updates.length} 个变化, ${removed.length} 个移除\n`);

    res.json({ 
      newSubscriptions: newSubscriptions,
      updates: updates,
      removed: removed,
      checkedAt: Date.now()
    });
  } catch (error) {
    console.error('轻量级更新错误:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// HDHive 批量查找 API
app.post('/api/hdhive/search', requireAuth, async (req, res) => {
  try {
    const { tmdbId, mediaType } = req.body;
    
    if (!tmdbId || !mediaType) {
      return res.status(400).json({ error: '缺少必要参数' });
    }
    
    // 调用 HDHive 查询
    const hdhiveLinks = await getHDHiveFreeLinks(tmdbId, mediaType);
    
    if (hdhiveLinks && hdhiveLinks.length > 0) {
      res.json({
        success: true,
        links: hdhiveLinks,
        count: hdhiveLinks.length
      });
    } else {
      res.json({
        success: false,
        links: [],
        count: 0
      });
    }
  } catch (error) {
    console.error('HDHive 查找错误:', error);
    res.status(500).json({ error: '查找失败: ' + error.message });
  }
});

// 批量查找任务状态
let batchSearchTask = {
  running: false,
  progress: 0,
  total: 0,
  current: null,
  currentTaskId: null, // 当前任务的唯一ID
  logs: [],
  results: {
    success: 0,
    fail: 0,
    totalLinks: 0
  }
};

// 添加链接到订阅（优化版：接收订阅数据，避免重复查询）
async function addLinksToSubscription(subscription, links) {
  try {
    const subscriptionId = subscription.uuid;
    const title = subscription.params?.title || subscription.params?.custom_name || subscriptionId;
    
    // 2. 获取现有的自定义链接和已处理的链接
    const existingLinks = subscription.params?.user_custom_links || [];
    const processedUrls = subscription.params?.processed_share_urls?.drive115 || {};
    
    console.log(`   📋 订阅 ${title} 现有 ${existingLinks.length} 个自定义链接`);
    console.log(`   📋 已处理 ${Object.keys(processedUrls).length} 个分享链接`);
    
    // 判断链接格式：可能是字符串数组或对象数组
    let existingUrls = new Set();
    
    if (existingLinks.length > 0) {
      if (typeof existingLinks[0] === 'string') {
        // 字符串数组格式
        existingUrls = new Set(existingLinks);
        console.log(`   现有链接示例: ${existingLinks[0].substring(0, 50)}...`);
      } else {
        // 对象数组格式 {url: "...", name: "..."}
        existingUrls = new Set(existingLinks.map(l => l.url).filter(Boolean));
        if (existingLinks[0]?.url) {
          console.log(`   现有链接示例: ${existingLinks[0].url.substring(0, 50)}...`);
        }
      }
    }
    
    // 提取已处理链接的分享码
    const processedShareCodes = new Set(Object.keys(processedUrls));
    console.log(`   已处理的分享码数量: ${processedShareCodes.size}`);
    
    console.log(`   现有链接集合大小: ${existingUrls.size}`);
    
    // 打印新链接示例
    if (links.length > 0 && links[0]) {
      console.log(`   新链接示例: ${links[0].substring(0, 50)}...`);
    }
    
    // 3. 过滤出新链接（只检查 user_custom_links，不检查 processed_share_urls）
    const newLinks = links.filter(link => {
      if (!link) return false;
      
      // 只检查是否在 user_custom_links 中
      if (existingUrls.has(link)) {
        console.log(`   ⚠️ 链接已在 user_custom_links 中: ${link.substring(0, 50)}...`);
        return false;
      }
      
      // 提取分享码用于日志显示
      const match = link.match(/\/s\/([^?]+)/);
      if (match) {
        const shareCode = match[1];
        // 如果在 processed_share_urls 中，只记录日志，但仍然添加
        if (processedShareCodes.has(shareCode)) {
          console.log(`   ℹ️ 分享码 ${shareCode} 已在 processed_share_urls 中，但仍会添加到 user_custom_links`);
        }
      }
      
      return true;
    });
    
    const duplicateCount = links.length - newLinks.length;
    
    console.log(`   🔍 检查结果: ${links.length} 个链接，${newLinks.length} 个新链接，${duplicateCount} 个重复`);
    
    if (newLinks.length === 0) {
      return {
        added: 0,
        duplicate: links.length,
        total: links.length
      };
    }
    
    // 4. 一次性添加所有新链接
    console.log(`   📤 正在添加 ${newLinks.length} 个新链接...`);
    
    const updatedLinks = [...existingLinks, ...newLinks];
    
    const updatePayload = {
      params: {
        user_custom_links: updatedLinks
      }
    };
    
    try {
      const updateResponse = await fetch(
        `${process.env.MEDIAHELPER_URL}/api/v1/subscription/${subscriptionId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${mediaHelperToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(updatePayload)
        }
      );
      
      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error(`   ❌ 添加链接失败: ${updateResponse.status} - ${errorText}`);
        throw new Error(`更新订阅失败: ${updateResponse.status}`);
      }
      
      const updateResult = await updateResponse.json();
      
      // 检查返回的数据
      if (updateResult.data && updateResult.data.params) {
        const returnedLinks = updateResult.data.params.user_custom_links || [];
        const processedUrls = updateResult.data.params.processed_share_urls || {};
        const processedCount = Object.keys(processedUrls.drive115 || {}).length;
        
        console.log(`   ✅ 链接添加成功`);
        console.log(`   📊 user_custom_links: ${returnedLinks.length} 个`);
        console.log(`   📊 processed_share_urls: ${processedCount} 个`);
        
        // 触发订阅执行（只触发一次）
        try {
          console.log(`   💾 触发订阅执行...`);
          const saveResponse = await fetch(
            `${process.env.MEDIAHELPER_URL}/api/v1/subscription/${subscriptionId}/execute`,
            {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${mediaHelperToken}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          if (saveResponse.ok) {
            console.log(`   ✅ 订阅执行触发成功`);
          } else {
            console.log(`   ⚠️ 订阅执行触发失败: ${saveResponse.status}`);
          }
        } catch (saveError) {
          console.log(`   ⚠️ 触发执行异常:`, saveError.message);
        }
        
        console.log(`   🎉 成功添加 ${newLinks.length} 个新链接到订阅 ${title}`);
        
        return {
          added: newLinks.length,
          duplicate: duplicateCount,
          total: links.length
        };
      } else {
        console.log(`   ⚠️ 返回格式异常`);
        throw new Error('返回格式异常');
      }
      
    } catch (error) {
      console.error(`   ❌ 添加链接异常:`, error.message);
      throw error;
    }
    
  } catch (error) {
    console.error(`   ❌ 添加链接到订阅失败:`, error.message);
    throw error;
  }
}

// 测试：手动添加链接到订阅 V2（从订阅列表获取数据）
app.post('/api/test/add-link-v2', async (req, res) => {
  try {
    const { subscriptionId, testLink } = req.body;
    
    if (!subscriptionId) {
      return res.status(400).json({ error: '缺少订阅 ID' });
    }
    
    const token = await getMediaHelperToken();
    
    // 1. 从订阅列表中获取订阅信息
    console.log(`\n🧪 测试 V2：从列表中查找订阅 ${subscriptionId}`);
    
    const allSubs = await getMediaHelperSubscriptions();
    const subscription = allSubs.subscriptions.find(sub => sub.uuid === subscriptionId);
    
    if (!subscription) {
      throw new Error('未找到订阅');
    }
    
    console.log(`   订阅名称: ${subscription.name}`);
    console.log(`   现有 user_custom_links: ${subscription.params?.user_custom_links?.length || 0} 个`);
    console.log(`   现有 processed_share_urls: ${Object.keys(subscription.params?.processed_share_urls?.drive115 || {}).length} 个`);
    
    // 2. 添加测试链接
    const linkToAdd = testLink || 'https://115cdn.com/s/test123456?password=test';
    const existingLinks = subscription.params?.user_custom_links || [];
    const updatedLinks = [...existingLinks, linkToAdd];
    
    console.log(`   添加测试链接: ${linkToAdd}`);
    console.log(`   更新后 user_custom_links 总数: ${updatedLinks.length}`);
    
    // 3. 更新订阅 - 关键：payload 要放在 params 字段里！
    const updatePayload = {
      params: {
        user_custom_links: updatedLinks
      }
    };
    
    console.log(`   发送 PUT 请求到 /api/v1/subscription/${subscriptionId}`);
    console.log(`   📋 payload:`, JSON.stringify(updatePayload));
    const updateResponse = await fetch(
      `${process.env.MEDIAHELPER_URL}/api/v1/subscription/${subscriptionId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    );
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`   ❌ 更新失败: ${updateResponse.status} - ${errorText}`);
      throw new Error(`更新失败: ${updateResponse.status}`);
    }
    
    const updateResult = await updateResponse.json();
    console.log(`   ✅ 更新成功`);
    
    // 4. 检查返回结果
    if (updateResult.data && updateResult.data.params) {
      const returnedLinks = updateResult.data.params.user_custom_links || [];
      const processedUrls = updateResult.data.params.processed_share_urls?.drive115 || {};
      
      console.log(`   📊 返回的 user_custom_links: ${returnedLinks.length} 个`);
      console.log(`   📊 返回的 processed_share_urls: ${Object.keys(processedUrls).length} 个`);
      console.log(`   📋 user_custom_links 内容:`, returnedLinks);
      console.log(`   📋 processed_share_urls 内容:`, Object.keys(processedUrls));
      
      res.json({
        success: true,
        addedLink: linkToAdd,
        userCustomLinks: returnedLinks,
        processedShareUrls: Object.keys(processedUrls),
        message: `发送了 ${updatedLinks.length} 个链接，返回了 ${returnedLinks.length} 个 user_custom_links 和 ${Object.keys(processedUrls).length} 个 processed_share_urls`
      });
    } else {
      res.json({
        success: true,
        message: '更新成功但返回格式异常',
        result: updateResult
      });
    }
    
  } catch (error) {
    console.error('测试添加链接失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 测试：手动添加链接到订阅（无需认证，仅用于调试）
app.post('/api/test/add-link', async (req, res) => {
  try {
    const { subscriptionId, testLink } = req.body;
    
    if (!subscriptionId) {
      return res.status(400).json({ error: '缺少订阅 ID' });
    }
    
    const token = await getMediaHelperToken();
    
    // 1. 获取订阅信息
    console.log(`\n🧪 测试：获取订阅 ${subscriptionId}`);
    const subResponse = await fetch(
      `${process.env.MEDIAHELPER_URL}/api/v1/subscription/${subscriptionId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      }
    );
    
    if (!subResponse.ok) {
      const errorText = await subResponse.text();
      console.error(`   ❌ 获取订阅失败: ${subResponse.status} - ${errorText}`);
      throw new Error(`获取订阅失败: ${subResponse.status}`);
    }
    
    const subData = await subResponse.json();
    const subscription = subData.data;
    
    console.log(`   订阅名称: ${subscription.name}`);
    console.log(`   现有 user_custom_links: ${subscription.params?.user_custom_links?.length || 0} 个`);
    
    // 2. 添加测试链接
    const linkToAdd = testLink || 'https://115cdn.com/s/test123456?password=test';
    const existingLinks = subscription.params?.user_custom_links || [];
    const updatedLinks = [...existingLinks, linkToAdd];
    
    console.log(`   添加测试链接: ${linkToAdd}`);
    console.log(`   更新后总数: ${updatedLinks.length}`);
    
    // 3. 更新订阅
    const updatePayload = {
      ...subscription.params,
      user_custom_links: updatedLinks
    };
    
    console.log(`   发送 PUT 请求...`);
    const updateResponse = await fetch(
      `${process.env.MEDIAHELPER_URL}/api/v1/subscription/${subscriptionId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      }
    );
    
    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error(`   ❌ 更新失败: ${updateResponse.status} - ${errorText}`);
      throw new Error(`更新失败: ${updateResponse.status}`);
    }
    
    const updateResult = await updateResponse.json();
    console.log(`   ✅ 更新成功`);
    
    // 4. 检查返回结果
    if (updateResult.data && updateResult.data.params) {
      const returnedLinks = updateResult.data.params.user_custom_links || [];
      const processedUrls = updateResult.data.params.processed_share_urls?.drive115 || {};
      
      console.log(`   📊 返回的 user_custom_links: ${returnedLinks.length} 个`);
      console.log(`   📊 返回的 processed_share_urls: ${Object.keys(processedUrls).length} 个`);
      console.log(`   📋 user_custom_links 内容:`, returnedLinks);
      
      res.json({
        success: true,
        addedLink: linkToAdd,
        userCustomLinks: returnedLinks,
        processedShareUrls: Object.keys(processedUrls)
      });
    } else {
      res.json({
        success: true,
        message: '更新成功但返回格式异常',
        result: updateResult
      });
    }
    
  } catch (error) {
    console.error('测试添加链接失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 启动批量查找任务
app.post('/api/hdhive/batch-search', requireAuth, async (req, res) => {
  try {
    const { subscriptions } = req.body;
    
    if (!subscriptions || !Array.isArray(subscriptions)) {
      return res.status(400).json({ error: '无效的订阅列表' });
    }
    
    if (batchSearchTask.running) {
      console.log('⚠️  拒绝启动新任务：已有任务正在运行');
      return res.status(400).json({ error: '已有任务正在运行' });
    }
    
    console.log(`\n🚀 启动批量查找任务，共 ${subscriptions.length} 个订阅\n`);
    
    // 生成唯一任务ID
    const taskStartTime = Date.now();
    
    // 更新任务状态（不要重新创建对象）
    batchSearchTask.running = true;
    batchSearchTask.progress = 0;
    batchSearchTask.total = subscriptions.length;
    batchSearchTask.current = null;
    batchSearchTask.currentTaskId = taskStartTime; // 设置当前任务ID
    batchSearchTask.logs = [];
    batchSearchTask.results = {
      success: 0,
      fail: 0,
      totalLinks: 0
    };
    
    // 立即返回，任务在后台运行
    res.json({ success: true, message: '批量查找任务已启动' });
    
    // 后台执行查找任务
    (async () => {
      console.log(`📋 任务ID: ${taskStartTime}`);
      
      // 预先获取所有订阅信息（避免在循环中重复查询）
      const allSubscriptionsData = await getMediaHelperSubscriptions();
      const subscriptionMap = new Map();
      allSubscriptionsData.subscriptions.forEach(s => {
        subscriptionMap.set(s.uuid, s);
      });
      
      for (let i = 0; i < subscriptions.length; i++) {
        // 检查任务是否被停止或被新任务替换
        if (!batchSearchTask.running || batchSearchTask.currentTaskId !== taskStartTime) {
          console.log(`⏹️  任务 ${taskStartTime} 被中断 (${i}/${subscriptions.length})`);
          return; // 直接退出整个异步函数
        }
        
        const sub = subscriptions[i];
        const title = sub.title;
        const tmdbId = sub.id;
        const mediaType = sub.mediaType;
        const subscriptionId = sub.subscriptionId;
        
        batchSearchTask.progress = i + 1;
        batchSearchTask.current = title;
        
        console.log(`[${taskStartTime}] 处理 ${i + 1}/${subscriptions.length}: ${title}`);
        
        const log = {
          time: new Date().toISOString(),
          title: title,
          status: 'searching',
          message: '正在查找...'
        };
        batchSearchTask.logs.unshift(log);
        
        // 获取对应的订阅数据
        const fullSubscription = subscriptionMap.get(subscriptionId);
        try {
          const hdhiveLinks = await getHDHiveFreeLinks(tmdbId, mediaType);
          
          // 检查任务是否在异步操作期间被停止或被新任务替换
          if (!batchSearchTask.running || batchSearchTask.currentTaskId !== taskStartTime) {
            console.log(`⏹️  任务 ${taskStartTime} 在查找后被中断 (${i + 1}/${subscriptions.length})`);
            return; // 直接退出整个异步函数
          }
          
          if (hdhiveLinks && hdhiveLinks.length > 0) {
            // 尝试添加链接到订阅
            if (!fullSubscription) {
              batchSearchTask.results.fail++;
              log.status = 'error';
              log.message = `找到 ${hdhiveLinks.length} 个链接，但订阅不存在`;
            } else {
              try {
                const addResult = await addLinksToSubscription(fullSubscription, hdhiveLinks);
                
                // 检查任务是否在异步操作期间被停止或被新任务替换
                if (!batchSearchTask.running || batchSearchTask.currentTaskId !== taskStartTime) {
                  console.log(`⏹️  任务 ${taskStartTime} 在添加链接后被中断 (${i + 1}/${subscriptions.length})`);
                  return; // 直接退出整个异步函数
                }
              
              if (addResult.added > 0) {
                batchSearchTask.results.success++;
                batchSearchTask.results.totalLinks += addResult.added;
                
                if (addResult.duplicate > 0) {
                  log.status = 'success';
                  log.message = `找到 ${hdhiveLinks.length} 个链接，新增 ${addResult.added} 个，${addResult.duplicate} 个已存在`;
                } else {
                  log.status = 'success';
                  log.message = `找到 ${hdhiveLinks.length} 个链接，已全部添加到订阅`;
                }
              } else if (addResult.duplicate > 0) {
                batchSearchTask.results.fail++;
                log.status = 'warning';
                log.message = `找到 ${hdhiveLinks.length} 个链接，但全部已存在`;
              } else {
                batchSearchTask.results.fail++;
                log.status = 'error';
                log.message = `找到 ${hdhiveLinks.length} 个链接，但添加失败`;
              }
              } catch (addError) {
                batchSearchTask.results.fail++;
                log.status = 'error';
                log.message = `找到 ${hdhiveLinks.length} 个链接，但添加失败: ${addError.message}`;
              }
            }
          } else {
            batchSearchTask.results.fail++;
            log.status = 'error';
            log.message = '未找到免费链接';
          }
        } catch (error) {
          batchSearchTask.results.fail++;
          log.status = 'error';
          log.message = `查找失败: ${error.message}`;
        }
        
        // 限制日志数量
        if (batchSearchTask.logs.length > 100) {
          batchSearchTask.logs.pop();
        }
        
        // 每个查找之间延迟 1 秒
        if (i < subscriptions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // 延迟后再次检查任务是否被停止或被新任务替换
          if (!batchSearchTask.running || batchSearchTask.currentTaskId !== taskStartTime) {
            console.log(`⏹️  任务 ${taskStartTime} 在延迟后被中断 (${i + 1}/${subscriptions.length})`);
            return; // 直接退出整个异步函数
          }
        }
      }
      
      // 任务完成 - 只有当前任务才更新状态
      if (batchSearchTask.currentTaskId === taskStartTime) {
        batchSearchTask.running = false;
        batchSearchTask.current = null;
        batchSearchTask.currentTaskId = null;
        console.log(`✅ 任务 ${taskStartTime} 完成: 成功 ${batchSearchTask.results.success}, 失败 ${batchSearchTask.results.fail}\n`);
        batchSearchTask.logs.unshift({
          time: new Date().toISOString(),
          title: '批量查找完成',
          status: 'success',
          message: `成功: ${batchSearchTask.results.success}, 失败: ${batchSearchTask.results.fail}, 共找到 ${batchSearchTask.results.totalLinks} 个链接`
        });
      }
    })();
    
  } catch (error) {
    console.error('启动批量查找任务失败:', error);
    batchSearchTask.running = false;
    res.status(500).json({ error: '启动任务失败: ' + error.message });
  }
});

// 获取批量查找任务状态
app.get('/api/hdhive/batch-search/status', requireAuth, (req, res) => {
  res.json(batchSearchTask);
});

// 停止批量查找任务
app.post('/api/hdhive/batch-search/stop', requireAuth, (req, res) => {
  try {
    if (!batchSearchTask.running) {
      return res.json({ success: false, error: '没有正在运行的任务' });
    }
    
    const stoppedTaskId = batchSearchTask.currentTaskId;
    
    // 停止任务
    batchSearchTask.running = false;
    batchSearchTask.current = null;
    batchSearchTask.currentTaskId = null; // 清除任务ID
    
    // 添加停止日志
    batchSearchTask.logs.unshift({
      title: '任务已停止',
      message: `已处理 ${batchSearchTask.progress}/${batchSearchTask.total} 个订阅`,
      status: 'warning',
      time: Date.now()
    });
    
    console.log(`\n⏹️  批量查找任务 ${stoppedTaskId} 已手动停止 (${batchSearchTask.progress}/${batchSearchTask.total})\n`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('停止任务失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 发送请求（使用 MediaHelper）
app.post('/api/request', requireAuth, async (req, res) => {
  const { id, title, mediaType, movieData } = req.body;
  
  if (!title || !id || !mediaType) {
    return res.status(400).json({ error: '请提供完整的影片信息' });
  }

  // 检查 MediaHelper 配置
  if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME) {
    return res.status(500).json({ error: 'MediaHelper 未配置，请联系管理员' });
  }

  try {
    console.log(`使用 MediaHelper 创建订阅: ${title}`);
    
    // 如果没有提供完整的 movieData，从 TMDB 获取
    let fullMovieData = movieData;
    if (!fullMovieData || !fullMovieData.overview) {
      const tmdbResponse = await fetchWithProxy(
        `https://api.tmdb.org/3/${mediaType}/${id}?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
      );
      if (tmdbResponse.ok) {
        fullMovieData = await tmdbResponse.json();
        fullMovieData.media_type = mediaType;
      }
    }
    
    // 不再自动查询 HDHive（热门电影电视剧订阅时不使用影巢）
    // 用户可以通过"未完成订阅"的批量查找功能手动添加影巢链接
    let hdhiveLinks = [];
    
    await createMediaHelperSubscription(fullMovieData || {
      id,
      title,
      media_type: mediaType,
      overview: '',
      poster_path: '',
      backdrop_path: '',
      vote_average: 0,
      popularity: 0
    }, hdhiveLinks);
    
    // 清除订阅列表缓存，强制下次刷新
    subscriptionsCache = null;
    subscriptionsCacheExpiry = 0;
    
    // 清除 Emby 库缓存中的这个项目
    const cacheKey = `${mediaType}_${id}`;
    embyLibraryCache.delete(cacheKey);
    
    return res.json({ 
      success: true, 
      message: `已成功订阅《${title}》${hdhiveLinks.length > 0 ? `（包含 ${hdhiveLinks.length} 个免费链接）` : ''}`,
      method: 'mediahelper',
      hdhiveLinksCount: hdhiveLinks.length
    });
  } catch (error) {
    console.error('MediaHelper 订阅失败:', error);
    console.error('错误详情:', error.message);
    console.error('错误堆栈:', error.stack);
    
    // 如果是"已存在订阅"的错误，直接返回成功
    if (error.message && error.message.includes('已存在')) {
      return res.json({ 
        success: true, 
        message: `《${title}》已在订阅列表中`,
        method: 'mediahelper'
      });
    }
    
    return res.status(500).json({ 
      error: '订阅失败: ' + (error.message || '未知错误'),
      details: error.stack
    });
  }
});

// 启动服务器
// 启动服务器
async function startServer() {
  console.log('=== 开始启动服务器 ===');
  
  // 测试 MediaHelper 连接
  if (process.env.MEDIAHELPER_URL && process.env.MEDIAHELPER_USERNAME) {
    console.log('\n📡 测试 MediaHelper 连接...');
    console.log(`   URL: ${process.env.MEDIAHELPER_URL}`);
    
    try {
      // 尝试访问根路径
      const testResponse = await fetch(`${process.env.MEDIAHELPER_URL}/`, {
        method: 'GET',
        timeout: 5000
      }).catch(e => {
        console.error(`   ❌ 无法访问 MediaHelper: ${e.message}`);
        if (e.code === 'ECONNREFUSED') {
          console.error(`   💡 连接被拒绝，请确认 MediaHelper 服务是否运行`);
        } else if (e.code === 'ENOTFOUND') {
          console.error(`   💡 域名解析失败，请检查 URL 是否正确`);
        } else if (e.code === 'ETIMEDOUT') {
          console.error(`   � 连接超时，请检查网络或防火墙设置`);
        }
        return null;
      });
      
      if (testResponse) {
        console.log(`   ✅ MediaHelper 服务可访问 (状态: ${testResponse.status})`);
      } else {
        console.log(`   ⚠️  MediaHelper 服务无法访问，但将继续尝试登录`);
      }
      
      // 尝试登录测试
      console.log('   🔐 测试登录...');
      await getMediaHelperToken();
      console.log('   ✅ MediaHelper 登录成功\n');
    } catch (error) {
      console.error('   ❌ MediaHelper 连接失败:');
      console.error(`      错误: ${error.message}`);
      if (error.code) {
        console.error(`      错误码: ${error.code}`);
      }
      console.error('   💡 故障排查：');
      console.error('      1. 检查 MEDIAHELPER_URL 是否正确');
      console.error('      2. 确认 MediaHelper 服务是否运行');
      console.error('      3. 检查用户名和密码是否正确');
      console.error('      4. 检查网络连接（如果使用 Docker，确保在同一网络）');
      console.error('      5. 确认 API 路径是否为 /api/v1/auth/login\n');
    }
  }
  
  // ==================== 定时任务功能 ====================
  
  // 定时任务状态
  let schedulerState = {
    enabled: false,
    nextRun: null,
    intervalId: null
  };
  
  // 从文件加载定时任务状态
  const SCHEDULER_STATE_FILE = 'scheduler_state.json';
  
  function loadSchedulerState() {
    try {
      if (fs.existsSync(SCHEDULER_STATE_FILE)) {
        const data = fs.readFileSync(SCHEDULER_STATE_FILE, 'utf8');
        const saved = JSON.parse(data);
        schedulerState.enabled = saved.enabled || false;
        schedulerState.nextRun = saved.nextRun || null;
        console.log(`📅 定时任务状态已加载: ${schedulerState.enabled ? '已启用' : '未启用'}`);
      }
    } catch (error) {
      console.error('加载定时任务状态失败:', error);
    }
  }
  
  function saveSchedulerState() {
    try {
      fs.writeFileSync(SCHEDULER_STATE_FILE, JSON.stringify({
        enabled: schedulerState.enabled,
        nextRun: schedulerState.nextRun
      }, null, 2));
    } catch (error) {
      console.error('保存定时任务状态失败:', error);
    }
  }
  
  // 执行批量查找任务
  async function runScheduledBatchSearch() {
    console.log('\n⏰ 定时任务触发：开始批量查找 HDHive 链接...');
    
    try {
      // 获取未完成订阅
      const mhData = await getMediaHelperSubscriptions();
      if (!mhData || !mhData.subscriptions) {
        console.log('   ❌ 无法获取订阅列表');
        return;
      }
      
      const allMediaSubscriptions = mhData.subscriptions.filter(sub => {
        const params = sub.params || {};
        return params.media_type === 'tv' || params.media_type === 'movie';
      });
      
      // 获取未完成的订阅
      const incompleteSubscriptions = [];
      for (const sub of allMediaSubscriptions) {
        const params = sub.params || {};
        const tmdbId = params.tmdb_id;
        const mediaType = params.media_type;
        
        if (!tmdbId) continue;
        
        if (mediaType === 'tv') {
          // 检查电视剧是否完成
          const tmdbData = await getTMDBData(tmdbId, 'tv');
          if (!tmdbData) continue;
          
          const tmdbTotalEpisodes = tmdbData.number_of_episodes || 0;
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Series&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );
          
          let embyEpisodeCount = 0;
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            const items = embyData.Items || [];
            if (items.length > 0) {
              const seriesId = items[0].Id;
              const episodesResponse = await fetch(
                `${process.env.EMBY_URL}/Shows/${seriesId}/Episodes?api_key=${process.env.EMBY_API_KEY}`
              );
              if (episodesResponse.ok) {
                const episodesData = await episodesResponse.json();
                embyEpisodeCount = episodesData.Items?.length || 0;
              }
            }
          }
          
          if (embyEpisodeCount < tmdbTotalEpisodes) {
            incompleteSubscriptions.push(sub);
          }
        } else if (mediaType === 'movie') {
          // 检查电影是否入库
          const embyResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
          );
          
          if (embyResponse.ok) {
            const embyData = await embyResponse.json();
            const hasMovie = (embyData.Items || []).length > 0;
            if (!hasMovie) {
              incompleteSubscriptions.push(sub);
            }
          }
        }
      }
      
      console.log(`   📊 找到 ${incompleteSubscriptions.length} 个未完成订阅`);
      
      if (incompleteSubscriptions.length === 0) {
        console.log('   ✅ 没有未完成的订阅，任务结束');
        return;
      }
      
      // 执行批量查找
      let successCount = 0;
      let failCount = 0;
      let totalLinks = 0;
      
      for (let i = 0; i < incompleteSubscriptions.length; i++) {
        const sub = incompleteSubscriptions[i];
        const params = sub.params || {};
        const title = params.title || params.custom_name || sub.name;
        
        console.log(`\n   [${i + 1}/${incompleteSubscriptions.length}] 查找: ${title}`);
        
        try {
          const links = await getHDHiveFreeLinks(params.tmdb_id, params.media_type);
          
          if (links && links.length > 0) {
            console.log(`   ✓ 找到 ${links.length} 个链接`);
            const result = await addLinksToSubscription(sub, links);
            
            if (result.added > 0) {
              successCount++;
              totalLinks += result.added;
              console.log(`   ✓ 成功添加 ${result.added} 个新链接`);
            } else if (result.duplicate === links.length) {
              console.log(`   - 全部链接已存在`);
            }
          } else {
            console.log(`   - 未找到免费链接`);
          }
        } catch (error) {
          failCount++;
          console.error(`   ✗ 查找失败: ${error.message}`);
        }
        
        // 延迟 2 秒
        if (i < incompleteSubscriptions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log(`\n✅ 定时任务完成: ${successCount} 个成功, ${failCount} 个失败, 共添加 ${totalLinks} 个链接\n`);
      
    } catch (error) {
      console.error('定时任务执行失败:', error);
    }
  }
  
  // 启动定时任务
  function startScheduler() {
    if (schedulerState.intervalId) {
      clearInterval(schedulerState.intervalId);
    }
    
    // 每 7 天 = 7 * 24 * 60 * 60 * 1000 毫秒
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    
    // 设置下次运行时间
    schedulerState.nextRun = Date.now() + SEVEN_DAYS;
    
    // 启动定时器
    schedulerState.intervalId = setInterval(() => {
      runScheduledBatchSearch();
      schedulerState.nextRun = Date.now() + SEVEN_DAYS;
      saveSchedulerState();
    }, SEVEN_DAYS);
    
    saveSchedulerState();
    console.log(`📅 定时任务已启动，下次运行: ${new Date(schedulerState.nextRun).toLocaleString('zh-CN')}`);
  }
  
  function stopScheduler() {
    if (schedulerState.intervalId) {
      clearInterval(schedulerState.intervalId);
      schedulerState.intervalId = null;
    }
    schedulerState.nextRun = null;
    saveSchedulerState();
    console.log('📅 定时任务已停止');
  }
  
  // 定时任务 API
  app.get('/api/scheduler/status', (req, res) => {
    res.json({
      enabled: schedulerState.enabled,
      nextRun: schedulerState.nextRun
    });
  });
  
  app.post('/api/scheduler/toggle', (req, res) => {
    try {
      const { enabled } = req.body;
      
      schedulerState.enabled = enabled;
      
      if (enabled) {
        startScheduler();
      } else {
        stopScheduler();
      }
      
      res.json({ success: true, enabled: schedulerState.enabled });
    } catch (error) {
      console.error('切换定时任务失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 加载定时任务状态并启动
  loadSchedulerState();
  if (schedulerState.enabled) {
    startScheduler();
  }
  
  // ==================== 启动服务器 ====================
  
  app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  });
}

console.log('=== 脚本开始执行 ===');
startServer();

 
 
