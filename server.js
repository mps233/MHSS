require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// 已请求影片的存储文件
const REQUESTED_FILE = path.join(__dirname, 'requested-movies.json');

// 读取已请求的影片列表
function getRequestedMovies() {
  try {
    if (fs.existsSync(REQUESTED_FILE)) {
      const data = fs.readFileSync(REQUESTED_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('读取已请求列表错误:', error);
  }
  return [];
}

// 获取今日请求数量
function getTodayRequestCount() {
  const requested = getRequestedMovies();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return requested.filter(item => {
    const requestDate = new Date(item.requestedAt).toISOString().split('T')[0];
    return requestDate === today;
  }).length;
}

// 保存已请求的影片列表
function saveRequestedMovies(movies) {
  try {
    fs.writeFileSync(REQUESTED_FILE, JSON.stringify(movies, null, 2), 'utf8');
  } catch (error) {
    console.error('保存已请求列表错误:', error);
  }
}

// 添加到已请求列表
function addRequestedMovie(id, title, mediaType) {
  const requested = getRequestedMovies();
  const key = `${mediaType}_${id}`;
  if (!requested.some(item => item.key === key)) {
    requested.push({
      key,
      id,
      title,
      mediaType,
      requestedAt: new Date().toISOString()
    });
    saveRequestedMovies(requested);
  }
}

// 检查是否已请求
function isMovieRequested(id, mediaType) {
  const requested = getRequestedMovies();
  const key = `${mediaType}_${id}`;
  return requested.some(item => item.key === key);
}

// Telegram Client 配置
const apiId = parseInt(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const stringSession = new StringSession(process.env.TG_SESSION || '');

let client = null;

// 初始化 Telegram Client
async function initTelegramClient() {
  console.log('开始初始化 Telegram 客户端...');
  console.log('API ID:', apiId);
  console.log('Session 长度:', stringSession.save().length);
  
  try {
    client = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 5,
    });

    console.log('正在连接 Telegram...');
    
    await client.start({
      phoneNumber: async () => {
        console.log('需要手机号');
        return process.env.TG_PHONE_NUMBER;
      },
      password: async () => {
        console.log('需要密码');
        return await input.text('请输入两步验证密码（如果有）: ');
      },
      phoneCode: async () => {
        console.log('需要验证码');
        return await input.text('请输入 Telegram 发送的验证码: ');
      },
      onError: (err) => {
        console.log('Telegram 错误:', err);
      },
    });

    console.log('✅ Telegram 客户端已连接');
    const session = client.session.save();
    if (session !== process.env.TG_SESSION) {
      console.log('新的 Session String:', session);
      console.log('请将上面的 Session String 保存到 .env 文件的 TG_SESSION 变量中');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Telegram 客户端连接失败:', error);
    return false;
  }
}

// 搜索 TMDB
app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ error: '请输入搜索关键词' });
  }

  try {
    const response = await fetch(
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
        requested: isMovieRequested(item.id, item.media_type)
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
app.get('/api/trending/movies', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/trending/movie/week?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
    );
    const data = await response.json();
    
    const results = data.results.slice(0, 12).map(item => ({
      id: item.id,
      title: item.title,
      year: (item.release_date || '').split('-')[0],
      rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      requested: isMovieRequested(item.id, 'movie')
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
app.get('/api/trending/tv', async (req, res) => {
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/trending/tv/week?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
    );
    const data = await response.json();
    
    const results = data.results.slice(0, 12).map(item => ({
      id: item.id,
      title: item.name,
      year: (item.first_air_date || '').split('-')[0],
      rating: item.vote_average ? item.vote_average.toFixed(1) : 'N/A',
      poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null,
      requested: isMovieRequested(item.id, 'tv')
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
  const todayCount = getTodayRequestCount();
  
  if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
    return res.json({ 
      total: null, 
      embyUrl: null,
      todayRequests: todayCount
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
      todayRequests: todayCount
    });
  } catch (error) {
    console.error('获取 Emby 统计错误:', error);
    res.json({ 
      total: null, 
      embyUrl: null,
      todayRequests: todayCount
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
    const requested = getRequestedMovies();
    
    // 按时间倒序排序，最新的在前面
    const sortedRequests = requested.sort((a, b) => {
      return new Date(b.requestedAt) - new Date(a.requestedAt);
    });
    
    // 获取每个请求的海报信息，增加到30条
    const requestsWithPosters = await Promise.all(
      sortedRequests.slice(0, 30).map(async (item) => {
        try {
          const response = await fetch(
            `https://api.themoviedb.org/3/${item.mediaType}/${item.id}?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
          );
          const data = await response.json();
          
          return {
            ...item,
            poster: data.poster_path ? `https://image.tmdb.org/t/p/w200${data.poster_path}` : null
          };
        } catch (error) {
          return item;
        }
      })
    );
    
    res.json({ requests: requestsWithPosters });
  } catch (error) {
    console.error('获取最近请求错误:', error);
    res.json({ requests: [] });
  }
});

// 发送请求到 Telegram 群组（使用用户账号）
app.post('/api/request', async (req, res) => {
  const { id, title, mediaType } = req.body;
  
  if (!title || !id || !mediaType) {
    return res.status(400).json({ error: '请提供完整的影片信息' });
  }

  if (!client || !client.connected) {
    return res.status(500).json({ error: 'Telegram 客户端未连接，请重启服务器' });
  }

  try {
    const message = `/s ${title}`;
    
    // 发送消息
    await client.sendMessage(process.env.TG_GROUP_ID, { message });
    console.log(`已发送消息: ${message}`);
    
    // 等待机器人回复（带按钮的消息）
    await new Promise(resolve => setTimeout(resolve, 5000)); // 等待5秒
    
    // 获取最近的消息
    const messages = await client.getMessages(process.env.TG_GROUP_ID, { limit: 5 });
    
    // 查找带按钮的消息
    for (const msg of messages) {
      // 检查消息内容是否包含错误信息
      if (msg.message && (msg.message.includes('❌') || msg.message.includes('搜索失败') || msg.message.includes('未找到'))) {
        console.log('机器人返回错误:', msg.message);
        return res.status(400).json({ 
          error: '搜索失败，请检查影片名称是否正确' 
        });
      }
      
      if (msg.replyMarkup && msg.replyMarkup.rows && msg.replyMarkup.rows.length > 0) {
        const firstButton = msg.replyMarkup.rows[0].buttons[0];
        
        if (firstButton) {
          console.log(`找到按钮: ${firstButton.text}`);
          
          try {
            // 点击第一个按钮
            await msg.click(0); // 点击第一行第一个按钮
            console.log('已自动点击确认按钮');
            
            // 添加到已请求列表
            addRequestedMovie(id, title, mediaType);
            
            return res.json({ 
              success: true, 
              message: `请求已发送并确认订阅《${title}》` 
            });
          } catch (clickError) {
            console.error('点击按钮失败:', clickError);
            return res.status(400).json({ 
              error: '订阅失败，按钮无效' 
            });
          }
        }
      }
    }
    
    // 如果没找到按钮，返回错误
    return res.status(400).json({ 
      error: '未找到可订阅的内容，请检查影片名称' 
    });
    
  } catch (error) {
    console.error('Telegram 发送错误:', error);
    res.status(500).json({ error: '发送失败: ' + error.message });
  }
});

// 启动服务器
async function startServer() {
  console.log('=== 开始启动服务器 ===');
  
  // 先启动 HTTP 服务器
  app.listen(PORT, () => {
    console.log(`\n🚀 服务器运行在 http://localhost:${PORT}`);
  });

  // 然后在后台初始化 Telegram 客户端
  console.log('正在后台连接 Telegram...');
  initTelegramClient().then(connected => {
    if (!connected) {
      console.error('⚠️  Telegram 客户端连接失败，但服务器继续运行');
    }
  }).catch(err => {
    console.error('⚠️  Telegram 初始化错误:', err.message);
  });
}

console.log('=== 脚本开始执行 ===');
startServer();
