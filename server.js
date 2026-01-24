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

// 创建带代理的 fetch 函数
function fetchWithProxy(url, options = {}) {
  if (proxyAgent && url.startsWith('https://api.themoviedb.org')) {
    return fetch(url, { ...options, agent: proxyAgent });
  }
  return fetch(url, options);
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

// 获取 MediaHelper 默认配置
async function getMediaHelperDefaults() {
  // 如果已经缓存了，直接返回
  if (mediaHelperDefaults) {
    return mediaHelperDefaults;
  }

  const token = await getMediaHelperToken();
  
  try {
    const response = await fetch(`${process.env.MEDIAHELPER_URL}/api/v1/subscription/config/cloud-defaults`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error('获取默认配置失败');
    }

    const data = await response.json();
    console.log('MediaHelper 默认配置:', JSON.stringify(data, null, 2));
    
    // 缓存默认配置
    mediaHelperDefaults = data.data || data;
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
      throw new Error(`MediaHelper 登录失败: ${errorText}`);
    }

    const data = await response.json();
    console.log('MediaHelper 登录响应:', JSON.stringify(data, null, 2));
    
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

// 获取 MediaHelper 订阅列表
async function getMediaHelperSubscriptions() {
  try {
    const token = await getMediaHelperToken();
    
    const response = await fetch(`${process.env.MEDIAHELPER_URL}/api/v1/subscription/list`, {
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
    console.log('MediaHelper 订阅列表:', JSON.stringify(data, null, 2));
    
    // 返回订阅列表
    return data.data || data;
  } catch (error) {
    console.error('获取 MediaHelper 订阅列表失败:', error);
    return [];
  }
}
async function createMediaHelperSubscription(movieData) {
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
    cron: process.env.MEDIAHELPER_CRON || defaults.cron || '0 19,21,23 * * *',
    cloud_type: process.env.MEDIAHELPER_CLOUD_TYPE || defaults.cloud_type || 'drive115',
    custom_name: title,
    selected_seasons: [],
    user_custom_links: []
  };

  // 使用默认配置中的值
  if (defaults.default_account_id) {
    subscriptionData.account_identifier = defaults.default_account_id;
  }
  
  if (defaults.account_configs && defaults.default_account_id) {
    const accountConfig = defaults.account_configs[defaults.default_account_id];
    if (accountConfig && accountConfig.default_directory) {
      subscriptionData.target_directory = accountConfig.default_directory;
    }
  }
  
  // 环境变量优先级更高
  if (process.env.MEDIAHELPER_TARGET_DIRECTORY) {
    subscriptionData.target_directory = process.env.MEDIAHELPER_TARGET_DIRECTORY;
  }
  
  if (process.env.MEDIAHELPER_ACCOUNT_IDENTIFIER) {
    subscriptionData.account_identifier = process.env.MEDIAHELPER_ACCOUNT_IDENTIFIER;
  }

  console.log('创建订阅请求:', {
    url: `${process.env.MEDIAHELPER_URL}/api/v1/subscription/create`,
    token: token.substring(0, 20) + '...',
    data: subscriptionData
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
    saveSessions();
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

app.use(express.static('public'));

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

    // 保存session到文件
    saveSessions();

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
    saveSessions(); // 保存到文件
  }
  res.clearCookie('token');
  res.json({ success: true });
});

// 验证token
app.get('/api/verify', requireAuth, (req, res) => {
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
      `https://api.themoviedb.org/3/search/multi?api_key=${process.env.TMDB_API_KEY}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`
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
        requested: false, // 不再检查本地请求状态
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

    // 检查 Emby 库中是否已有这些影片
    if (process.env.EMBY_URL && process.env.EMBY_API_KEY) {
      try {
        for (let item of results) {
          const itemType = item.mediaType === 'movie' ? 'Movie' : 'Series';
          const searchResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&searchTerm=${encodeURIComponent(item.title)}&IncludeItemTypes=${itemType}&Recursive=true`
          );
          const searchData = await searchResponse.json();
          item.inLibrary = searchData.Items && searchData.Items.length > 0;
        }
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
    const response = await fetchWithProxy(
      `https://api.themoviedb.org/3/trending/movie/week?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
    );
    const data = await response.json();
    
    const results = data.results.slice(0, 12).map(item => ({
      id: item.id,
      title: item.title,
      year: (item.release_date || '').split('-')[0],
      rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      requested: false // 不再检查本地请求状态
    }));

    // 检查 Emby 库中是否已有这些电影
    if (process.env.EMBY_URL && process.env.EMBY_API_KEY) {
      try {
        for (let movie of results) {
          const searchResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&searchTerm=${encodeURIComponent(movie.title)}&IncludeItemTypes=Movie&Recursive=true`
          );
          const searchData = await searchResponse.json();
          movie.inLibrary = searchData.Items && searchData.Items.length > 0;
        }
      } catch (error) {
        console.error('检查 Emby 库错误:', error);
      }
    }

    res.json({ results });
  } catch (error) {
    console.error('获取热门电影错误:', error);
    res.status(500).json({ error: '获取失败' });
  }
});

// 获取热门电视剧
app.get('/api/trending/tv', requireAuth, async (req, res) => {
  try {
    const response = await fetchWithProxy(
      `https://api.themoviedb.org/3/trending/tv/week?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
    );
    const data = await response.json();
    
    const results = data.results.slice(0, 12).map(item => ({
      id: item.id,
      title: item.name,
      year: (item.first_air_date || '').split('-')[0],
      rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      requested: false // 不再检查本地请求状态
    }));

    // 检查 Emby 库中是否已有这些电视剧
    if (process.env.EMBY_URL && process.env.EMBY_API_KEY) {
      try {
        for (let show of results) {
          const searchResponse = await fetch(
            `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&searchTerm=${encodeURIComponent(show.title)}&IncludeItemTypes=Series&Recursive=true`
          );
          const searchData = await searchResponse.json();
          show.inLibrary = searchData.Items && searchData.Items.length > 0;
        }
      } catch (error) {
        console.error('检查 Emby 库错误:', error);
      }
    }

    res.json({ results });
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
    console.error('获取 Emby 统计错误:', error);
    res.json({ 
      total: null, 
      embyUrl: null,
      todayRequests: todayRequests
    });
  }
});

// 检查 TMDB 状态
app.get('/api/tmdb/status', requireAuth, async (req, res) => {
  try {
    const startTime = Date.now();
    const response = await fetchWithProxy(
      `https://api.themoviedb.org/3/configuration?api_key=${process.env.TMDB_API_KEY}`
    );
    const ping = Date.now() - startTime;
    const online = response.ok;
    
    res.json({ 
      online,
      ping
    });
  } catch (error) {
    console.error('检查 TMDB 状态错误:', error);
    res.json({ 
      online: false,
      ping: 0
    });
  }
});

// 获取 Emby 入库趋势（最近7天）
app.get('/api/emby/trends', async (req, res) => {
  if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
    return res.json({ 
      movies: [],
      tv: []
    });
  }

  try {
    const movieData = [];
    const tvData = [];
    
    // 获取最近7天的数据
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      // 获取该天添加的电影
      const movieResponse = await fetch(
        `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Movie&Recursive=true&Fields=DateCreated&MinDateCreated=${date.toISOString()}&MaxDateCreated=${nextDate.toISOString()}`
      );
      const movieResult = await movieResponse.json();
      movieData.push(movieResult.TotalRecordCount || 0);
      
      // 获取该天添加的电视剧
      const tvResponse = await fetch(
        `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Series&Recursive=true&Fields=DateCreated&MinDateCreated=${date.toISOString()}&MaxDateCreated=${nextDate.toISOString()}`
      );
      const tvResult = await tvResponse.json();
      tvData.push(tvResult.TotalRecordCount || 0);
    }
    
    res.json({ 
      movies: movieData,
      tv: tvData
    });
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
    console.log('MediaHelper 订阅数据:', JSON.stringify(data, null, 2));
    
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
      
      console.log('转换后的订阅数据:', JSON.stringify(requestsWithPosters.slice(0, 3), null, 2));
      return res.json({ requests: requestsWithPosters });
    }
    
    res.json({ requests: [] });
  } catch (error) {
    console.error('获取最近请求错误:', error);
    res.json({ requests: [] });
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
        `https://api.themoviedb.org/3/${mediaType}/${id}?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
      );
      if (tmdbResponse.ok) {
        fullMovieData = await tmdbResponse.json();
        fullMovieData.media_type = mediaType;
      }
    }
    
    await createMediaHelperSubscription(fullMovieData || {
      id,
      title,
      media_type: mediaType,
      overview: '',
      poster_path: '',
      backdrop_path: '',
      vote_average: 0,
      popularity: 0
    });
    
    return res.json({ 
      success: true, 
      message: `已成功订阅《${title}》`,
      method: 'mediahelper'
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
  
  app.listen(PORT, () => {
    console.log(`\n🚀 服务器运行在 http://localhost:${PORT}`);
  });
}

console.log('=== 脚本开始执行 ===');
startServer();

 
 
