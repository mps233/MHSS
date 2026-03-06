require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const { HttpsProxyAgent } = require('https-proxy-agent');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const stateManager = require('./state-manager');

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

// 创建带代理和重试的 fetch 函数
async function fetchWithProxy(url, options = {}, retries = 3) {
  const timeout = options.timeout || 10000; // 默认10秒超时
  
  for (let i = 0; i < retries; i++) {
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const fetchOptions = {
        ...options,
        signal: controller.signal
      };
      
      if (proxyAgent && url.startsWith('https://api.tmdb.org')) {
        fetchOptions.agent = proxyAgent;
      }
      
      const response = await fetch(url, fetchOptions);
      clearTimeout(timeoutId);
      
      return response;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      
      // 如果是最后一次重试，抛出错误
      if (i === retries - 1) {
        throw error;
      }
      
      // 否则等待后重试
      const delay = Math.min(1000 * Math.pow(2, i), 5000); // 指数退避，最多5秒
      console.log(`   ⚠️  请求失败，${delay}ms 后重试 (${i + 1}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// HDHive 服务进程（已弃用，现在使用 curl-cffi 客户端）
// let hdhiveService = null;
// let hdhiveServiceReady = false;
// let hdhiveServiceStarting = false;
// let hdhiveServiceIdleTimer = null;
// const HDHIVE_SERVICE_IDLE_TIMEOUT = 5 * 60 * 1000;

// 以下函数已弃用（使用 curl-cffi 客户端后不再需要）
/*
// 重置空闲计时器
function resetHDHiveServiceIdleTimer() {
  if (hdhiveServiceIdleTimer) {
    clearTimeout(hdhiveServiceIdleTimer);
  }
  
  hdhiveServiceIdleTimer = setTimeout(async () => {
    console.log('⏱️  HDHive 服务空闲超过 5 分钟，自动关闭...');
    await stopHDHiveService();
  }, HDHIVE_SERVICE_IDLE_TIMEOUT);
}

async function startHDHiveService() {
  // ... (已弃用)
}

async function stopHDHiveService() {
  // ... (已弃用)
}
*/

// HDHive 客户端（Node.js 版本）
const HDHiveClient = require('./hdhive-client');
let hdhiveClient = null;

// 获取或创建 HDHive 客户端实例
function getHDHiveClient() {
  if (!hdhiveClient && HDHIVE_USERNAME && HDHIVE_PASSWORD) {
    hdhiveClient = new HDHiveClient(HDHIVE_USERNAME, HDHIVE_PASSWORD);
  }
  return hdhiveClient;
}

// 查询 HDHive 可用 115 链接（使用 Node.js 客户端）
async function getHDHiveFreeLinks(tmdbId, mediaType, subscription = null) {
  if (!HDHIVE_ENABLED) {
    return [];
  }
  
  // 检查是否配置了账号密码
  if (!HDHIVE_USERNAME || !HDHIVE_PASSWORD) {
    return [];
  }
  
  try {
    console.log(`\n🔍 HDHive: 开始查询 tmdb_id=${tmdbId} type=${mediaType}`);
    
    const type = mediaType === 'movie' ? 'movie' : 'tv';
    const client = getHDHiveClient();
    
    // 获取积分解锁设置
    const autoUnlockSettings = stateManager.getState('autoUnlock') || {
      enabled: false,
      maxPointsPerShow: 10,
      onlyUnlockIfNoResources: false
    };
    
    // 判断是否需要检查集数
    let hasEpisodes = false;
    if (subscription && autoUnlockSettings.onlyUnlockIfNoResources) {
      // 检查订阅是否有集数
      if (subscription.episodes && Array.isArray(subscription.episodes) && subscription.episodes.length > 0) {
        const episodeData = subscription.episodes[0];
        
        // 检查是否有实际的集数数据
        if (episodeData.episodes_arr && Object.keys(episodeData.episodes_arr).length > 0) {
          hasEpisodes = true;
          const episodeCount = Object.values(episodeData.episodes_arr).reduce((sum, arr) => sum + arr.length, 0);
          console.log(`  ℹ️  订阅已有集数（${episodeCount} 集），跳过积分解锁`);
        } else {
          // episodes_arr 为空，检查是否有自定义链接
          const hasCustomLinks = subscription.user_custom_links && 
                                 Array.isArray(subscription.user_custom_links) && 
                                 subscription.user_custom_links.length > 0;
          
          if (hasCustomLinks) {
            hasEpisodes = true;
            console.log(`  ℹ️  订阅已有 ${subscription.user_custom_links.length} 个自定义链接，跳过积分解锁`);
          } else {
            console.log(`  ℹ️  订阅 episodes_arr 为空且无自定义链接，启用积分解锁`);
          }
        }
      } else {
        // 没有 episodes 数据，检查是否有自定义链接
        const hasCustomLinks = subscription.user_custom_links && 
                               Array.isArray(subscription.user_custom_links) && 
                               subscription.user_custom_links.length > 0;
        
        if (hasCustomLinks) {
          hasEpisodes = true;
          console.log(`  ℹ️  订阅无 episodes 数据但有 ${subscription.user_custom_links.length} 个自定义链接，跳过积分解锁`);
        } else {
          console.log(`  ℹ️  订阅无 episodes 数据且无自定义链接，启用积分解锁`);
        }
      }
    }
    
    // 决定是否使用积分解锁
    const usePoints = autoUnlockSettings.enabled && !hasEpisodes;
    
    let links;
    if (usePoints) {
      // 使用智能搜索（支持积分解锁）
      console.log(`  💰 启用积分解锁（最大 ${autoUnlockSettings.maxPointsPerShow} 积分）`);
      links = await client.searchFromTmdbWithUnlock(tmdbId.toString(), type, {
        usePoints: true,
        maxPoints: autoUnlockSettings.maxPointsPerShow
      });
    } else {
      // 只查找免费资源
      links = await client.searchFromTmdb(tmdbId.toString(), type);
    }
    
    console.log(`🎉 HDHive: 查询完成，找到 ${links.length} 个链接\n`);
    return links;
    
  } catch (error) {
    console.error(`❌ HDHive: 查询失败: ${error.message}\n`);
    return [];
  }
}

app.use(express.json());
app.use(cookieParser());

// Session管理
function loadSessions() {
  const state = stateManager.getState('sessions');
  if (state && typeof state === 'object') {
    // 将对象转换为 Map，兼容旧格式
    if (Array.isArray(state)) {
      return new Map(state);
    } else {
      return new Map(Object.entries(state));
    }
  }
  return new Map();
}

function saveSessions() {
  const sessionsArray = Array.from(sessions.entries());
  const sessionsObj = Object.fromEntries(sessionsArray);
  stateManager.setState('sessions', sessionsObj);
}

const sessions = loadSessions(); // 存储用户session

// 用户请求限制
const USER_REQUEST_LIMIT = 3; // 默认每个用户最多3次请求
const userRequestCounts = new Map(); // userId -> count
const userCustomLimits = new Map(); // userId -> customLimit (自定义限制)

// 加载用户数据
function loadUserData() {
  const userData = stateManager.getState('userData');
  if (userData) {
    // 加载自定义限制
    if (userData.limits) {
      Object.entries(userData.limits).forEach(([userId, limit]) => {
        userCustomLimits.set(userId, limit);
      });
      console.log(`📋 已加载 ${userCustomLimits.size} 个用户的自定义限制`);
    }
    
    // 加载请求计数
    if (userData.counts) {
      Object.entries(userData.counts).forEach(([userId, count]) => {
        userRequestCounts.set(userId, count);
      });
      console.log(`📊 已加载 ${userRequestCounts.size} 个用户的请求计数`);
    }
  }
}

// 保存用户数据
function saveUserData() {
  const userData = {
    limits: {},
    counts: {}
  };
  
  userCustomLimits.forEach((limit, userId) => {
    userData.limits[userId] = limit;
  });
  
  userRequestCounts.forEach((count, userId) => {
    userData.counts[userId] = count;
  });
  
  stateManager.setState('userData', userData);
}

// 防抖保存
let saveUserDataTimer = null;
function saveUserDataDebounced() {
  if (saveUserDataTimer) {
    clearTimeout(saveUserDataTimer);
  }
  saveUserDataTimer = setTimeout(() => {
    saveUserData();
  }, 1000);
}

// 启动时加载用户数据
loadUserData();

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

// 新订阅自动查找设置
let autoSearchNewEnabled = false;

// 自动删除已完成订阅设置
let autoDeleteCompletedMovieEnabled = false;
let autoDeleteCompletedTVEnabled = false;
let autoDeleteCompletedInterval = null;

// 新订阅自动查找日志
let autoSearchNewLogs = [];
const MAX_AUTO_SEARCH_LOGS = 100;

// 监控任务状态管理
const monitoringTasks = new Map(); // key: uuid, value: { title, checkCount, maxChecks, nextCheckTime, status }

// 已知的订阅列表（用于检测新订阅）
let knownSubscriptions = new Set();
let newSubscriptionCheckInterval = null;
let nextNewSubscriptionCheckTime = null; // 下次检测时间
let hasNewSubscriptionFlag = false; // 标记是否有新订阅

// 添加自动查找日志
function addAutoSearchLog(title, info, type = 'info') {
  const log = {
    title,
    info,
    type,
    timestamp: new Date().toISOString()
  };
  autoSearchNewLogs.unshift(log);
  
  // 限制日志数量
  if (autoSearchNewLogs.length > MAX_AUTO_SEARCH_LOGS) {
    autoSearchNewLogs = autoSearchNewLogs.slice(0, MAX_AUTO_SEARCH_LOGS);
  }
}

// 检测新订阅并自动查找
async function checkForNewSubscriptions() {
  if (!autoSearchNewEnabled || !HDHIVE_ENABLED) {
    return;
  }
  
  try {
    // 获取所有订阅（强制刷新缓存以检测新订阅）
    const mhData = await getMediaHelperSubscriptions(true);
    if (!mhData || !mhData.subscriptions) {
      return;
    }
    
    const allSubscriptions = mhData.subscriptions.filter(sub => {
      const params = sub.params || {};
      return params.media_type === 'tv' || params.media_type === 'movie';
    });
    
    let hasNewSubscription = false;
    
    // 检测新订阅
    for (const sub of allSubscriptions) {
      const subId = sub.uuid;
      
      // 如果是新订阅
      if (!knownSubscriptions.has(subId)) {
        knownSubscriptions.add(subId);
        hasNewSubscription = true;
        
        const params = sub.params || {};
        const title = params.title || params.custom_name || sub.name;
        const mediaType = params.media_type;
        const tmdbId = params.tmdb_id;
        
        console.log(`🆕 检测到新订阅: ${title} (${mediaType})`);
        addAutoSearchLog(
          `检测到新订阅`,
          `${title} (${mediaType})，开始监控执行状态`,
          'info'
        );
        
        // 启动监控任务
        monitorSubscriptionAndSearch(sub, title, mediaType, tmdbId);
      }
    }
    
    // 如果有新订阅，清除缓存
    if (hasNewSubscription) {
      console.log('🔄 检测到新订阅，清除订阅列表缓存');
      incompleteSubscriptionsPageCache = {};
      allSubscriptionsCache = null;
      allSubscriptionsCacheExpiry = 0;
      hasNewSubscriptionFlag = true; // 设置标记
    }
  } catch (error) {
    console.error('检测新订阅失败:', error);
  }
}

// 监控订阅并查找资源
async function monitorSubscriptionAndSearch(subscription, title, mediaType, tmdbId) {
  const uuid = subscription.uuid;
  
  // 添加到监控任务列表
  monitoringTasks.set(uuid, {
    title,
    checkCount: 0,
    maxChecks: 60,
    nextCheckTime: Date.now() + 60000,
    status: 'monitoring'
  });
  
  try {
    // 轮询检查订阅状态，最多检查60次（每次间隔1分钟，总共60分钟）
    let checkCount = 0;
    const maxChecks = 60;
    const checkInterval = 60000; // 1分钟
    
    const checkSubscriptionStatus = async () => {
      checkCount++;
      
      // 更新任务状态
      const task = monitoringTasks.get(uuid);
      if (task) {
        task.checkCount = checkCount;
        task.nextCheckTime = Date.now() + checkInterval;
      }
      
      // 重新获取订阅信息
      const mhData = await getMediaHelperSubscriptions();
      if (!mhData || !mhData.subscriptions) {
        return false;
      }
      
      const sub = mhData.subscriptions.find(s => s.uuid === subscription.uuid);
      if (!sub) {
        console.log(`   ❌ 订阅已被删除: ${title}`);
        addAutoSearchLog(
          `新订阅监控 - ${title}`,
          `订阅已被删除，停止监控`,
          'warning'
        );
        monitoringTasks.delete(uuid);
        return true;
      }
      
      const executionStatus = sub.execution_status;
      console.log(`   [${checkCount}/${maxChecks}] ${title} 执行状态: ${executionStatus || '未知'}`);
      
      if (executionStatus === 'success') {
        console.log(`   ✅ ${title} MediaHelper 执行成功`);
        
        addAutoSearchLog(
          `新订阅监控 - ${title}`,
          `MediaHelper 执行成功，检查资源状态`,
          'success'
        );
        
        // 检查是否需要查找
        let needSearch = false;
        
        if (mediaType === 'tv' && sub.episodes && Array.isArray(sub.episodes) && sub.episodes.length > 0) {
          const episodeData = sub.episodes[0];
          let subscribedEpisodes = 0;
          let tmdbTotalEpisodes = 0;
          
          if (episodeData.episodes_arr) {
            Object.values(episodeData.episodes_arr).forEach(seasonEpisodes => {
              subscribedEpisodes += seasonEpisodes.length;
            });
          }
          
          if (episodeData.episodes_count) {
            Object.values(episodeData.episodes_count).forEach(seasonData => {
              if (seasonData.count) {
                tmdbTotalEpisodes += seasonData.count;
              }
            });
          }
          
          needSearch = subscribedEpisodes < tmdbTotalEpisodes;
          console.log(`   📊 电视剧状态: ${subscribedEpisodes}/${tmdbTotalEpisodes} 集，${needSearch ? '需要查找' : '已完成'}`);
          addAutoSearchLog(
            `新订阅监控 - ${title}`,
            `电视剧状态: ${subscribedEpisodes}/${tmdbTotalEpisodes} 集，${needSearch ? '缺集，开始查找' : '已完成'}`,
            needSearch ? 'info' : 'success'
          );
        } else if (mediaType === 'movie') {
          // 电影：检查 episodes 数组是否有实际的集数数据
          const hasEpisodes = sub.episodes && Array.isArray(sub.episodes) && sub.episodes.length > 0;
          let hasValidEpisodes = false;
          
          if (hasEpisodes) {
            const episodeData = sub.episodes[0];
            // 检查是否有实际的集数数据
            if (episodeData.episodes_arr && Object.keys(episodeData.episodes_arr).length > 0) {
              hasValidEpisodes = true;
            }
          }
          
          needSearch = !hasValidEpisodes;
          console.log(`   📊 电影状态: ${needSearch ? '未入库，需要查找' : '已入库'}`);
          addAutoSearchLog(
            `新订阅监控 - ${title}`,
            `电影状态: ${needSearch ? '未入库，开始查找' : '已入库'}`,
            needSearch ? 'info' : 'success'
          );
        }
        
        if (needSearch) {
          console.log(`   🔍 开始查找影巢资源...`);
          const links = await getHDHiveFreeLinks(tmdbId, mediaType, sub);
          
          if (links && links.length > 0) {
            console.log(`   ✓ 找到 ${links.length} 个可用链接`);
            addAutoSearchLog(
              `新订阅监控 - ${title}`,
              `找到 ${links.length} 个可用链接（免费/已解锁）`,
              'success'
            );
            
            const result = await addLinksToSubscription(sub, links);
            
            if (result.added > 0) {
              addAutoSearchLog(
                `新订阅监控 - ${title}`,
                `成功添加 ${result.added} 个新链接`,
                'success'
              );
            } else if (result.duplicate === links.length) {
              addAutoSearchLog(
                `新订阅监控 - ${title}`,
                `全部链接已存在`,
                'info'
              );
            }
          } else {
            addAutoSearchLog(
              `新订阅监控 - ${title}`,
              `未找到可用链接`,
              'warning'
            );
          }
        }
        
        monitoringTasks.delete(uuid);
        return true;
      } else if (executionStatus === 'failed') {
        addAutoSearchLog(
          `新订阅监控 - ${title}`,
          `MediaHelper 执行失败，停止监控`,
          'error'
        );
        monitoringTasks.delete(uuid);
        return true;
      } else {
        if (checkCount % 5 === 0) {
          addAutoSearchLog(
            `新订阅监控 - ${title}`,
            `[${checkCount}/${maxChecks}] 等待执行完成 (状态: ${executionStatus || '未知'})`,
            'info'
          );
        }
        return false;
      }
    };
    
    // 开始轮询
    while (checkCount < maxChecks) {
      const completed = await checkSubscriptionStatus();
      if (completed) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    if (checkCount >= maxChecks) {
      addAutoSearchLog(
        `新订阅监控 - ${title}`,
        `已达到最大检查次数（60分钟），停止监控`,
        'warning'
      );
      monitoringTasks.delete(uuid);
    }
  } catch (error) {
    console.error(`监控订阅失败:`, error);
    addAutoSearchLog(
      `新订阅监控 - ${title}`,
      `监控失败: ${error.message}`,
      'error'
    );
    monitoringTasks.delete(uuid);
  }
}

// 启动新订阅检测
function startNewSubscriptionCheck() {
  if (newSubscriptionCheckInterval) {
    clearInterval(newSubscriptionCheckInterval);
  }
  
  // 初始化已知订阅列表
  getMediaHelperSubscriptions().then(mhData => {
    if (mhData && mhData.subscriptions) {
      mhData.subscriptions.forEach(sub => {
        knownSubscriptions.add(sub.uuid);
      });
      console.log(`📋 已加载 ${knownSubscriptions.size} 个已知订阅`);
    }
  }).catch(err => {
    console.error('初始化订阅列表失败:', err);
  });
  
  // 设置下次检测时间
  nextNewSubscriptionCheckTime = Date.now() + 60 * 1000;
  
  // 每1分钟检查一次新订阅
  newSubscriptionCheckInterval = setInterval(() => {
    checkForNewSubscriptions();
    // 更新下次检测时间
    nextNewSubscriptionCheckTime = Date.now() + 60 * 1000;
  }, 60 * 1000);
  console.log('🔍 新订阅检测已启动（每1分钟检查一次）');
}

// 停止新订阅检测
function stopNewSubscriptionCheck() {
  if (newSubscriptionCheckInterval) {
    clearInterval(newSubscriptionCheckInterval);
    newSubscriptionCheckInterval = null;
  }
  console.log('🔍 新订阅检测已停止');
}

// 删除已完成的电影订阅
async function deleteCompletedMovieSubscriptions() {
  if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME) {
    return;
  }
  
  if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
    return;
  }
  
  try {
    console.log('\n🗑️  开始检查并删除已完成的电影订阅...');
    
    // 获取所有订阅
    const mhData = await getMediaHelperSubscriptions(true); // 强制刷新
    if (!mhData || !mhData.subscriptions) {
      return;
    }
    
    // 筛选出电影订阅
    const movieSubscriptions = mhData.subscriptions.filter(sub => {
      const params = sub.params || {};
      return params.media_type === 'movie';
    });
    
    console.log(`   📊 共有 ${movieSubscriptions.length} 个电影订阅`);
    
    let deletedCount = 0;
    const token = await getMediaHelperToken();
    
    for (const sub of movieSubscriptions) {
      const params = sub.params || {};
      const tmdbId = params.tmdb_id;
      const title = params.title || params.custom_name || sub.name;
      
      if (!tmdbId) continue;
      
      // 检查是否已入库
      try {
        const embyResponse = await fetch(
          `${process.env.EMBY_URL}/Items?api_key=${process.env.EMBY_API_KEY}&IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds&AnyProviderIdEquals=tmdb.${tmdbId}`
        );
        
        if (!embyResponse.ok) continue;
        
        const embyData = await embyResponse.json();
        const hasMovie = embyData.Items && embyData.Items.length > 0;
        
        if (hasMovie) {
          console.log(`   ✅ 电影已入库，删除订阅: ${title}`);
          
          // 调用 MediaHelper API 删除订阅
          const deleteResponse = await fetch(
            `${process.env.MEDIAHELPER_URL}/api/v1/subscription/${sub.uuid}`,
            {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
              }
            }
          );
          
          if (deleteResponse.ok) {
            console.log(`   🗑️  删除成功: ${title}`);
            deletedCount++;
            
            // 清除缓存
            const cacheKey = `movie_${tmdbId}`;
            embyLibraryCache.delete(cacheKey);
          } else {
            const errorText = await deleteResponse.text();
            console.error(`   ❌ 删除失败: ${title}, 错误: ${errorText}`);
          }
          
          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`   ❌ 检查电影失败: ${title}, 错误: ${error.message}`);
      }
    }
    
    console.log(`\n🎉 删除完成，共删除 ${deletedCount} 个已完成的电影订阅\n`);
    
    // 清除订阅缓存
    if (deletedCount > 0) {
      subscriptionsCache = null;
      subscriptionsCacheExpiry = 0;
      incompleteSubscriptionsPageCache = {};
      allSubscriptionsCache = null;
      allSubscriptionsCacheExpiry = 0;
    }
  } catch (error) {
    console.error('删除已完成电影订阅失败:', error);
  }
}

// 删除已完成的电视剧订阅
async function deleteCompletedTVSubscriptions() {
  if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME) {
    return;
  }
  
  try {
    console.log('\n🗑️  开始检查并删除已完成的电视剧订阅...');
    
    // 获取所有订阅
    const mhData = await getMediaHelperSubscriptions(true); // 强制刷新
    if (!mhData || !mhData.subscriptions) {
      return;
    }
    
    // 筛选出电视剧订阅
    const tvSubscriptions = mhData.subscriptions.filter(sub => {
      const params = sub.params || {};
      return params.media_type === 'tv';
    });
    
    console.log(`   📊 共有 ${tvSubscriptions.length} 个电视剧订阅`);
    
    let deletedCount = 0;
    const token = await getMediaHelperToken();
    
    for (const sub of tvSubscriptions) {
      const params = sub.params || {};
      const tmdbId = params.tmdb_id;
      const title = params.title || params.custom_name || sub.name;
      
      if (!tmdbId) continue;
      
      // 从 MediaHelper 的 episodes 数据中获取集数信息
      let subscribedEpisodes = 0;
      let tmdbTotalEpisodes = 0;
      
      if (sub.episodes && Array.isArray(sub.episodes) && sub.episodes.length > 0) {
        const episodeData = sub.episodes[0];
        
        // 获取已订阅的集数
        if (episodeData.episodes_arr) {
          Object.values(episodeData.episodes_arr).forEach(seasonEpisodes => {
            subscribedEpisodes += seasonEpisodes.length;
          });
        }
        
        // 获取总集数
        if (episodeData.episodes_count) {
          Object.values(episodeData.episodes_count).forEach(seasonData => {
            if (seasonData.count) {
              tmdbTotalEpisodes += seasonData.count;
            }
          });
        }
      }
      
      // 如果已订阅所有集数，删除订阅
      if (tmdbTotalEpisodes > 0 && subscribedEpisodes >= tmdbTotalEpisodes) {
        console.log(`   ✅ 电视剧已完成 (${subscribedEpisodes}/${tmdbTotalEpisodes} 集)，删除订阅: ${title}`);
        
        try {
          // 调用 MediaHelper API 删除订阅
          const deleteResponse = await fetch(
            `${process.env.MEDIAHELPER_URL}/api/v1/subscription/${sub.uuid}`,
            {
              method: 'DELETE',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json'
              }
            }
          );
          
          if (deleteResponse.ok) {
            console.log(`   🗑️  删除成功: ${title}`);
            deletedCount++;
            
            // 清除缓存
            const cacheKey = `tv_${tmdbId}`;
            embyLibraryCache.delete(cacheKey);
          } else {
            const errorText = await deleteResponse.text();
            console.error(`   ❌ 删除失败: ${title}, 错误: ${errorText}`);
          }
          
          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          console.error(`   ❌ 删除订阅失败: ${title}, 错误: ${error.message}`);
        }
      }
    }
    
    console.log(`\n🎉 删除完成，共删除 ${deletedCount} 个已完成的电视剧订阅\n`);
    
    // 清除订阅缓存
    if (deletedCount > 0) {
      subscriptionsCache = null;
      subscriptionsCacheExpiry = 0;
      incompleteSubscriptionsPageCache = {};
      allSubscriptionsCache = null;
      allSubscriptionsCacheExpiry = 0;
    }
  } catch (error) {
    console.error('删除已完成电视剧订阅失败:', error);
  }
}

// 启动自动删除已完成订阅的定时任务
function startAutoDeleteCompleted() {
  if (autoDeleteCompletedInterval) {
    clearInterval(autoDeleteCompletedInterval);
  }
  
  // 每天凌晨3点执行
  const scheduleDaily = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(3, 0, 0, 0);
    
    // 如果今天3点已过，设置为明天3点
    if (now >= next) {
      next.setDate(next.getDate() + 1);
    }
    
    const delay = next.getTime() - now.getTime();
    console.log(`🗑️  自动删除已完成订阅已启动，下次运行: ${next.toLocaleString('zh-CN')}`);
    
    setTimeout(async () => {
      // 根据开关状态决定删除哪些
      if (autoDeleteCompletedMovieEnabled) {
        await deleteCompletedMovieSubscriptions();
      }
      if (autoDeleteCompletedTVEnabled) {
        await deleteCompletedTVSubscriptions();
      }
      // 执行后重新调度下一次
      scheduleDaily();
    }, delay);
  };
  
  scheduleDaily();
}

// 停止自动删除已完成订阅的定时任务
function stopAutoDeleteCompleted() {
  if (autoDeleteCompletedInterval) {
    clearTimeout(autoDeleteCompletedInterval);
    autoDeleteCompletedInterval = null;
  }
  console.log('🗑️  自动删除已完成订阅已停止');
}

// 加载新订阅自动查找设置
function loadAutoSearchNewSetting() {
  const saved = stateManager.getState('autoSearchNew');
  if (saved) {
    autoSearchNewEnabled = saved.enabled || false;
    autoDeleteCompletedMovieEnabled = saved.autoDeleteCompletedMovie || false;
    autoDeleteCompletedTVEnabled = saved.autoDeleteCompletedTV || false;
    console.log(`📋 新订阅自动查找设置已加载: ${autoSearchNewEnabled ? '已启用' : '未启用'}`);
    console.log(`📋 自动删除已完成电影设置已加载: ${autoDeleteCompletedMovieEnabled ? '已启用' : '未启用'}`);
    console.log(`📋 自动删除已完成电视剧设置已加载: ${autoDeleteCompletedTVEnabled ? '已启用' : '未启用'}`);
    
    // 如果启用，启动检测
    if (autoSearchNewEnabled && HDHIVE_ENABLED) {
      startNewSubscriptionCheck();
    }
    
    // 如果启用，启动自动删除定时任务
    if (autoDeleteCompletedMovieEnabled || autoDeleteCompletedTVEnabled) {
      startAutoDeleteCompleted();
    }
  }
}

function saveAutoSearchNewSetting() {
  stateManager.setState('autoSearchNew', {
    enabled: autoSearchNewEnabled,
    autoDeleteCompletedMovie: autoDeleteCompletedMovieEnabled,
    autoDeleteCompletedTV: autoDeleteCompletedTVEnabled
  });
  
  // 根据状态启动或停止检测
  if (autoSearchNewEnabled && HDHIVE_ENABLED) {
    startNewSubscriptionCheck();
  } else {
    stopNewSubscriptionCheck();
  }
  
  // 根据状态启动或停止自动删除
  if (autoDeleteCompletedMovieEnabled || autoDeleteCompletedTVEnabled) {
    startAutoDeleteCompleted();
  } else {
    stopAutoDeleteCompleted();
  }
}

// 启动时加载设置
loadAutoSearchNewSetting();

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
    user_custom_links: hdhiveLinks  // HDHive 可用 115 链接（免费 + 已解锁）
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
  
  if (!token) {
    console.log('❌ requireAuth: 未提供 token');
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  
  if (!sessions.has(token)) {
    console.log(`❌ requireAuth: token 无效或已过期 (sessions size: ${sessions.size})`);
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  
  const session = sessions.get(token);
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    console.log('❌ requireAuth: session 已过期');
    return res.status(401).json({ error: '登录已过期' });
  }
  
  req.user = session.user;
  next();
}

// 请求限制中间件
function checkRequestLimit(req, res, next) {
  const userId = req.user.id;
  
  // 管理员不受限制
  if (req.user.isAdmin) {
    return next();
  }
  
  const currentCount = userRequestCounts.get(userId) || 0;
  const userLimit = userCustomLimits.get(userId) || USER_REQUEST_LIMIT; // 使用自定义限制或默认限制
  
  if (currentCount >= userLimit) {
    return res.status(429).json({ 
      error: '已达到请求限制',
      message: `您已达到${userLimit}次请求限制，请联系管理员重置`,
      limit: userLimit,
      current: currentCount
    });
  }
  
  // 增加请求计数
  userRequestCounts.set(userId, currentCount + 1);
  saveUserDataDebounced(); // 保存到文件
  
  next();
}
// 管理员权限中间件
function requireAdmin(req, res, next) {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: '需要管理员权限' });
  }
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
    
    console.log('Emby 用户数据:', {
      userId: data.User.Id,
      userName: data.User.Name,
      isAdmin: data.User.Policy?.IsAdministrator || false
    });
    
    // 生成session token
    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7天
    
    sessions.set(token, {
      user: {
        id: data.User.Id,
        name: data.User.Name,
        isAdmin: data.User.Policy?.IsAdministrator || false
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
        name: data.User.Name,
        isAdmin: data.User.Policy?.IsAdministrator || false
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

// 获取所有用户请求统计（管理员）
app.get('/api/admin/user-requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    // 获取所有Emby用户
    const response = await fetch(
      `${process.env.EMBY_URL}/Users?api_key=${process.env.EMBY_API_KEY}`
    );
    const users = await response.json();
    
    // 构建用户请求统计
    const stats = users.map(user => {
      const isAdmin = user.Policy?.IsAdministrator || false;
      const userLimit = userCustomLimits.get(user.Id) || USER_REQUEST_LIMIT;
      const requestCount = userRequestCounts.get(user.Id) || 0;
      return {
        id: user.Id,
        name: user.Name,
        isAdmin: isAdmin,
        requestCount: requestCount,
        limit: userLimit,
        customLimit: userCustomLimits.get(user.Id) || null, // 自定义限制（null表示使用默认值）
        remaining: Math.max(0, userLimit - requestCount)
      };
    });
    
    res.json({ success: true, users: stats, defaultLimit: USER_REQUEST_LIMIT });
  } catch (error) {
    console.error('获取用户请求统计失败:', error);
    res.status(500).json({ error: '获取统计失败' });
  }
});
// 重置用户请求计数（管理员）
app.post('/api/admin/reset-user-requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (userId) {
      // 重置指定用户
      userRequestCounts.delete(userId);
      saveUserDataDebounced(); // 保存到文件
      res.json({ success: true, message: '已重置该用户的请求计数' });
    } else {
      // 重置所有用户
      userRequestCounts.clear();
      saveUserDataDebounced(); // 保存到文件
      res.json({ success: true, message: '已重置所有用户的请求计数' });
    }
  } catch (error) {
    console.error('重置请求计数失败:', error);
    res.status(500).json({ error: '重置失败' });
  }
});

// 设置用户自定义请求限制（管理员）
app.post('/api/admin/set-user-limit', requireAuth, requireAdmin, async (req, res) => {
  try {
    console.log('收到设置用户限制请求:', req.body);
    const { userId, limit } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: '缺少用户ID' });
    }
    
    if (limit === null || limit === undefined) {
      // 删除自定义限制，使用默认值
      userCustomLimits.delete(userId);
      saveUserLimitsDebounced(); // 保存到文件
      console.log(`已恢复用户 ${userId} 为默认限制`);
      res.json({ success: true, message: '已恢复为默认限制' });
    } else {
      // 设置自定义限制
      const limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum < 0) {
        return res.status(400).json({ error: '限制值必须是非负整数' });
      }
      userCustomLimits.set(userId, limitNum);
      saveUserDataDebounced(); // 保存到文件
      console.log(`已设置用户 ${userId} 限制为 ${limitNum} 次`);
      res.json({ success: true, message: `已设置限制为 ${limitNum} 次` });
    }
  } catch (error) {
    console.error('设置用户限制失败:', error);
    res.status(500).json({ error: '设置失败' });
  }
});

// 获取当前用户请求统计
app.get('/api/user/request-stats', requireAuth, async (req, res) => {
  const userId = req.user.id;
  const currentCount = userRequestCounts.get(userId) || 0;
  const userLimit = userCustomLimits.get(userId) || USER_REQUEST_LIMIT; // 使用自定义限制或默认限制
  
  res.json({
    success: true,
    isAdmin: req.user.isAdmin || false,
    requestCount: currentCount,
    limit: userLimit,
    remaining: Math.max(0, userLimit - currentCount)
  });
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
app.get('/api/search', requireAuth, checkRequestLimit, async (req, res) => {
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
      const requestsPromises = data.subscriptions.slice(0, 30).map(async sub => {
        const info = sub.subscription_info || {};
        const params = sub.params || {};
        
        const tmdbId = info.tmdb_id || params.tmdb_id;
        const mediaType = info.media_type || params.media_type;
        
        // 统一从 TMDB 获取图片，不依赖 MediaHelper
        let posterUrl = null;
        if (tmdbId && mediaType) {
          posterUrl = await getTMDBPosterUrl(tmdbId, mediaType, 'w200');
        }
        
        // 如果 TMDB 获取失败，尝试使用 MediaHelper 提供的路径作为降级
        if (!posterUrl) {
          posterUrl = info.poster_path || params.poster_path || null;
          if (posterUrl) {
            if (posterUrl.startsWith('/api/v1/proxy/')) {
              posterUrl = `${process.env.MEDIAHELPER_URL}${posterUrl}`;
            } else if (!posterUrl.startsWith('http')) {
              posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
            }
          }
        }
        
        // 处理时间 - MediaHelper 返回的时间是 UTC 时间但没有 Z 后缀
        let requestedAt = sub.created_at || sub.updated_at;
        if (requestedAt && !requestedAt.endsWith('Z')) {
          // MediaHelper 返回的时间格式: "2026-01-24T05:35:45.153747"
          // 这是 UTC 时间，添加 Z 后缀让前端正确解析
          requestedAt = requestedAt + 'Z';
        }
        
        return {
          id: tmdbId,
          title: info.title || params.title || params.custom_name || sub.name,
          mediaType: mediaType,
          requestedAt: requestedAt,
          poster: posterUrl
        };
      });
      
      const requestsWithPosters = await Promise.all(requestsPromises);
      
      // console.log('转换后的订阅数据:', JSON.stringify(requestsWithPosters.slice(0, 3), null, 2));
      return res.json({ requests: requestsWithPosters });
    }
    
    res.json({ requests: [] });
  } catch (error) {
    console.error('获取最近请求错误:', error);
    res.json({ requests: [] });
  }
});

// 从 TMDB 获取海报 URL
async function getTMDBPosterUrl(tmdbId, mediaType, size = 'w200') {
  if (!tmdbId || !mediaType) return null;
  
  try {
    const response = await fetchWithProxy(
      `https://api.tmdb.org/3/${mediaType}/${tmdbId}?api_key=${process.env.TMDB_API_KEY}&language=zh-CN`
    );
    
    if (response.ok) {
      const data = await response.json();
      if (data.poster_path) {
        return `https://image.tmdb.org/t/p/${size}${data.poster_path}`;
      }
    }
  } catch (error) {
    console.error(`获取 TMDB 图片失败 (${mediaType}/${tmdbId}):`, error.message);
  }
  
  return null;
}

// 未完成订阅缓存（按页缓存集数信息）
let incompleteSubscriptionsPageCache = {}; // { 'page_perPage': { subscriptions: [...], checkedAt: timestamp } }
let allSubscriptionsCache = null; // 所有订阅列表（未检查完成状态）
let allSubscriptionsCacheExpiry = 0;
const INCOMPLETE_CACHE_TTL = 10 * 60 * 1000; // 10分钟缓存

// 获取未完成的订阅（按需检查，分页返回）
app.get('/api/incomplete-subscriptions', requireAuth, async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const page = parseInt(req.query.page) || 1;
    const perPage = parseInt(req.query.per_page) || 14;
    const onlyCount = req.query.only_count === 'true';
    
    console.log(`📥 API 请求: page=${page}, perPage=${perPage}, onlyCount=${onlyCount}, refresh=${forceRefresh}`);
    
    // 强制刷新时清除所有缓存
    if (forceRefresh) {
      incompleteSubscriptionsPageCache = {};
      allSubscriptionsCache = null;
      allSubscriptionsCacheExpiry = 0;
    }
    
    if (!process.env.MEDIAHELPER_URL || !process.env.MEDIAHELPER_USERNAME) {
      return res.json({ subscriptions: [], total: 0 });
    }

    if (!process.env.EMBY_URL || !process.env.EMBY_API_KEY) {
      return res.json({ subscriptions: [], total: 0 });
    }

    // 1. 获取所有订阅列表（只获取列表，不检查完成状态）
    if (!allSubscriptionsCache || Date.now() >= allSubscriptionsCacheExpiry) {
      console.log('🔄 获取 MediaHelper 订阅列表...');
      const data = await getMediaHelperSubscriptions();
      if (!data || !data.subscriptions || data.subscriptions.length === 0) {
        return res.json({ subscriptions: [], total: 0 });
      }

      // 筛选出电影和电视剧
      allSubscriptionsCache = data.subscriptions.filter(sub => {
        const params = sub.params || {};
        return params.media_type === 'tv' || params.media_type === 'movie';
      });
      allSubscriptionsCacheExpiry = Date.now() + INCOMPLETE_CACHE_TTL;
      
      console.log(`📊 共有 ${allSubscriptionsCache.length} 个订阅（电影+电视剧）`);
    }
    
    const totalSubscriptions = allSubscriptionsCache.length;
    
    // 如果只要总数，直接返回
    if (onlyCount) {
      return res.json({ 
        total: totalSubscriptions,
        subscriptions: []
      });
    }
    
    // 2. 检查该页是否有缓存
    const cacheKey = `${page}_${perPage}`;
    const cachedPage = incompleteSubscriptionsPageCache[cacheKey];
    
    if (cachedPage && Date.now() < cachedPage.checkedAt + INCOMPLETE_CACHE_TTL) {
      console.log(`📦 返回第 ${page} 页的缓存数据`);
      return res.json({
        subscriptions: cachedPage.subscriptions,
        total: totalSubscriptions,
        page,
        perPage,
        totalPages: Math.ceil(totalSubscriptions / perPage)
      });
    }
    
    // 3. 计算该页的订阅
    const startIndex = (page - 1) * perPage;
    const endIndex = Math.min(startIndex + perPage, totalSubscriptions);
    const pageSubscriptions = allSubscriptionsCache.slice(startIndex, endIndex);
    
    console.log(`\n� 检查第 ${page} 页的 ${pageSubscriptions.length} 个订阅的集数信息...`);
    
    // 4. 格式化该页订阅数据（使用 MediaHelper 提供的集数信息）
    const formattedSubscriptionsPromises = pageSubscriptions.map(async sub => {
      const params = sub.params || {};
      const info = sub.subscription_info || {};
      const mediaType = params.media_type;
      const tmdbId = params.tmdb_id;
      
      // 统一从 TMDB 获取图片，不依赖 MediaHelper
      let posterUrl = null;
      if (tmdbId && mediaType) {
        posterUrl = await getTMDBPosterUrl(tmdbId, mediaType, 'w200');
      }
      
      // 如果 TMDB 获取失败，尝试使用 MediaHelper 提供的路径作为降级
      if (!posterUrl) {
        posterUrl = info.poster_path || params.poster_path || null;
        if (posterUrl) {
          if (posterUrl.startsWith('/api/v1/proxy/')) {
            posterUrl = `${process.env.MEDIAHELPER_URL}${posterUrl}`;
          } else if (!posterUrl.startsWith('http')) {
            posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
          }
        }
      }
      
      // 从 MediaHelper 的 episodes 数据中获取集数信息
      let subscribedEpisodes = 0;
      let tmdbTotalEpisodes = 0;
      let status = 'unknown';
      let statusText = '订阅中';
      
      if (mediaType === 'tv' && sub.episodes && Array.isArray(sub.episodes) && sub.episodes.length > 0) {
        const episodeData = sub.episodes[0];
        
        // 获取已订阅的集数（episodes_arr 中的集数）
        if (episodeData.episodes_arr) {
          Object.values(episodeData.episodes_arr).forEach(seasonEpisodes => {
            subscribedEpisodes += seasonEpisodes.length;
          });
        }
        
        // 获取总集数（episodes_count 中的 count）
        if (episodeData.episodes_count) {
          Object.values(episodeData.episodes_count).forEach(seasonData => {
            if (seasonData.count) {
              tmdbTotalEpisodes += seasonData.count;
            }
          });
        }
        
        // 判断状态
        const missingCount = tmdbTotalEpisodes - subscribedEpisodes;
        if (missingCount > 0) {
          status = 'incomplete';
          statusText = `缺 ${missingCount} 集`;
        } else if (subscribedEpisodes > 0) {
          status = 'complete';
          statusText = '已完成';
        }
      } else if (mediaType === 'movie') {
        // 电影：检查 episodes 数组是否有数据
        if (sub.episodes && Array.isArray(sub.episodes) && sub.episodes.length > 0) {
          // episodes 有数据，说明已入库
          const episodeData = sub.episodes[0];
          if (episodeData.episodes_arr && Object.keys(episodeData.episodes_arr).length > 0) {
            tmdbTotalEpisodes = 1;
            subscribedEpisodes = 1;
            status = 'complete';
            statusText = '已完成';
          } else {
            // episodes 数组存在但没有实际数据
            tmdbTotalEpisodes = 1;
            subscribedEpisodes = 0;
            status = 'pending';
            statusText = '等待资源';
          }
        } else {
          // episodes 数组为空，说明未入库
          tmdbTotalEpisodes = 1;
          subscribedEpisodes = 0;
          status = 'pending';
          statusText = '等待资源';
        }
      }
      
      const missingEpisodes = Math.max(0, tmdbTotalEpisodes - subscribedEpisodes);
      const progress = tmdbTotalEpisodes > 0 ? Math.round((subscribedEpisodes / tmdbTotalEpisodes) * 100) : 0;
      
      // 提取年份和评分
      const releaseDate = params.release_date || '';
      const year = releaseDate ? releaseDate.split('-')[0] : '';
      const voteAverage = params.vote_average;
      const rating = (voteAverage !== null && voteAverage !== undefined && voteAverage > 0) 
        ? voteAverage.toFixed(1) 
        : '0.0';
      
      return {
        id: params.tmdb_id,
        title: params.title || params.custom_name || sub.name,
        poster: posterUrl,
        mediaType: mediaType,
        status: status,
        statusText: statusText,
        subscribedEpisodes: subscribedEpisodes,
        tmdbTotalEpisodes: tmdbTotalEpisodes,
        missingEpisodes: missingEpisodes,
        progress: progress,
        tmdbStatus: mediaType === 'movie' ? 'Movie' : 'Unknown',
        subscriptionId: sub.uuid,
        createdAt: sub.created_at,
        year: year,
        rating: rating
      };
    });
    
    const formattedSubscriptions = await Promise.all(formattedSubscriptionsPromises);
    
    console.log(`✅ 第 ${page} 页格式化完成，共 ${formattedSubscriptions.length} 个订阅\n`);
    
    // 5. 按创建时间排序（最新的排前面）
    formattedSubscriptions.sort((a, b) => {
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB - dateA;
    });
    
    // 6. 缓存该页数据
    incompleteSubscriptionsPageCache[cacheKey] = {
      subscriptions: formattedSubscriptions,
      checkedAt: Date.now()
    };
    
    // 7. 返回该页数据
    const totalPages = Math.ceil(totalSubscriptions / perPage);
    
    res.json({
      subscriptions: formattedSubscriptions,
      total: totalSubscriptions,
      page,
      perPage,
      totalPages
    });
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
            
            // 统一从 TMDB 获取图片
            let posterUrl = await getTMDBPosterUrl(tmdbId, 'tv', 'w200');
            
            // 如果 TMDB 获取失败，使用 MediaHelper 提供的路径作为降级
            if (!posterUrl) {
              posterUrl = info.poster_path || params.poster_path || null;
              if (posterUrl) {
                if (posterUrl.startsWith('/api/v1/proxy/')) {
                  posterUrl = `${process.env.MEDIAHELPER_URL}${posterUrl}`;
                } else if (!posterUrl.startsWith('http')) {
                  posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
                }
              }
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
            
            // 统一从 TMDB 获取图片
            let posterUrl = await getTMDBPosterUrl(tmdbId, 'movie', 'w200');
            
            // 如果 TMDB 获取失败，使用 MediaHelper 提供的路径作为降级
            if (!posterUrl) {
              posterUrl = info.poster_path || params.poster_path || null;
              if (posterUrl) {
                if (posterUrl.startsWith('/api/v1/proxy/')) {
                  posterUrl = `${process.env.MEDIAHELPER_URL}${posterUrl}`;
                } else if (!posterUrl.startsWith('http')) {
                  posterUrl = `https://image.tmdb.org/t/p/w200${posterUrl}`;
                }
              }
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
    
    // 预先获取所有订阅信息，筛选出未完成的
    const allSubscriptionsData = await getMediaHelperSubscriptions();
    const subscriptionMap = new Map();
    allSubscriptionsData.subscriptions.forEach(s => {
      subscriptionMap.set(s.uuid, s);
    });
    
    // 筛选未完成的订阅
    const incompleteSubscriptions = [];
    const skippedSubscriptions = [];
    
    for (const sub of subscriptions) {
      const fullSub = subscriptionMap.get(sub.subscriptionId);
      if (!fullSub) {
        incompleteSubscriptions.push(sub);
        continue;
      }
      
      const mediaType = sub.mediaType;
      
      if (mediaType === 'tv' && fullSub.episodes && Array.isArray(fullSub.episodes) && fullSub.episodes.length > 0) {
        const episodeData = fullSub.episodes[0];
        
        // 获取已订阅的集数
        let subscribedEpisodes = 0;
        if (episodeData.episodes_arr) {
          Object.values(episodeData.episodes_arr).forEach(seasonEpisodes => {
            subscribedEpisodes += seasonEpisodes.length;
          });
        }
        
        // 获取总集数
        let tmdbTotalEpisodes = 0;
        if (episodeData.episodes_count) {
          Object.values(episodeData.episodes_count).forEach(seasonData => {
            if (seasonData.count) {
              tmdbTotalEpisodes += seasonData.count;
            }
          });
        }
        
        // 判断是否完成
        if (subscribedEpisodes < tmdbTotalEpisodes) {
          incompleteSubscriptions.push(sub);
        } else {
          skippedSubscriptions.push({ ...sub, reason: `已完成 (${subscribedEpisodes}/${tmdbTotalEpisodes} 集)` });
        }
      } else if (mediaType === 'movie') {
        // 电影：检查 episodes 数组是否为空
        if (!fullSub.episodes || fullSub.episodes.length === 0) {
          // episodes 为空，说明未入库
          incompleteSubscriptions.push(sub);
        } else {
          // episodes 有数据，说明已入库
          skippedSubscriptions.push({ ...sub, reason: '已入库' });
        }
      } else {
        // 其他情况也加入查找列表
        incompleteSubscriptions.push(sub);
      }
    }
    
    console.log(`   📊 筛选结果: ${incompleteSubscriptions.length} 个未完成，${skippedSubscriptions.length} 个已跳过`);
    
    // 更新任务状态（不要重新创建对象）
    batchSearchTask.running = true;
    batchSearchTask.progress = 0;
    batchSearchTask.total = incompleteSubscriptions.length;
    batchSearchTask.current = null;
    batchSearchTask.currentTaskId = taskStartTime; // 设置当前任务ID
    batchSearchTask.logs = [];
    batchSearchTask.results = {
      success: 0,
      fail: 0,
      totalLinks: 0,
      skipped: skippedSubscriptions.length
    };
    
    // 不添加跳过的日志到列表中，只在结果统计中显示
    // 这样可以避免日志列表被大量"已跳过"的项目占据
    
    // 立即返回，任务在后台运行
    res.json({ 
      success: true, 
      message: '批量查找任务已启动',
      total: incompleteSubscriptions.length,
      skipped: skippedSubscriptions.length
    });
    
    // 后台执行查找任务
    (async () => {
      console.log(`📋 任务ID: ${taskStartTime}`);
      
      for (let i = 0; i < incompleteSubscriptions.length; i++) {
        // 检查任务是否被停止或被新任务替换
        if (!batchSearchTask.running || batchSearchTask.currentTaskId !== taskStartTime) {
          console.log(`⏹️  任务 ${taskStartTime} 被中断 (${i}/${incompleteSubscriptions.length})`);
          return; // 直接退出整个异步函数
        }
        
        const sub = incompleteSubscriptions[i];
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
          const hdhiveLinks = await getHDHiveFreeLinks(tmdbId, mediaType, fullSubscription);
          
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
            log.message = '未找到可用链接';
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
        
        // 不立即关闭服务，让空闲超时机制处理
        // 这样可以避免影响其他正在进行的查询（如新订阅监控）
        console.log('ℹ️  HDHive 服务将在空闲 5 分钟后自动关闭');
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

// 新订阅自动查找 API
app.get('/api/settings/auto-search-new', requireAuth, (req, res) => {
  res.json({ 
    enabled: autoSearchNewEnabled,
    autoDeleteCompletedMovie: autoDeleteCompletedMovieEnabled,
    autoDeleteCompletedTV: autoDeleteCompletedTVEnabled
  });
});

app.post('/api/settings/auto-search-new', requireAuth, (req, res) => {
  try {
    const { enabled, autoDeleteCompletedMovie, autoDeleteCompletedTV } = req.body;
    
    if (enabled !== undefined) {
      autoSearchNewEnabled = enabled;
    }
    
    if (autoDeleteCompletedMovie !== undefined) {
      autoDeleteCompletedMovieEnabled = autoDeleteCompletedMovie;
    }
    
    if (autoDeleteCompletedTV !== undefined) {
      autoDeleteCompletedTVEnabled = autoDeleteCompletedTV;
    }
    
    saveAutoSearchNewSetting();
    res.json({ 
      success: true, 
      enabled: autoSearchNewEnabled,
      autoDeleteCompletedMovie: autoDeleteCompletedMovieEnabled,
      autoDeleteCompletedTV: autoDeleteCompletedTVEnabled
    });
  } catch (error) {
    console.error('切换新订阅自动查找失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取新订阅自动查找日志
app.get('/api/settings/auto-search-new/logs', requireAuth, (req, res) => {
  res.json({ logs: autoSearchNewLogs });
});

// 手动触发删除已完成电影订阅
app.post('/api/settings/auto-delete-completed/trigger', requireAuth, async (req, res) => {
  try {
    console.log('🗑️  手动触发删除已完成电影订阅...');
    
    // 异步执行，立即返回
    deleteCompletedMovieSubscriptions().catch(err => {
      console.error('删除已完成电影订阅失败:', err);
    });
    
    res.json({ success: true, message: '删除任务已启动' });
  } catch (error) {
    console.error('触发删除失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手动触发删除已完成电视剧订阅
app.post('/api/settings/auto-delete-completed-tv/trigger', requireAuth, async (req, res) => {
  try {
    console.log('🗑️  手动触发删除已完成电视剧订阅...');
    
    // 异步执行，立即返回
    deleteCompletedTVSubscriptions().catch(err => {
      console.error('删除已完成电视剧订阅失败:', err);
    });
    
    res.json({ success: true, message: '删除任务已启动' });
  } catch (error) {
    console.error('触发删除失败:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取监控任务状态
app.get('/api/settings/auto-search-new/status', requireAuth, (req, res) => {
  const tasks = Array.from(monitoringTasks.values()).map(task => ({
    title: task.title,
    checkCount: task.checkCount,
    maxChecks: task.maxChecks,
    nextCheckTime: task.nextCheckTime,
    status: task.status,
    remainingSeconds: task.nextCheckTime ? Math.max(0, Math.floor((task.nextCheckTime - Date.now()) / 1000)) : 0
  }));
  
  // 计算下次新订阅检测的剩余时间
  const nextCheckRemainingSeconds = nextNewSubscriptionCheckTime 
    ? Math.max(0, Math.floor((nextNewSubscriptionCheckTime - Date.now()) / 1000))
    : null;
  
  res.json({ 
    tasks,
    nextSubscriptionCheck: {
      enabled: autoSearchNewEnabled,
      nextCheckTime: nextNewSubscriptionCheckTime,
      remainingSeconds: nextCheckRemainingSeconds
    }
  });
});

// 检查是否有新订阅
app.get('/api/settings/auto-search-new/has-new', requireAuth, (req, res) => {
  const hasNew = hasNewSubscriptionFlag;
  if (hasNew) {
    hasNewSubscriptionFlag = false; // 重置标记
  }
  res.json({ hasNew });
});

// 发送请求（使用 MediaHelper）
app.post('/api/request', requireAuth, checkRequestLimit, async (req, res) => {
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
    
    // 检查是否需要自动查找影巢资源
    let autoSearchTriggered = false;
    if (autoSearchNewEnabled && HDHIVE_ENABLED) {
      console.log(`🔍 新订阅自动查找已启用，将监控 MediaHelper 执行状态...`);
      autoSearchTriggered = true;
      
      // 添加日志
      addAutoSearchLog(
        `新订阅自动查找`,
        `开始监控《${title}》的执行状态`,
        'info'
      );
      
      // 异步执行，不阻塞响应
      (async () => {
        try {
          console.log(`\n🔍 开始监控新订阅《${title}》的执行状态...`);
          
          // 等待5秒，确保订阅已经创建完成
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // 轮询检查订阅状态，最多检查60次（每次间隔1分钟，总共60分钟）
          let checkCount = 0;
          const maxChecks = 60;
          const checkInterval = 60000; // 1分钟
          
          const checkSubscriptionStatus = async () => {
            checkCount++;
            console.log(`   [${checkCount}/${maxChecks}] 检查订阅状态...`);
            
            // 获取订阅列表，找到刚创建的订阅
            const mhData = await getMediaHelperSubscriptions();
            if (!mhData || !mhData.subscriptions) {
              console.log('   ❌ 无法获取订阅列表');
              addAutoSearchLog(
                `新订阅自动查找 - ${title}`,
                `[${checkCount}/${maxChecks}] 无法获取订阅列表`,
                'error'
              );
              return false;
            }
            
            // 查找匹配的订阅
            const subscription = mhData.subscriptions.find(sub => {
              const params = sub.params || {};
              return params.tmdb_id === id && params.media_type === mediaType;
            });
            
            if (!subscription) {
              console.log(`   ❌ 未找到订阅: ${title}`);
              addAutoSearchLog(
                `新订阅自动查找 - ${title}`,
                `[${checkCount}/${maxChecks}] 未找到订阅`,
                'error'
              );
              return false;
            }
            
            // 检查 execution_status
            const executionStatus = subscription.execution_status;
            console.log(`   📋 执行状态: ${executionStatus || '未知'}`);
            
            if (executionStatus === 'success') {
              console.log(`   ✅ MediaHelper 执行成功，检查是否需要查找影巢资源...`);
              addAutoSearchLog(
                `新订阅自动查找 - ${title}`,
                `MediaHelper 执行成功，检查资源状态`,
                'success'
              );
              
              // 检查是否需要查找（未完成或缺集）
              const params = subscription.params || {};
              let needSearch = false;
              
              if (mediaType === 'tv' && subscription.episodes && Array.isArray(subscription.episodes) && subscription.episodes.length > 0) {
                const episodeData = subscription.episodes[0];
                let subscribedEpisodes = 0;
                let tmdbTotalEpisodes = 0;
                
                if (episodeData.episodes_arr) {
                  Object.values(episodeData.episodes_arr).forEach(seasonEpisodes => {
                    subscribedEpisodes += seasonEpisodes.length;
                  });
                }
                
                if (episodeData.episodes_count) {
                  Object.values(episodeData.episodes_count).forEach(seasonData => {
                    if (seasonData.count) {
                      tmdbTotalEpisodes += seasonData.count;
                    }
                  });
                }
                
                needSearch = subscribedEpisodes < tmdbTotalEpisodes;
                console.log(`   📊 电视剧状态: ${subscribedEpisodes}/${tmdbTotalEpisodes} 集，${needSearch ? '需要查找' : '已完成'}`);
                addAutoSearchLog(
                  `新订阅自动查找 - ${title}`,
                  `电视剧状态: ${subscribedEpisodes}/${tmdbTotalEpisodes} 集，${needSearch ? '缺集，开始查找' : '已完成'}`,
                  needSearch ? 'info' : 'success'
                );
              } else if (mediaType === 'movie') {
                // 电影：检查 episodes 数组是否有实际的集数数据
                const hasEpisodes = subscription.episodes && Array.isArray(subscription.episodes) && subscription.episodes.length > 0;
                let hasValidEpisodes = false;
                
                if (hasEpisodes) {
                  const episodeData = subscription.episodes[0];
                  // 检查是否有实际的集数数据
                  if (episodeData.episodes_arr && Object.keys(episodeData.episodes_arr).length > 0) {
                    hasValidEpisodes = true;
                  }
                }
                
                needSearch = !hasValidEpisodes;
                console.log(`   📊 电影状态: ${needSearch ? '未入库，需要查找' : '已入库'}`);
                addAutoSearchLog(
                  `新订阅自动查找 - ${title}`,
                  `电影状态: ${needSearch ? '未入库，开始查找' : '已入库'}`,
                  needSearch ? 'info' : 'success'
                );
              }
              
              if (needSearch) {
                // 查找影巢链接
                console.log(`   🔍 开始查找影巢资源...`);
                const links = await getHDHiveFreeLinks(id, mediaType, subscription);
                
                if (links && links.length > 0) {
                  console.log(`   ✓ 找到 ${links.length} 个可用链接`);
                  addAutoSearchLog(
                    `新订阅自动查找 - ${title}`,
                    `找到 ${links.length} 个可用链接（免费/已解锁）`,
                    'success'
                  );
                  
                  const result = await addLinksToSubscription(subscription, links);
                  
                  if (result.added > 0) {
                    console.log(`   ✅ 成功添加 ${result.added} 个新链接到订阅《${title}》`);
                    addAutoSearchLog(
                      `新订阅自动查找 - ${title}`,
                      `成功添加 ${result.added} 个新链接`,
                      'success'
                    );
                  } else if (result.duplicate === links.length) {
                    console.log(`   - 全部链接已存在`);
                    addAutoSearchLog(
                      `新订阅自动查找 - ${title}`,
                      `全部链接已存在`,
                      'info'
                    );
                  }
                } else {
                  console.log(`   - 未找到可用链接`);
                  addAutoSearchLog(
                    `新订阅自动查找 - ${title}`,
                    `未找到可用链接`,
                    'warning'
                  );
                }
              } else {
                console.log(`   ⏭️  订阅已完成，无需查找`);
              }
              
              return true; // 完成检查
            } else if (executionStatus === 'failed') {
              console.log(`   ❌ MediaHelper 执行失败，停止检查`);
              addAutoSearchLog(
                `新订阅自动查找 - ${title}`,
                `MediaHelper 执行失败，停止监控`,
                'error'
              );
              return true; // 停止检查
            } else {
              // 状态为 pending 或其他，继续等待
              console.log(`   ⏳ 等待 MediaHelper 执行完成...`);
              if (checkCount % 5 === 0) { // 每5次检查记录一次日志
                addAutoSearchLog(
                  `新订阅自动查找 - ${title}`,
                  `[${checkCount}/${maxChecks}] 等待 MediaHelper 执行完成 (状态: ${executionStatus || '未知'})`,
                  'info'
                );
              }
              return false; // 继续检查
            }
          };
          
          // 开始轮询检查
          while (checkCount < maxChecks) {
            const completed = await checkSubscriptionStatus();
            if (completed) {
              break;
            }
            
            // 等待下一次检查
            if (checkCount < maxChecks) {
              await new Promise(resolve => setTimeout(resolve, checkInterval));
            }
          }
          
          if (checkCount >= maxChecks) {
            console.log(`   ⏱️  已达到最大检查次数（60分钟），停止监控`);
            addAutoSearchLog(
              `新订阅自动查找 - ${title}`,
              `已达到最大检查次数（60分钟），停止监控`,
              'warning'
            );
          }
          
        } catch (error) {
          console.error(`   ❌ 自动查找失败:`, error.message);
          addAutoSearchLog(
            `新订阅自动查找 - ${title}`,
            `自动查找失败: ${error.message}`,
            'error'
          );
        }
      })();
    }
    
    return res.json({ 
      success: true, 
      message: `已成功订阅《${title}》${hdhiveLinks.length > 0 ? `（包含 ${hdhiveLinks.length} 个可用链接）` : ''}`,
      method: 'mediahelper',
      hdhiveLinksCount: hdhiveLinks.length,
      autoSearchTriggered
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
    intervalId: null,
    intervalHours: 72 // 默认 72 小时（3 天）
  };
  
  // 从文件加载定时任务状态
  function loadSchedulerState() {
    const saved = stateManager.getState('scheduler');
    if (saved) {
      schedulerState.enabled = saved.enabled || false;
      schedulerState.nextRun = saved.nextRun || null;
      schedulerState.intervalHours = saved.intervalHours || 72;
      console.log(`📅 定时任务状态已加载: ${schedulerState.enabled ? '已启用' : '未启用'}, 间隔: ${schedulerState.intervalHours} 小时`);
    }
  }
  
  function saveSchedulerState() {
    stateManager.setState('scheduler', {
      enabled: schedulerState.enabled,
      nextRun: schedulerState.nextRun,
      intervalHours: schedulerState.intervalHours
    });
  }
  
  // 执行批量查找任务
  async function runScheduledBatchSearch() {
    console.log('\n⏰ 定时任务触发：开始批量查找 HDHive 可用链接...');
    
    // 添加日志到批量查找面板
    batchSearchTask.logs.unshift({
      time: new Date().toISOString(),
      title: '定时任务开始',
      status: 'info',
      message: '开始批量查找影巢资源'
    });
    
    try {
      // 获取所有订阅
      const mhData = await getMediaHelperSubscriptions();
      if (!mhData || !mhData.subscriptions) {
        console.log('   ❌ 无法获取订阅列表');
        batchSearchTask.logs.unshift({
          time: new Date().toISOString(),
          title: '定时任务失败',
          status: 'error',
          message: '无法获取订阅列表'
        });
        return;
      }
      
      const allMediaSubscriptions = mhData.subscriptions.filter(sub => {
        const params = sub.params || {};
        return params.media_type === 'tv' || params.media_type === 'movie';
      });
      
      console.log(`   📊 共有 ${allMediaSubscriptions.length} 个订阅（电影+电视剧）`);
      
      // 筛选未完成的订阅（使用 MediaHelper 的 episodes 数据）
      const incompleteSubscriptions = [];
      let skippedCount = 0;
      
      for (const sub of allMediaSubscriptions) {
        const params = sub.params || {};
        const mediaType = params.media_type;
        const title = params.title || params.custom_name || sub.name;
        
        if (mediaType === 'tv' && sub.episodes && Array.isArray(sub.episodes) && sub.episodes.length > 0) {
          const episodeData = sub.episodes[0];
          
          // 获取已订阅的集数
          let subscribedEpisodes = 0;
          if (episodeData.episodes_arr) {
            Object.values(episodeData.episodes_arr).forEach(seasonEpisodes => {
              subscribedEpisodes += seasonEpisodes.length;
            });
          }
          
          // 获取总集数
          let tmdbTotalEpisodes = 0;
          if (episodeData.episodes_count) {
            Object.values(episodeData.episodes_count).forEach(seasonData => {
              if (seasonData.count) {
                tmdbTotalEpisodes += seasonData.count;
              }
            });
          }
          
          // 判断是否完成
          if (subscribedEpisodes < tmdbTotalEpisodes) {
            incompleteSubscriptions.push(sub);
          } else {
            console.log(`   ⏭️  跳过已完成: ${title} (${subscribedEpisodes}/${tmdbTotalEpisodes} 集)`);
            skippedCount++;
          }
        } else if (mediaType === 'movie') {
          // 电影：检查 episodes 数组是否为空
          if (!sub.episodes || sub.episodes.length === 0) {
            // episodes 为空，说明未入库
            incompleteSubscriptions.push(sub);
          } else {
            // episodes 有数据，说明已入库
            console.log(`   ⏭️  跳过已入库: ${title}`);
            skippedCount++;
          }
        }
      }
      
      console.log(`   📊 找到 ${incompleteSubscriptions.length} 个未完成订阅，跳过 ${skippedCount} 个已完成/已入库`);
      batchSearchTask.logs.unshift({
        time: new Date().toISOString(),
        title: '扫描完成',
        status: 'info',
        message: `找到 ${incompleteSubscriptions.length} 个未完成订阅，跳过 ${skippedCount} 个`
      });
      
      if (incompleteSubscriptions.length === 0) {
        console.log('   ✅ 没有未完成的订阅，任务结束');
        batchSearchTask.logs.unshift({
          time: new Date().toISOString(),
          title: '定时任务完成',
          status: 'success',
          message: '没有未完成的订阅'
        });
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
          const links = await getHDHiveFreeLinks(params.tmdb_id, params.media_type, sub);
          
          if (links && links.length > 0) {
            console.log(`   ✓ 找到 ${links.length} 个链接`);
            const result = await addLinksToSubscription(sub, links);
            
            if (result.added > 0) {
              successCount++;
              totalLinks += result.added;
              console.log(`   ✓ 成功添加 ${result.added} 个新链接`);
              batchSearchTask.logs.unshift({
                time: new Date().toISOString(),
                title: title,
                status: 'success',
                message: `找到 ${links.length} 个链接，新增 ${result.added} 个`
              });
            } else if (result.duplicate === links.length) {
              console.log(`   - 全部链接已存在`);
              batchSearchTask.logs.unshift({
                time: new Date().toISOString(),
                title: title,
                status: 'warning',
                message: `找到 ${links.length} 个链接，但全部已存在`
              });
            }
          } else {
            console.log(`   - 未找到可用链接`);
            failCount++;
            batchSearchTask.logs.unshift({
              time: new Date().toISOString(),
              title: title,
              status: 'error',
              message: '未找到可用链接'
            });
          }
        } catch (error) {
          failCount++;
          console.error(`   ✗ 查找失败: ${error.message}`);
          batchSearchTask.logs.unshift({
            time: new Date().toISOString(),
            title: title,
            status: 'error',
            message: `查找失败: ${error.message}`
          });
        }
        
        // 限制日志数量
        if (batchSearchTask.logs.length > 100) {
          batchSearchTask.logs.pop();
        }
        
        // 延迟 2 秒
        if (i < incompleteSubscriptions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      console.log(`\n✅ 定时任务完成: ${successCount} 个成功, ${failCount} 个失败, 共添加 ${totalLinks} 个链接\n`);
      batchSearchTask.logs.unshift({
        time: new Date().toISOString(),
        title: '定时任务完成',
        status: 'success',
        message: `成功: ${successCount}, 失败: ${failCount}, 共添加 ${totalLinks} 个链接`
      });
      
    } catch (error) {
      console.error('定时任务执行失败:', error);
      batchSearchTask.logs.unshift({
        time: new Date().toISOString(),
        title: '定时任务失败',
        status: 'error',
        message: error.message
      });
    }
  }
  
  // 启动定时任务
  function startScheduler(forceRecalculate = false) {
    if (schedulerState.intervalId) {
      clearTimeout(schedulerState.intervalId);
      clearInterval(schedulerState.intervalId);
      schedulerState.intervalId = null;
    }
    
    // 使用用户设置的间隔时间（小时转毫秒）
    const intervalMs = schedulerState.intervalHours * 60 * 60 * 1000;
    
    // 如果强制重新计算，或者没有下次运行时间，则使用新的间隔
    let delay = intervalMs;
    if (!forceRecalculate && schedulerState.nextRun) {
      const savedNextRun = new Date(schedulerState.nextRun).getTime();
      const now = Date.now();
      
      if (savedNextRun > now) {
        // 还没到时间，继续等待剩余时间
        delay = savedNextRun - now;
        console.log(`📅 恢复定时任务，剩余时间: ${Math.round(delay / 1000 / 60 / 60)} 小时`);
      } else {
        // 已经过期，立即执行一次
        console.log('⏰ 定时任务已过期，立即执行...');
        runScheduledBatchSearch();
        schedulerState.nextRun = Date.now() + intervalMs;
        saveSchedulerState();
      }
    } else {
      // 首次启动或强制重新计算，设置下次运行时间
      schedulerState.nextRun = Date.now() + intervalMs;
      saveSchedulerState();
      console.log(`📅 设置新的运行时间，间隔: ${schedulerState.intervalHours} 小时`);
    }
    
    // 启动定时器（使用计算出的延迟时间）
    schedulerState.intervalId = setTimeout(() => {
      runScheduledBatchSearch();
      schedulerState.nextRun = Date.now() + intervalMs;
      saveSchedulerState();
      
      // 执行完后，设置下一个周期的定时器
      schedulerState.intervalId = setInterval(() => {
        runScheduledBatchSearch();
        schedulerState.nextRun = Date.now() + intervalMs;
        saveSchedulerState();
      }, intervalMs);
    }, delay);
    
    console.log(`📅 定时任务已启动，间隔: ${schedulerState.intervalHours} 小时，下次运行: ${new Date(schedulerState.nextRun).toLocaleString('zh-CN')}`);
  }
  
  function stopScheduler() {
    if (schedulerState.intervalId) {
      clearTimeout(schedulerState.intervalId);
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
      nextRun: schedulerState.nextRun,
      intervalHours: schedulerState.intervalHours
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
  
  // 更新定时任务间隔
  app.post('/api/scheduler/interval', requireAuth, (req, res) => {
    try {
      const { hours } = req.body;
      
      if (!hours || hours < 1 || hours > 720) {
        return res.status(400).json({ success: false, error: '间隔时间必须在 1-720 小时之间' });
      }
      
      schedulerState.intervalHours = hours;
      
      // 重新计算下次运行时间（无论是否启用）
      schedulerState.nextRun = Date.now() + (hours * 60 * 60 * 1000);
      saveSchedulerState();
      
      // 如果定时任务已启用，重新启动定时器（强制重新计算）
      if (schedulerState.enabled) {
        startScheduler(true);
      }
      
      res.json({ 
        success: true, 
        intervalHours: schedulerState.intervalHours,
        nextRun: schedulerState.nextRun
      });
    } catch (error) {
      console.error('更新定时任务间隔失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 加载定时任务状态并启动
  loadSchedulerState();
  if (schedulerState.enabled) {
    startScheduler();
  }
  
  // ==================== HDHive 签到任务 ====================
  
  const HDHiveClient = require('./hdhive-client');
  const schedule = require('node-schedule');
  
  // 签到任务状态
  let signinState = {
    enabled: false,
    mode: 'normal',  // 'normal' 或 'gamble'
    time: '08:00',   // 每天签到时间 (HH:mm)
    lastRun: null,
    nextRun: null,
    job: null
  };
  
  // 加载签到状态
  function loadSigninState() {
    try {
      const appState = stateManager.getState('app') || {};
      const loaded = appState.signin || {};
      signinState = { ...signinState, ...loaded, job: null };
      console.log('📂 已加载签到任务状态');
    } catch (error) {
      console.error('⚠️  加载签到任务状态失败:', error.message);
    }
  }
  
  // 保存签到状态
  function saveSigninState() {
    try {
      const appState = stateManager.getState('app') || {};
      
      const stateToSave = {
        enabled: signinState.enabled,
        mode: signinState.mode,
        time: signinState.time,
        lastRun: signinState.lastRun,
        nextRun: signinState.nextRun
      };
      
      appState.signin = stateToSave;
      stateManager.setState('app', appState);
    } catch (error) {
      console.error('⚠️  保存签到任务状态失败:', error.message);
    }
  }
  
  // 执行签到
  async function executeSignin() {
    try {
      console.log('\n' + '='.repeat(60));
      console.log('🎯 开始执行自动签到任务');
      console.log('='.repeat(60));
      
      if (!HDHIVE_USERNAME || !HDHIVE_PASSWORD) {
        console.error('❌ 未配置 HDHive 账号密码，无法执行签到');
        return { success: false, error: '未配置账号密码' };
      }
      
      const client = new HDHiveClient(HDHIVE_USERNAME, HDHIVE_PASSWORD);
      
      // 执行签到
      const gamble = signinState.mode === 'gamble';
      const result = await client.signin(gamble);
      
      // 更新最后运行时间
      signinState.lastRun = Date.now();
      saveSigninState();
      
      // 输出结果
      console.log('\n📊 签到结果:');
      console.log(`  模式: ${result.mode}`);
      console.log(`  成功: ${result.success}`);
      console.log(`  消息: ${result.message}`);
      if (result.description) {
        console.log(`  详情: ${result.description}`);
      }
      
      if (result.success) {
        console.log('\n✅ 自动签到成功！');
      } else if (result.alreadySigned) {
        console.log('\n⚠️  今天已经签到过了');
      } else {
        console.log('\n❌ 签到失败');
      }
      
      console.log('='.repeat(60));
      
      return result;
    } catch (error) {
      console.error('❌ 签到任务执行失败:', error);
      return { success: false, error: error.message };
    }
  }
  
  // 启动签到任务
  function startSigninScheduler() {
    // 停止现有任务
    if (signinState.job) {
      signinState.job.cancel();
      signinState.job = null;
    }
    
    if (!signinState.enabled) {
      console.log('📅 签到任务未启用');
      return;
    }
    
    // 解析时间
    const [hour, minute] = signinState.time.split(':').map(Number);
    
    // 创建定时任务（每天指定时间执行）
    const cronExpression = `${minute} ${hour} * * *`;
    
    signinState.job = schedule.scheduleJob(cronExpression, async () => {
      await executeSignin();
    });
    
    // 计算下次运行时间
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(hour, minute, 0, 0);
    
    // 如果今天的时间已过，设置为明天
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }
    
    signinState.nextRun = nextRun.getTime();
    saveSigninState();
    
    console.log(`📅 签到任务已启动`);
    console.log(`   模式: ${signinState.mode === 'gamble' ? '赌狗签到' : '普通签到'}`);
    console.log(`   时间: 每天 ${signinState.time}`);
    console.log(`   下次运行: ${nextRun.toLocaleString('zh-CN')}`);
  }
  
  // 停止签到任务
  function stopSigninScheduler() {
    if (signinState.job) {
      signinState.job.cancel();
      signinState.job = null;
    }
    signinState.nextRun = null;
    saveSigninState();
    console.log('📅 签到任务已停止');
  }
  
  // 签到任务 API
  
  // 获取签到任务状态
  app.get('/api/signin/status', (req, res) => {
    res.json({
      enabled: signinState.enabled,
      mode: signinState.mode,
      time: signinState.time,
      lastRun: signinState.lastRun,
      nextRun: signinState.nextRun
    });
  });
  
  // 切换签到任务
  app.post('/api/signin/toggle', requireAuth, (req, res) => {
    try {
      const { enabled } = req.body;
      
      signinState.enabled = enabled;
      
      if (enabled) {
        startSigninScheduler();
      } else {
        stopSigninScheduler();
      }
      
      res.json({ 
        success: true, 
        enabled: signinState.enabled,
        nextRun: signinState.nextRun
      });
    } catch (error) {
      console.error('切换签到任务失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 更新签到任务配置
  app.post('/api/signin/config', requireAuth, (req, res) => {
    try {
      const { mode, time } = req.body;
      
      // 验证模式
      if (mode && !['normal', 'gamble'].includes(mode)) {
        return res.status(400).json({ 
          success: false, 
          error: '签到模式必须是 normal 或 gamble' 
        });
      }
      
      // 验证时间格式
      if (time) {
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (!timeRegex.test(time)) {
          return res.status(400).json({ 
            success: false, 
            error: '时间格式必须是 HH:mm (例如: 08:00)' 
          });
        }
      }
      
      // 更新配置
      if (mode) signinState.mode = mode;
      if (time) signinState.time = time;
      
      saveSigninState();
      
      // 如果任务已启用，重新启动以应用新配置
      if (signinState.enabled) {
        startSigninScheduler();
      }
      
      res.json({ 
        success: true,
        mode: signinState.mode,
        time: signinState.time,
        nextRun: signinState.nextRun
      });
    } catch (error) {
      console.error('更新签到任务配置失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 手动执行签到
  app.post('/api/signin/execute', requireAuth, async (req, res) => {
    try {
      const { mode } = req.body;
      
      // 验证模式
      if (mode && !['normal', 'gamble'].includes(mode)) {
        return res.status(400).json({ 
          success: false, 
          error: '签到模式必须是 normal 或 gamble' 
        });
      }
      
      // 临时修改模式（如果指定）
      const originalMode = signinState.mode;
      if (mode) {
        signinState.mode = mode;
      }
      
      // 执行签到
      const result = await executeSignin();
      
      // 恢复原模式
      if (mode) {
        signinState.mode = originalMode;
      }
      
      res.json(result);
    } catch (error) {
      console.error('手动签到失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 更新签到 Action ID
  app.post('/api/signin/action-id', requireAuth, async (req, res) => {
    try {
      const { actionId } = req.body;
      
      if (!actionId) {
        return res.status(400).json({ 
          success: false, 
          error: '请提供 Action ID' 
        });
      }
      
      // 验证 Action ID 格式（40位十六进制）
      if (!/^[a-f0-9]{40}$/.test(actionId)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Action ID 格式不正确（应为40位十六进制字符串）' 
        });
      }
      
      // 保存新的 Action ID
      const HDHiveClient = require('./hdhive-client');
      const client = new HDHiveClient(HDHIVE_USERNAME, HDHIVE_PASSWORD);
      client._saveSigninActionId(actionId);
      
      res.json({ 
        success: true,
        message: '签到 Action ID 已更新',
        actionId: actionId
      });
    } catch (error) {
      console.error('更新签到 Action ID 失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 获取当前签到 Action ID
  app.get('/api/signin/action-id', requireAuth, (req, res) => {
    try {
      const HDHiveClient = require('./hdhive-client');
      const client = new HDHiveClient(HDHIVE_USERNAME, HDHIVE_PASSWORD);
      const actionId = client._getSigninActionId();
      
      res.json({ 
        success: true,
        actionId: actionId
      });
    } catch (error) {
      console.error('获取签到 Action ID 失败:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // ==================== 积分解锁设置 API ====================
  
  // 获取积分解锁设置
  app.get('/api/auto-unlock/settings', requireAuth, (req, res) => {
    try {
      const autoUnlock = stateManager.getState('autoUnlock') || {
        enabled: false,
        maxPointsPerShow: 10,
        onlyUnlockIfNoResources: false
      };
      
      res.json(autoUnlock);
    } catch (error) {
      console.error('获取积分解锁设置失败:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // 保存积分解锁设置
  app.post('/api/auto-unlock/settings', requireAuth, (req, res) => {
    try {
      const { enabled, maxPointsPerShow, onlyUnlockIfNoResources } = req.body;
      
      const autoUnlock = {
        enabled: enabled || false,
        maxPointsPerShow: maxPointsPerShow || 10,
        onlyUnlockIfNoResources: onlyUnlockIfNoResources || false
      };
      stateManager.setState('autoUnlock', autoUnlock);
      
      console.log(`✓ 积分解锁设置已更新: 启用=${enabled}, 最大积分=${maxPointsPerShow}, 仅无资源=${onlyUnlockIfNoResources}`);
      
      res.json({ 
        success: true,
        message: '设置已保存',
        settings: autoUnlock
      });
    } catch (error) {
      console.error('保存积分解锁设置失败:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // 获取当前 HDHive 积分
  app.get('/api/hdhive/points', requireAuth, async (req, res) => {
    try {
      if (!HDHIVE_USERNAME || !HDHIVE_PASSWORD) {
        return res.status(400).json({ error: '未配置 HDHive 账号' });
      }
      
      const HDHiveClient = require('./hdhive-client');
      const client = new HDHiveClient(HDHIVE_USERNAME, HDHIVE_PASSWORD);
      
      // 获取用户积分信息
      const userInfo = await client.getUserPoints();
      
      res.json({ 
        points: userInfo.points,
        signinDays: userInfo.signinDays,
        nickname: userInfo.nickname,
        isVip: userInfo.isVip
      });
    } catch (error) {
      console.error('获取 HDHive 积分失败:', error);
      res.status(500).json({ error: error.message });
    }
  });
  
  // ==================== 签到任务初始化 ====================
  
  // 加载签到任务状态并启动
  loadSigninState();
  if (signinState.enabled && HDHIVE_USERNAME && HDHIVE_PASSWORD) {
    startSigninScheduler();
  } else if (signinState.enabled) {
    console.log('⚠️  签到任务已启用但未配置 HDHive 账号密码');
  }
  
  // ==================== 启动服务器 ====================
  
  app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
  });
}

console.log('=== 脚本开始执行 ===');
startServer();

 
 
