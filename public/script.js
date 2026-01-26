// 认证检查
const token = localStorage.getItem('token');
if (!token) {
  window.location.href = '/login';
}

// 验证token并检查账号状态
async function verifyToken() {
  try {
    const response = await fetch('/api/verify', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      
      // 如果是账号问题，清除登录状态并跳转到登录页
      if (data.error === 'account_deleted' || data.error === 'account_disabled') {
        console.log('账号状态异常，需要重新登录');
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
        return;
      }
      
      // 其他错误也清除登录状态
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
  } catch (error) {
    console.error('验证失败:', error);
  }
}

// 首次验证
verifyToken();

// 定期检查账号状态（每5分钟检查一次）
setInterval(verifyToken, 5 * 60 * 1000);

// API请求辅助函数
async function fetchWithAuth(url, options = {}) {
  const headers = {
    ...options.headers,
    'Authorization': `Bearer ${token}`
  };
  
  const response = await fetch(url, { ...options, headers });
  
  if (response.status === 401) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('未授权');
  }
  
  return response;
}

const searchInput = document.getElementById('searchInput');
const suggestions = document.getElementById('suggestions');
const totalRequests = document.getElementById('totalRequests');
const movieCount = document.getElementById('movieCount');
const seriesCount = document.getElementById('seriesCount');
const trendingMovies = document.getElementById('trendingMovies');
const trendingTV = document.getElementById('trendingTV');
const embyLink = document.getElementById('embyLink');
const recentCarousel = document.getElementById('recentCarousel');

let searchTimeout;
let carouselInterval;
let currentIndex = 0;
let itemHeight = 0;

// 主题切换
const themeButtons = document.querySelectorAll('.theme-btn');
const savedTheme = localStorage.getItem('theme') || 'dark';

// 获取系统主题
function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// 应用主题
function applyTheme(theme) {
  let actualTheme = theme;
  if (theme === 'auto') {
    actualTheme = getSystemTheme();
  }
  document.documentElement.setAttribute('data-theme', actualTheme);
}

// 初始化主题
applyTheme(savedTheme);

// 更新按钮状态
themeButtons.forEach(btn => {
  btn.classList.remove('active');
  if (btn.dataset.theme === savedTheme) {
    btn.classList.add('active');
  }
});

// 监听系统主题变化
const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
mediaQuery.addEventListener('change', (e) => {
  const currentTheme = localStorage.getItem('theme') || 'dark';
  if (currentTheme === 'auto') {
    applyTheme('auto');
  }
});

// 主题切换事件
themeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    applyTheme(theme);
    localStorage.setItem('theme', theme);
    
    // 更新按钮状态
    themeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// 更新请求计数
function updateRequestCount(count) {
  totalRequests.textContent = count;
}

// 检查服务状态
async function checkServicesStatus() {
  // 检查 Emby 状态
  try {
    const startTime = performance.now();
    const embyResponse = await fetchWithAuth('/api/emby/stats');
    const embyData = await embyResponse.json();
    const embyPing = Math.round(performance.now() - startTime);
    const embyOnline = embyData.total !== null;
    
    // 更新桌面端状态点和延迟
    const embyStatusDot = document.getElementById('embyStatusDot');
    const embyPingEl = document.getElementById('embyPing');
    if (embyStatusDot) {
      embyStatusDot.className = `status-dot ${embyOnline ? 'online' : 'offline'}`;
    }
    if (embyPingEl) {
      embyPingEl.textContent = embyOnline ? `${embyPing}ms` : '离线';
    }
    
    // 更新移动端状态点和延迟
    const mobileEmbyStatusDot = document.getElementById('mobileEmbyStatusDot');
    const mobileEmbyPingEl = document.getElementById('mobileEmbyPing');
    if (mobileEmbyStatusDot) {
      mobileEmbyStatusDot.className = `status-dot ${embyOnline ? 'online' : 'offline'}`;
    }
    if (mobileEmbyPingEl) {
      mobileEmbyPingEl.textContent = embyOnline ? `${embyPing}ms` : '离线';
    }
    
    // 更新统计数据
    if (embyOnline) {
      movieCount.textContent = embyData.movies || '∞';
      seriesCount.textContent = embyData.series || '∞';
      if (embyData.embyUrl) {
        embyLink.href = embyData.embyUrl;
      }
    } else {
      movieCount.textContent = '∞';
      seriesCount.textContent = '∞';
    }
    
    // 更新今日请求数
    if (embyData.todayRequests !== undefined) {
      updateRequestCount(embyData.todayRequests);
    }
  } catch (error) {
    console.error('检查 Emby 状态失败:', error);
    const embyStatusDot = document.getElementById('embyStatusDot');
    const mobileEmbyStatusDot = document.getElementById('mobileEmbyStatusDot');
    const embyPingEl = document.getElementById('embyPing');
    const mobileEmbyPingEl = document.getElementById('mobileEmbyPing');
    if (embyStatusDot) embyStatusDot.className = 'status-dot offline';
    if (mobileEmbyStatusDot) mobileEmbyStatusDot.className = 'status-dot offline';
    if (embyPingEl) embyPingEl.textContent = '离线';
    if (mobileEmbyPingEl) mobileEmbyPingEl.textContent = '离线';
  }
  
  // 检查 MediaHelper 状态
  try {
    const startTime = performance.now();
    const mediahelperResponse = await fetchWithAuth('/api/recent-requests');
    const mediahelperData = await mediahelperResponse.json();
    const mediahelperPing = Math.round(performance.now() - startTime);
    const mediahelperOnline = mediahelperData.requests && mediahelperData.requests.length >= 0;
    
    // 更新桌面端状态点和延迟
    const mediahelperStatusDot = document.getElementById('mediahelperStatusDot');
    const mediahelperPingEl = document.getElementById('mediahelperPing');
    if (mediahelperStatusDot) {
      mediahelperStatusDot.className = `status-dot ${mediahelperOnline ? 'online' : 'offline'}`;
    }
    if (mediahelperPingEl) {
      mediahelperPingEl.textContent = mediahelperOnline ? `${mediahelperPing}ms` : '离线';
    }
    
    // 更新移动端状态点和延迟
    const mobileMediahelperStatusDot = document.getElementById('mobileMediahelperStatusDot');
    const mobileMediahelperPingEl = document.getElementById('mobileMediahelperPing');
    if (mobileMediahelperStatusDot) {
      mobileMediahelperStatusDot.className = `status-dot ${mediahelperOnline ? 'online' : 'offline'}`;
    }
    if (mobileMediahelperPingEl) {
      mobileMediahelperPingEl.textContent = mediahelperOnline ? `${mediahelperPing}ms` : '离线';
    }
  } catch (error) {
    console.error('检查 MediaHelper 状态失败:', error);
    const mediahelperStatusDot = document.getElementById('mediahelperStatusDot');
    const mobileMediahelperStatusDot = document.getElementById('mobileMediahelperStatusDot');
    const mediahelperPingEl = document.getElementById('mediahelperPing');
    const mobileMediahelperPingEl = document.getElementById('mobileMediahelperPing');
    if (mediahelperStatusDot) mediahelperStatusDot.className = 'status-dot offline';
    if (mobileMediahelperStatusDot) mobileMediahelperStatusDot.className = 'status-dot offline';
    if (mediahelperPingEl) mediahelperPingEl.textContent = '离线';
    if (mobileMediahelperPingEl) mobileMediahelperPingEl.textContent = '离线';
  }
  
  // 检查 TMDB 状态
  try {
    const startTime = performance.now();
    const tmdbResponse = await fetchWithAuth('/api/tmdb/status');
    const tmdbData = await tmdbResponse.json();
    const clientPing = Math.round(performance.now() - startTime);
    const tmdbOnline = tmdbData.online;
    const tmdbPing = tmdbData.ping || clientPing;
    
    // 更新桌面端状态点和延迟
    const tmdbStatusDot = document.getElementById('tmdbStatusDot');
    const tmdbPingEl = document.getElementById('tmdbPing');
    if (tmdbStatusDot) {
      tmdbStatusDot.className = `status-dot ${tmdbOnline ? 'online' : 'offline'}`;
    }
    if (tmdbPingEl) {
      tmdbPingEl.textContent = tmdbOnline ? `${tmdbPing}ms` : '离线';
    }
    
    // 更新移动端状态点和延迟
    const mobileTmdbStatusDot = document.getElementById('mobileTmdbStatusDot');
    const mobileTmdbPingEl = document.getElementById('mobileTmdbPing');
    if (mobileTmdbStatusDot) {
      mobileTmdbStatusDot.className = `status-dot ${tmdbOnline ? 'online' : 'offline'}`;
    }
    if (mobileTmdbPingEl) {
      mobileTmdbPingEl.textContent = tmdbOnline ? `${tmdbPing}ms` : '离线';
    }
  } catch (error) {
    console.error('检查 TMDB 状态失败:', error);
    const tmdbStatusDot = document.getElementById('tmdbStatusDot');
    const mobileTmdbStatusDot = document.getElementById('mobileTmdbStatusDot');
    const tmdbPingEl = document.getElementById('tmdbPing');
    const mobileTmdbPingEl = document.getElementById('mobileTmdbPing');
    if (tmdbStatusDot) tmdbStatusDot.className = 'status-dot offline';
    if (mobileTmdbStatusDot) mobileTmdbStatusDot.className = 'status-dot offline';
    if (tmdbPingEl) tmdbPingEl.textContent = '离线';
    if (mobileTmdbPingEl) mobileTmdbPingEl.textContent = '离线';
  }
}

// 加载 Emby 影片库统计
async function loadEmbyStats() {
  await checkServicesStatus();
  // 更新 Footer 统计数据
  if (typeof updateFooterStats === 'function') {
    updateFooterStats();
  }
}

// 并行加载所有数据，提升首页加载速度
Promise.all([
  loadEmbyStats(),
  loadTrending(),
  loadIncompleteSubscriptions(),
  loadRecentRequests()
]).catch(error => {
  console.error('加载页面数据失败:', error);
});

// 定期检查是否有新订阅（每30秒检查一次）
setInterval(async () => {
  try {
    const response = await fetchWithAuth('/api/settings/auto-search-new/has-new');
    const data = await response.json();
    
    if (data.hasNew) {
      console.log('🆕 检测到新订阅，自动刷新订阅列表...');
      // 自动刷新订阅列表
      await loadIncompleteSubscriptions(true);
    }
  } catch (error) {
    // 静默失败，不影响用户体验
  }
}, 30 * 1000); // 30秒

// 桌面端下拉菜单
setTimeout(() => {
  const statusLink = document.getElementById('statusLink');
  
  if (statusLink) {
    const dropdownMenu = statusLink.querySelector('.dropdown-menu');
    
    // 点击切换下拉菜单
    statusLink.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      statusLink.classList.toggle('active');
    });
    
    // 阻止下拉菜单内部点击事件冒泡
    if (dropdownMenu) {
      dropdownMenu.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
    
    // 点击外部关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!statusLink.contains(e.target)) {
        statusLink.classList.remove('active');
      }
    });
  }

  // 移动端下拉菜单
  const mobileStatusDropdown = document.getElementById('mobileStatusDropdown');
  if (mobileStatusDropdown) {
    const header = mobileStatusDropdown.querySelector('.mobile-menu-header');
    if (header) {
      header.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        mobileStatusDropdown.classList.toggle('active');
      });
    }
  }
}, 100);

// 同步卡片高度
function syncCardHeights() {
  // 移动端不同步高度
  if (window.innerWidth <= 1024) {
    const recentCard = document.querySelector('.recent-card');
    if (recentCard) {
      recentCard.style.height = '';
      recentCard.style.minHeight = '';
      recentCard.style.maxHeight = '';
    }
    return;
  }
  
  const mainCard = document.querySelector('.main-card');
  const recentCard = document.querySelector('.recent-card');
  
  if (mainCard && recentCard) {
    // 获取主卡片的实际高度
    const mainHeight = mainCard.getBoundingClientRect().height;
    
    // 设置最近请求卡片的高度
    recentCard.style.height = `${mainHeight}px`;
    recentCard.style.minHeight = `${mainHeight}px`;
    recentCard.style.maxHeight = `${mainHeight}px`;
  }
}

// 多次尝试同步，确保内容加载完成
setTimeout(syncCardHeights, 100);
setTimeout(syncCardHeights, 500);
setTimeout(syncCardHeights, 1000);

// 窗口大小改变时重新同步
window.addEventListener('resize', syncCardHeights);

// 加载最近请求
async function loadRecentRequests() {
  try {
    const response = await fetchWithAuth('/api/recent-requests');
    const data = await response.json();
    
    if (data.requests && data.requests.length > 0) {
      displayRecentCarousel(data.requests);
    } else {
      // 没有数据时显示空状态
      recentCarousel.innerHTML = `
        <div class="empty-recent">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>暂无请求记录</span>
        </div>
      `;
    }
  } catch (error) {
    console.error('加载最近请求失败:', error);
    // 加载失败也显示空状态
    recentCarousel.innerHTML = `
      <div class="empty-recent">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        <span>加载失败</span>
      </div>
    `;
  }
}

function displayRecentCarousel(requests) {
  const recentItems = requests.slice(0, 10); // 只取10条数据
  
  // 判断是否需要滚动
  const minItems = window.innerWidth <= 640 ? 2 : 3;
  const needsScroll = recentItems.length > minItems;
  
  // 只有需要滚动时才复制一份用于无缝循环
  const displayItems = needsScroll ? [...recentItems, ...recentItems] : recentItems;
  
  recentCarousel.innerHTML = displayItems.map(item => {
    const typeText = item.mediaType === 'movie' ? '电影' : '电视剧';
    const timeAgo = getTimeAgo(item.requestedAt);
    
    return `
      <div class="recent-item">
        ${item.poster ? `<img src="${item.poster}" class="recent-poster" alt="${escapeHtml(item.title)}">` : '<div class="recent-poster"></div>'}
        <div class="recent-info">
          <div class="recent-title">${escapeHtml(item.title)}</div>
          <div class="recent-meta">
            <span class="recent-type">${typeText}</span>
            <span>${timeAgo}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // 启动轮播
  setTimeout(() => {
    startCarousel(recentItems.length);
  }, 100);
}

function startCarousel(totalItems, resetIndex = true) {
  // 清除之前的定时器
  if (carouselInterval) {
    clearInterval(carouselInterval);
  }
  
  // 如果项目数量不足，不启动滚动
  // 移动端显示2个，桌面端显示3个
  const minItems = window.innerWidth <= 640 ? 2 : 3;
  if (totalItems <= minItems) {
    console.log(`项目数量(${totalItems})不足，不启动滚动`);
    return;
  }
  
  // 获取单个项目的高度（包括gap）
  const firstItem = recentCarousel.querySelector('.recent-item');
  if (!firstItem) return;
  
  const itemRect = firstItem.getBoundingClientRect();
  // 根据屏幕宽度使用不同的 gap
  const gap = window.innerWidth <= 640 ? 16 : 12; // 移动端 1rem (16px), 桌面端 0.75rem (12px)
  itemHeight = itemRect.height + gap;
  
  if (resetIndex) {
    currentIndex = 0;
    recentCarousel.style.transform = `translateY(0)`;
  }
  
  // 每3秒滚动一次
  carouselInterval = setInterval(() => {
    currentIndex++;
    
    // 滚动到下一项
    recentCarousel.style.transform = `translateY(-${currentIndex * itemHeight}px)`;
    
    // 当滚动到复制的部分时，无缝重置
    if (currentIndex >= totalItems) {
      setTimeout(() => {
        recentCarousel.style.transition = 'none';
        currentIndex = 0;
        recentCarousel.style.transform = `translateY(0)`;
        
        // 恢复过渡效果
        setTimeout(() => {
          recentCarousel.style.transition = 'transform 0.5s ease-in-out';
        }, 50);
      }, 500); // 等待滚动动画完成
    }
  }, 3000); // 每3秒滚动一次
}

// 鼠标悬停时暂停
if (recentCarousel) {
  recentCarousel.addEventListener('mouseenter', () => {
    if (carouselInterval) {
      clearInterval(carouselInterval);
    }
  });
  
  recentCarousel.addEventListener('mouseleave', () => {
    const items = recentCarousel.querySelectorAll('.recent-item');
    // 检查是否有重复项（用于无缝循环）
    const minItems = window.innerWidth <= 640 ? 2 : 3;
    const totalItems = items.length > minItems * 2 ? items.length / 2 : items.length;
    if (totalItems > minItems) {
      startCarousel(totalItems, false); // 不重置索引，从当前位置继续
    }
  });
}

// 窗口大小改变时重新计算轮播
window.addEventListener('resize', () => {
  if (carouselInterval) {
    clearInterval(carouselInterval);
    const items = recentCarousel.querySelectorAll('.recent-item');
    const minItems = window.innerWidth <= 640 ? 2 : 3;
    const totalItems = items.length > minItems * 2 ? items.length / 2 : items.length;
    if (totalItems > minItems) {
      // 重置位置
      currentIndex = 0;
      recentCarousel.style.transition = 'none';
      recentCarousel.style.transform = 'translateY(0)';
      setTimeout(() => {
        recentCarousel.style.transition = 'transform 0.5s ease-in-out';
        startCarousel(totalItems);
      }, 50);
    }
  }
});

function getTimeAgo(timestamp) {
  const now = new Date();
  const past = new Date(timestamp);
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  return past.toLocaleDateString('zh-CN');
}

// 卡片点阵效果
const card = document.querySelector('.card');
const spotlight = document.querySelector('.card-spotlight');

if (card && spotlight) {
  card.addEventListener('mousemove', (e) => {
    const rect = card.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    spotlight.style.setProperty('--mouse-x', `${x}%`);
    spotlight.style.setProperty('--mouse-y', `${y}%`);
  });
}

// 最近请求卡片点阵效果
const recentCard = document.querySelector('.recent-card');
const recentSpotlight = document.querySelector('.recent-card-spotlight');

if (recentCard && recentSpotlight) {
  recentCard.addEventListener('mousemove', (e) => {
    const rect = recentCard.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    recentSpotlight.style.setProperty('--mouse-x', `${x}%`);
    recentSpotlight.style.setProperty('--mouse-y', `${y}%`);
  });
}

// 分页状态
let currentMoviePage = 1;
let currentTVPage = 1;
let totalMoviePages = 1;
let totalTVPages = 1;

// 所有订阅状态
var allIncompleteSubscriptions = []; // 所有订阅（从服务器获取）
var incompleteTotalCount = 0; // 总数
var currentIncompletePage = 1;
var incompletePerPage = 20; // 这个值会在首次加载时动态计算
var incompleteRefreshInterval = null;

// 计算每页应该显示多少个卡片
function calculateItemsPerPage() {
  // 根据屏幕宽度确定每行数量和显示行数
  const width = window.innerWidth;
  let itemsPerRow;
  let rows; // 显示多少排
  
  if (width > 1024) {
    // 桌面端：固定6列
    itemsPerRow = 6;
    rows = 2;
  } else if (width > 768) {
    // 平板：固定5列
    itemsPerRow = 5;
    rows = 2;
  } else {
    // 手机：固定3列
    itemsPerRow = 3;
    rows = 4;
  }
  
  // 总数 = 每行数量 × 行数
  const total = itemsPerRow * rows;
  
  console.log(`📊 热门内容 - 屏幕: ${width}px, 每行: ${itemsPerRow} 个, ${rows} 排, 共: ${total} 个`);
  
  return total;
}

// 加载热门内容
async function loadTrending(moviePage = 1, tvPage = 1) {
  try {
    const itemsPerPage = calculateItemsPerPage();
    
    // 并行加载热门电影和电视剧
    const [moviesResponse, tvResponse] = await Promise.all([
      fetchWithAuth(`/api/trending/movies?page=${moviePage}&per_page=${itemsPerPage}`),
      fetchWithAuth(`/api/trending/tv?page=${tvPage}&per_page=${itemsPerPage}`)
    ]);
    
    const moviesData = await moviesResponse.json();
    const tvData = await tvResponse.json();
    
    currentMoviePage = moviesData.page || 1;
    currentTVPage = tvData.page || 1;
    totalMoviePages = moviesData.total_pages || 1;
    totalTVPages = tvData.total_pages || 1;
    
    displayMovies(moviesData.results, trendingMovies);
    displayMovies(tvData.results, trendingTV);
    
    // 更新分页按钮
    updatePagination('movies', currentMoviePage, totalMoviePages);
    updatePagination('tv', currentTVPage, totalTVPages);
  } catch (error) {
    console.error('加载热门内容失败:', error);
    trendingMovies.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div><div style="color: #9ca3af;">加载失败</div></div>';
    trendingTV.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div><div style="color: #9ca3af;">加载失败</div></div>';
  }
}

// 完全刷新未完成订阅（清除缓存，重新获取所有订阅）
async function fullRefreshIncompleteSubscriptions() {
  // 强制从服务器刷新
  await loadIncompleteSubscriptions(true);
}

// 加载所有订阅
async function loadIncompleteSubscriptions(forceRefresh = false) {
  const container = document.getElementById('incompleteSubscriptions');
  
  // 显示骨架屏
  if (!forceRefresh) {
    const skeletonCount = calculateIncompleteItemsPerPage();
    const skeletonHTML = Array(skeletonCount).fill(0).map(() => `
      <div class="subscription-skeleton">
        <div class="skeleton-subscription-poster"></div>
        <div class="skeleton-subscription-info">
          <div class="skeleton-subscription-title"></div>
          <div class="skeleton-subscription-title-2"></div>
          <div class="skeleton-subscription-stat"></div>
          <div class="skeleton-subscription-stat"></div>
          <div class="skeleton-subscription-stat"></div>
          <div class="skeleton-subscription-progress"></div>
          <div class="skeleton-subscription-status"></div>
        </div>
      </div>
    `).join('');
    container.innerHTML = skeletonHTML;
  }
  
  try {
    console.log('🌐 从服务器获取数据（首次只获取第一页）...');
    
    // 首次加载：先获取总数
    const countUrl = forceRefresh ? '/api/incomplete-subscriptions?refresh=true&only_count=true' : '/api/incomplete-subscriptions?only_count=true';
    const countResponse = await fetchWithAuth(countUrl);
    if (!countResponse.ok) {
      throw new Error(`服务器错误 ${countResponse.status}: ${countResponse.statusText}`);
    }
    const countData = await countResponse.json();
    const totalCount = countData.total || 0;
    
    console.log(`📊 总共有 ${totalCount} 个订阅`);
    
    if (totalCount === 0) {
      container.innerHTML = `
        <div class="incomplete-empty">
          <svg class="incomplete-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 11l3 3L22 4"></path>
            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"></path>
          </svg>
          <p>太棒了！所有订阅都已完成 🎉</p>
        </div>
      `;
      return;
    }
    
    // 获取第一页数据
    incompletePerPage = calculateIncompleteItemsPerPage();
    const firstPageUrl = forceRefresh 
      ? `/api/incomplete-subscriptions?refresh=true&page=1&per_page=${incompletePerPage}`
      : `/api/incomplete-subscriptions?page=1&per_page=${incompletePerPage}`;
    
    const firstPageResponse = await fetchWithAuth(firstPageUrl);
    if (!firstPageResponse.ok) {
      throw new Error(`服务器错误 ${firstPageResponse.status}: ${firstPageResponse.statusText}`);
    }
    const firstPageData = await firstPageResponse.json();
    
    // 保存所有未完成订阅和总数
    allIncompleteSubscriptions = firstPageData.subscriptions || [];
    incompleteTotalCount = firstPageData.total || 0;
    
    console.log(`✅ 首次加载第一页 ${allIncompleteSubscriptions.length} 个订阅，总共 ${incompleteTotalCount} 个`);
    
    // 显示第一页
    displayIncompleteSubscriptions(1);
    
  } catch (error) {
    console.error('❌ 加载未完成订阅失败:', error);
    console.error('错误详情:', error.message);
    console.error('错误堆栈:', error.stack);
    container.innerHTML = `
      <div class="incomplete-empty">
        <svg class="incomplete-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M8 15s1.5-2 4-2 4 2 4 2"></path>
          <line x1="9" y1="9" x2="9.01" y2="9"></line>
          <line x1="15" y1="9" x2="15.01" y2="9"></line>
        </svg>
        <p>加载失败，请刷新重试</p>
        <p style="font-size: 0.75rem; margin-top: 0.5rem; color: var(--text-secondary);">${error.message}</p>
      </div>
    `;
  }
}

// 计算未完成订阅每页应该显示多少个
function calculateIncompleteItemsPerPage() {
  // 根据屏幕宽度确定每行数量和显示行数
  const width = window.innerWidth;
  let itemsPerRow;
  let rows; // 显示多少排
  
  if (width > 1200) {
    // 桌面端：固定7列
    itemsPerRow = 7;
    rows = 2;
  } else if (width > 768) {
    // 平板：固定5列
    itemsPerRow = 5;
    rows = 2;
  } else if (width > 480) {
    // 大手机：固定3列
    itemsPerRow = 3;
    rows = 4;
  } else {
    // 小手机：固定3列
    itemsPerRow = 3;
    rows = 5;
  }
  
  // 总数 = 每行数量 × 行数
  const total = itemsPerRow * rows;
  
  console.log(`📊 未完成订阅 - 屏幕: ${width}px, 每行: ${itemsPerRow} 个, ${rows} 排, 共: ${total} 个`);
  
  return total;
}

// 按需加载指定页的数据
async function loadIncompletePage(page) {
  const container = document.getElementById('incompleteSubscriptions');
  
  // 显示骨架屏
  const skeletonHTML = Array(incompletePerPage).fill(0).map(() => `
    <div class="subscription-skeleton">
      <div class="skeleton-subscription-poster"></div>
      <div class="skeleton-subscription-info">
        <div class="skeleton-subscription-title"></div>
        <div class="skeleton-subscription-title-2"></div>
        <div class="skeleton-subscription-stat"></div>
        <div class="skeleton-subscription-stat"></div>
        <div class="skeleton-subscription-stat"></div>
        <div class="skeleton-subscription-progress"></div>
        <div class="skeleton-subscription-status"></div>
      </div>
    </div>
  `).join('');
  container.innerHTML = skeletonHTML;
  
  try {
    const url = `/api/incomplete-subscriptions?page=${page}&per_page=${incompletePerPage}`;
    console.log(`📡 请求 URL: ${url}`);
    const response = await fetchWithAuth(url);
    
    if (!response.ok) {
      throw new Error(`加载失败: ${response.status}`);
    }
    
    const data = await response.json();
    const pageData = data.subscriptions || [];
    
    // 计算该页在全局数组中的位置
    const startIndex = (page - 1) * incompletePerPage;
    
    // 确保数组足够大
    while (allIncompleteSubscriptions.length < startIndex + pageData.length) {
      allIncompleteSubscriptions.push(null);
    }
    
    // 插入该页的数据
    pageData.forEach((item, index) => {
      allIncompleteSubscriptions[startIndex + index] = item;
    });
    
    incompleteTotalCount = data.total || 0;
    
    console.log(`✅ 第 ${page} 页加载完成，共 ${pageData.length} 个订阅`);
    
    // 重新显示
    displayIncompleteSubscriptions(page);
    
  } catch (error) {
    console.error(`加载第 ${page} 页失败:`, error);
    container.innerHTML = `
      <div class="incomplete-empty">
        <p style="color: #ef4444;">加载失败，请重试</p>
      </div>
    `;
  }
}

function displayIncompleteSubscriptions(page) {
  const container = document.getElementById('incompleteSubscriptions');
  const pagination = document.getElementById('incompletePagination');
  
  // 确保 perPage 已经计算过
  if (incompletePerPage === 20) {
    incompletePerPage = calculateIncompleteItemsPerPage();
  }
  
  // 检查该页数据是否已加载
  const startIndex = (page - 1) * incompletePerPage;
  const endIndex = startIndex + incompletePerPage;
  const pageData = allIncompleteSubscriptions.slice(startIndex, endIndex);
  
  // 检查是否有数据或者是否有 null 占位符
  const hasData = pageData.length > 0 && pageData.some(item => item !== null);
  
  if (!hasData) {
    loadIncompletePage(page);
    return;
  }
  
  // 过滤掉 null 值
  const validPageData = pageData.filter(item => item !== null);
  
  if (validPageData.length === 0) {
    container.innerHTML = `
      <div class="incomplete-empty">
        <svg class="incomplete-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"></path>
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"></path>
        </svg>
        <p>太棒了！所有订阅都已完成 🎉</p>
      </div>
    `;
    return;
  }
  
  currentIncompletePage = page;
  
  container.innerHTML = validPageData.map(sub => {
    const posterUrl = sub.poster || '/256.webp';
    const progressPercent = sub.progress || 0;
    const isMovie = sub.mediaType === 'movie';
    
    // 状态图标
    const statusIcon = {
      'incomplete': '<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
      'ongoing': '<path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
      'pending': '<path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
      'complete': '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>',
      'unknown': '<path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>'
    }[sub.status] || '<path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>';
    
    return `
      <div class="incomplete-item">
        <img src="${posterUrl}" class="incomplete-poster" alt="${escapeHtml(sub.title)}" loading="lazy" onerror="this.src='/256.webp'">
        <div class="incomplete-info">
          <div class="incomplete-content">
            <div class="incomplete-title">${escapeHtml(sub.title)}</div>
            ${isMovie ? `
              <div class="incomplete-stats">
                <div class="incomplete-stat">
                  <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"></path>
                  </svg>
                  <span>类型: <span class="incomplete-stat-value">电影</span></span>
                </div>
                ${sub.year ? `
                  <div class="incomplete-stat">
                    <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                    <span>年份: <span class="incomplete-stat-value">${sub.year}</span></span>
                  </div>
                ` : ''}
                <div class="incomplete-stat">
                  <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path>
                  </svg>
                  <span>评分: <span class="incomplete-stat-value" style="color: ${parseFloat(sub.rating) >= 7 ? '#10b981' : parseFloat(sub.rating) >= 5 ? '#fbbf24' : '#ef4444'};">${sub.rating}</span></span>
                </div>
                <div class="incomplete-stat">
                  <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  <span>状态: <span class="incomplete-stat-value" style="color: ${sub.status === 'complete' ? '#10b981' : '#ef4444'};">${sub.status === 'complete' ? '已入库' : '未入库'}</span></span>
                </div>
              </div>
            ` : `
              <div class="incomplete-stats">
                ${sub.year ? `
                  <div class="incomplete-stat">
                    <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                    <span>年份: <span class="incomplete-stat-value">${sub.year}</span></span>
                  </div>
                ` : ''}
                <div class="incomplete-stat">
                  <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"></path>
                  </svg>
                  <span>评分: <span class="incomplete-stat-value" style="color: ${parseFloat(sub.rating) >= 7 ? '#10b981' : parseFloat(sub.rating) >= 5 ? '#fbbf24' : '#ef4444'};">${sub.rating}</span></span>
                </div>
                <div class="incomplete-stat">
                  <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"></path>
                  </svg>
                  <span>已入库: <span class="incomplete-stat-value">${sub.subscribedEpisodes}</span> 集</span>
                </div>
                <div class="incomplete-stat">
                  <svg class="incomplete-stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  <span>总集数: <span class="incomplete-stat-value">${sub.tmdbTotalEpisodes}</span> 集</span>
                </div>
              </div>
            `}
            ${sub.tmdbTotalEpisodes > 0 && !isMovie ? `
              <div class="incomplete-progress">
                <div class="incomplete-progress-bar">
                  <div class="incomplete-progress-fill" style="width: ${progressPercent}%"></div>
                </div>
              </div>
            ` : ''}
          </div>
          <span class="incomplete-status ${sub.status}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              ${statusIcon}
            </svg>
            ${sub.statusText}
          </span>
        </div>
      </div>
    `;
  }).join('');
  
  // 更新分页
  updateIncompletePagination(page);
}

function updateIncompletePagination(currentPage) {
  const pagination = document.getElementById('incompletePagination');
  // 使用全局的 incompletePerPage 值，确保分页一致
  const perPage = incompletePerPage;
  const totalPages = Math.ceil(incompleteTotalCount / perPage);
  
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }
  
  // 确保当前页不超过总页数
  if (currentPage > totalPages) {
    console.warn(`⚠️  当前页 ${currentPage} 超过总页数 ${totalPages}，重置到第一页`);
    displayIncompleteSubscriptions(1);
    return;
  }
  
  let html = '<div class="pagination">';
  
  // 上一页
  if (currentPage > 1) {
    html += `<button class="page-btn" onclick="changeIncompletePage(${currentPage - 1})">上一页</button>`;
  }
  
  // 页码
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  
  if (startPage > 1) {
    html += `<button class="page-btn" onclick="changeIncompletePage(1)">1</button>`;
    if (startPage > 2) html += '<span class="page-dots">...</span>';
  }
  
  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      html += `<button class="page-btn active">${i}</button>`;
    } else {
      html += `<button class="page-btn" onclick="changeIncompletePage(${i})">${i}</button>`;
    }
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="page-dots">...</span>';
    html += `<button class="page-btn" onclick="changeIncompletePage(${totalPages})">${totalPages}</button>`;
  }
  
  // 下一页
  if (currentPage < totalPages) {
    html += `<button class="page-btn" onclick="changeIncompletePage(${currentPage + 1})">下一页</button>`;
  }
  
  html += '</div>';
  pagination.innerHTML = html;
}

function changeIncompletePage(page) {
  displayIncompleteSubscriptions(page);
  
  // 滚动到未完成订阅区域
  const section = document.querySelector('.incomplete-section');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// 刷新订阅数据
async function refreshIncompleteSubscriptions() {
  const btn = document.querySelector('.refresh-btn');
  const svg = btn?.querySelector('svg');
  
  // 添加加载状态
  if (btn) {
    btn.disabled = true;
    btn.style.cursor = 'not-allowed';
    btn.style.opacity = '0.7';
  }
  if (svg) {
    svg.style.animation = 'rotate 1s linear infinite';
  }
  
  try {
    // 重新加载
    allIncompleteSubscriptions = [];
    await loadIncompleteSubscriptions(true);
  } finally {
    // 恢复按钮状态
    if (btn) {
      btn.disabled = false;
      btn.style.cursor = 'pointer';
      btn.style.opacity = '1';
    }
    if (svg) {
      svg.style.animation = '';
    }
  }
}

// 更新分页按钮
function updatePagination(type, currentPage, totalPages) {
  const paginationId = type === 'movies' ? 'moviesPagination' : 'tvPagination';
  const pagination = document.getElementById(paginationId);
  
  if (!pagination || totalPages <= 1) {
    if (pagination) pagination.innerHTML = '';
    return;
  }
  
  let html = '<div class="pagination">';
  
  // 上一页
  if (currentPage > 1) {
    html += `<button class="page-btn" onclick="changePage('${type}', ${currentPage - 1})">上一页</button>`;
  }
  
  // 页码
  const maxButtons = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  
  if (startPage > 1) {
    html += `<button class="page-btn" onclick="changePage('${type}', 1)">1</button>`;
    if (startPage > 2) html += '<span class="page-dots">...</span>';
  }
  
  for (let i = startPage; i <= endPage; i++) {
    if (i === currentPage) {
      html += `<button class="page-btn active">${i}</button>`;
    } else {
      html += `<button class="page-btn" onclick="changePage('${type}', ${i})">${i}</button>`;
    }
  }
  
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) html += '<span class="page-dots">...</span>';
    html += `<button class="page-btn" onclick="changePage('${type}', ${totalPages})">${totalPages}</button>`;
  }
  
  // 下一页
  if (currentPage < totalPages) {
    html += `<button class="page-btn" onclick="changePage('${type}', ${currentPage + 1})">下一页</button>`;
  }
  
  html += '</div>';
  pagination.innerHTML = html;
}

// 切换页码
function changePage(type, page) {
  if (type === 'movies') {
    loadTrending(page, currentTVPage);
  } else {
    loadTrending(currentMoviePage, page);
  }
  
  // 滚动到对应区域
  const section = type === 'movies' ? trendingMovies : trendingTV;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function displayMovies(movies, container) {
  if (!movies || movies.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div><div style="color: #9ca3af;">暂无数据</div></div>';
    return;
  }

  container.innerHTML = movies.map(movie => {
    const requested = movie.requested || false;
    const mediaType = container.id === 'trendingMovies' ? 'movie' : 'tv';
    // 使用更小的图片尺寸以加快加载
    const posterUrl = movie.poster ? movie.poster.replace('/w500/', '/w342/') : null;
    
    if (movie.inLibrary) {
      return `
        <div class="movie-card">
          <div class="movie-poster-wrapper">
            ${posterUrl ? `<img src="${posterUrl}" class="movie-poster" alt="${escapeHtml(movie.title)}" loading="lazy">` : ''}
            <div class="movie-rating">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              ${movie.rating}
            </div>
          </div>
          <div class="movie-info">
            <div class="movie-title">${escapeHtml(movie.title)}</div>
            <div class="movie-footer">
              <span class="movie-year">${movie.year || '未知'}</span>
              <button class="subscribe-icon-btn owned" disabled title="已拥有">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <path d="M2 7L5.5 10.5L12 3.5" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    } else if (requested) {
      return `
        <div class="movie-card">
          <div class="movie-poster-wrapper">
            ${posterUrl ? `<img src="${posterUrl}" class="movie-poster" alt="${escapeHtml(movie.title)}" loading="lazy">` : ''}
            <div class="movie-rating">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              ${movie.rating}
            </div>
          </div>
          <div class="movie-info">
            <div class="movie-title">${escapeHtml(movie.title)}</div>
            <div class="movie-footer">
              <span class="movie-year">${movie.year || '未知'}</span>
              <button class="subscribe-icon-btn requested" disabled title="已请求">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="#fbbf24" stroke-width="1.5"/>
                  <path d="M7 3.5V7H10" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="movie-card">
          <div class="movie-poster-wrapper">
            ${posterUrl ? `<img src="${posterUrl}" class="movie-poster" alt="${escapeHtml(movie.title)}" loading="lazy">` : ''}
            <div class="movie-rating">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
              ${movie.rating}
            </div>
          </div>
          <div class="movie-info">
            <div class="movie-title">${escapeHtml(movie.title)}</div>
            <div class="movie-footer">
              <span class="movie-year">${movie.year || '未知'}</span>
              <button class="subscribe-icon-btn" onclick="event.stopPropagation(); selectMovie(${movie.id}, '${escapeHtml(movie.title)}', '${mediaType}', this)" title="订阅">
                <span class="plus-icon"></span>
              </button>
            </div>
          </div>
        </div>
      `;
    }
  }).join('');
  
  // 不再需要隐藏卡片，因为已经按需加载了正确数量
}

// 限制只显示指定行数
function limitToTwoRows(container) {
  // 使用 requestAnimationFrame 确保在渲染前执行
  requestAnimationFrame(() => {
    const cards = container.querySelectorAll('.movie-card');
    if (cards.length === 0) return;
    
    // 获取所有卡片的位置
    const cardPositions = Array.from(cards).map(card => ({
      card,
      top: card.offsetTop
    }));
    
    // 按 top 值分组，找出有多少行
    const rows = [];
    cardPositions.forEach(({ card, top }) => {
      let rowIndex = rows.findIndex(row => Math.abs(row.top - top) < 5); // 允许5px误差
      if (rowIndex === -1) {
        rows.push({ top, cards: [card] });
      } else {
        rows[rowIndex].cards.push(card);
      }
    });
    
    // 根据屏幕宽度决定显示几行
    let maxRows = 2; // 默认2行
    if (window.innerWidth <= 768) {
      maxRows = 4; // 平板和手机显示4行
    }
    if (window.innerWidth <= 480) {
      maxRows = 5; // 小手机显示5行
    }
    
    // 按 top 值排序
    rows.sort((a, b) => a.top - b.top);
    
    // 使用 visibility 和 opacity 隐藏，避免闪烁
    rows.forEach((row, index) => {
      if (index >= maxRows) {
        row.cards.forEach(card => {
          card.style.visibility = 'hidden';
          card.style.opacity = '0';
          card.style.position = 'absolute';
          card.style.pointerEvents = 'none';
        });
      } else {
        row.cards.forEach(card => {
          card.style.visibility = '';
          card.style.opacity = '';
          card.style.position = '';
          card.style.pointerEvents = '';
        });
      }
    });
  });
}

// 窗口大小改变时重新加载（防抖）
let resizeTimeout;
let lastWidth = window.innerWidth;
let lastHeight = window.innerHeight;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;
    
    // 只有宽度变化超过阈值时才重新加载（避免移动端地址栏导致的频繁触发）
    const widthChanged = Math.abs(currentWidth - lastWidth) > 50;
    const heightChanged = Math.abs(currentHeight - lastHeight) > 100;
    
    // 移动端：只在宽度明显变化时重新加载（忽略地址栏引起的高度变化）
    // 桌面端：宽度或高度变化都重新加载
    const isMobile = currentWidth < 768;
    const shouldReload = isMobile ? widthChanged : (widthChanged || heightChanged);
    
    if (shouldReload) {
      lastWidth = currentWidth;
      lastHeight = currentHeight;
      
      loadTrending(currentMoviePage, currentTVPage);
      
      // 重新计算并显示未完成订阅（如果已加载）
      if (allIncompleteSubscriptions.length > 0) {
        const oldPerPage = incompletePerPage;
        incompletePerPage = calculateIncompleteItemsPerPage();
        
        // 只有当每页数量改变时才需要重新计算页码
        if (oldPerPage !== incompletePerPage) {
          const totalPages = Math.ceil(incompleteTotalCount / incompletePerPage);
          // 如果当前页超出新的总页数，则调整到最后一页
          if (currentIncompletePage > totalPages) {
            currentIncompletePage = Math.max(1, totalPages);
          }
        }
        
        // 保持当前页码，不重置到第一页
        displayIncompleteSubscriptions(currentIncompletePage);
      }
    }
  }, 500); // 500ms 防抖
});

searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  
  clearTimeout(searchTimeout);
  
  if (query.length < 1) {
    suggestions.classList.remove('show');
    return;
  }
  
  searchTimeout = setTimeout(() => searchMovies(query), 300);
});

// 移动端输入框焦点处理
searchInput.addEventListener('focus', () => {
  // 延迟执行，等待键盘弹出
  setTimeout(() => {
    // 将搜索框滚动到可视区域
    searchInput.scrollIntoView({ 
      behavior: 'smooth', 
      block: 'center' 
    });
  }, 300);
});

// 点击搜索框外部时失去焦点
document.addEventListener('click', (e) => {
  if (!searchInput.contains(e.target) && !suggestions.contains(e.target)) {
    suggestions.classList.remove('show');
  }
});

async function searchMovies(query) {
  try {
    suggestions.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    suggestions.classList.add('show');
    
    const response = await fetchWithAuth(`/api/search?query=${encodeURIComponent(query)}`);
    const data = await response.json();
    
    if (data.results && data.results.length > 0) {
      displaySuggestions(data.results);
    } else {
      suggestions.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div><div>没有找到相关影片，换个关键词试试</div></div>';
    }
  } catch (error) {
    console.error('搜索错误:', error);
    suggestions.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></div><div>搜索失败，请重试</div></div>';
  }
}

function displaySuggestions(results) {
  suggestions.innerHTML = results.map(item => {
    const requested = item.requested || false;
    const inLibrary = item.inLibrary || false;
    
    let buttonHtml = '';
    let statusClass = '';
    
    if (inLibrary) {
      statusClass = 'owned';
      buttonHtml = `
        <button class="suggestion-btn owned" disabled title="已拥有">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <path d="M2 7L5.5 10.5L12 3.5" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      `;
    } else if (requested) {
      statusClass = 'requested';
      buttonHtml = `
        <button class="suggestion-btn requested" disabled title="已请求">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="#fbbf24" stroke-width="1.5"/>
            <path d="M7 3.5V7H10" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      `;
    } else {
      buttonHtml = `
        <button class="suggestion-btn" 
                data-movie='${JSON.stringify(item).replace(/'/g, "&apos;")}' 
                onclick="event.stopPropagation(); selectMovieFromButton(this)" 
                title="订阅">
          <span class="plus-icon"></span>
        </button>
      `;
    }
    
    return `
      <div class="suggestion-item ${statusClass}">
        ${item.poster ? `<img src="${item.poster}" class="suggestion-poster" alt="${escapeHtml(item.title)}" onerror="this.style.display='none'">` : '<div class="suggestion-poster"></div>'}
        <div class="suggestion-info">
          <div class="suggestion-title">${escapeHtml(item.title)}</div>
          <div class="suggestion-meta">
            <span class="badge">${item.type}</span>
            ${item.year ? `<span class="year">${item.year}</span>` : ''}
          </div>
        </div>
        ${buttonHtml}
      </div>
    `;
  }).join('');
}

async function selectMovieFromButton(buttonElement) {
  try {
    const movieData = JSON.parse(buttonElement.getAttribute('data-movie'));
    // 使用 tmdbData 如果存在，否则使用原始数据
    const fullData = movieData.tmdbData || movieData;
    await selectMovie(movieData.id, movieData.title, movieData.mediaType, buttonElement, fullData);
  } catch (error) {
    console.error('解析电影数据失败:', error);
    alert('订阅失败，请重试');
  }
}

async function selectMovie(id, title, mediaType, buttonElement, movieData = null) {
  // 显示加载状态
  buttonElement.disabled = true;
  buttonElement.classList.add('loading');
  const originalContent = buttonElement.innerHTML;
  buttonElement.innerHTML = '<div class="spinner-small"></div>';

  try {
    const response = await fetchWithAuth('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, mediaType, movieData }),
    });

    const data = await response.json();

    if (data.success) {
      // 变成黄色已请求状态
      buttonElement.classList.remove('loading');
      buttonElement.classList.add('requested');
      buttonElement.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" stroke="#fbbf24" stroke-width="1.5"/>
          <path d="M7 3.5V7H10" stroke="#fbbf24" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      `;
      
      // 更新 title 显示链接数量
      if (data.hdhiveLinksCount > 0) {
        buttonElement.title = `已请求 (${data.hdhiveLinksCount} 个可用链接)`;
      } else {
        buttonElement.title = '已请求';
      }
      
      // 如果是电视剧或电影订阅，触发轻量级刷新以添加到未完成订阅列表
      if (mediaType === 'tv' || mediaType === 'movie') {
        console.log(`📺 新增${mediaType === 'tv' ? '电视剧' : '电影'}订阅，触发轻量级刷新...`);
        // 延迟2秒后刷新，给 MediaHelper 时间处理订阅
        setTimeout(() => {
          refreshIncompleteSubscriptions();
        }, 2000);
        
        // 如果开启了新订阅自动查找
        if (data.autoSearchTriggered) {
          console.log(`🔍 新订阅自动查找已触发，将监控 MediaHelper 执行状态...`);
        }
      }
      
      // 重新加载统计和热门内容（保持当前页码）
      loadEmbyStats();
      loadTrending(currentMoviePage, currentTVPage);
      loadRecentRequests();
    } else {
      throw new Error(data.error || '发送失败');
    }
  } catch (error) {
    // 显示错误状态
    console.error('订阅失败:', error);
    console.error('错误详情:', error.message);
    
    buttonElement.classList.remove('loading');
    buttonElement.classList.add('error');
    buttonElement.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    `;
    
    const errorMsg = error.message || '未知错误';
    buttonElement.title = '订阅失败: ' + errorMsg;
    
    // 显示错误提示
    console.error(`订阅《${title}》失败:`, errorMsg);
    
    // 3秒后恢复原状
    setTimeout(() => {
      buttonElement.disabled = false;
      buttonElement.classList.remove('error');
      buttonElement.innerHTML = originalContent;
      buttonElement.title = '订阅';
    }, 3000);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) {
    suggestions.classList.remove('show');
  }
});

// 键盘快捷键
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    suggestions.classList.remove('show');
    searchInput.blur();
  }
  if (e.key === '/' && document.activeElement !== searchInput) {
    e.preventDefault();
    searchInput.focus();
  }
});


// 初始化入库趋势图表
let libraryChart = null;

async function initChart() {
  const ctx = document.getElementById('libraryChart');
  const skeleton = document.getElementById('chartSkeleton');
  if (!ctx) return;
  
  try {
    // 从 API 获取真实数据
    const response = await fetchWithAuth('/api/emby/trends');
    const data = await response.json();
    
    // 生成日期标签
    const labels = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }));
    }
    
    const movieData = data.movies.length > 0 ? data.movies : [0, 0, 0, 0, 0, 0, 0];
    const tvData = data.tv.length > 0 ? data.tv : [0, 0, 0, 0, 0, 0, 0];
    
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const textColor = isDark ? '#9ca3af' : '#6b7280';
  const gridColor = isDark ? 'rgba(168, 85, 247, 0.1)' : 'rgba(168, 85, 247, 0.15)';
  
  libraryChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '电影',
          data: movieData,
          borderColor: 'rgba(251, 146, 60, 0.7)',
          backgroundColor: 'rgba(251, 146, 60, 0.08)',
          tension: 0.4,
          fill: true,
          borderWidth: 1.5,
          pointRadius: 2,
          pointHoverRadius: 4,
        },
        {
          label: '剧集',
          data: tvData,
          borderColor: 'rgba(139, 92, 246, 0.7)',
          backgroundColor: 'rgba(139, 92, 246, 0.08)',
          tension: 0.4,
          fill: true,
          borderWidth: 1.5,
          pointRadius: 2,
          pointHoverRadius: 4,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          align: 'end',
          labels: {
            color: textColor,
            usePointStyle: true,
            padding: 10,
            font: {
              size: 11
            }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: isDark ? 'rgba(26, 26, 46, 0.9)' : 'rgba(255, 255, 255, 0.9)',
          titleColor: textColor,
          bodyColor: textColor,
          borderColor: 'rgba(168, 85, 247, 0.3)',
          borderWidth: 1,
          padding: 10,
          displayColors: true,
        }
      },
      scales: {
        x: {
          grid: {
            color: gridColor,
            drawBorder: false,
          },
          ticks: {
            color: textColor,
            font: {
              size: 10
            }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            color: gridColor,
            drawBorder: false,
          },
          ticks: {
            color: textColor,
            font: {
              size: 10
            },
            stepSize: 5
          }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
  
    // 图表加载完成，隐藏骨架屏，显示图表
    if (skeleton) skeleton.style.display = 'none';
    ctx.style.display = 'block';
  } catch (error) {
    console.error('加载图表数据失败:', error);
    // 加载失败也隐藏骨架屏
    if (skeleton) skeleton.style.display = 'none';
  }
}

// 页面加载后初始化图表
setTimeout(initChart, 100);

// 主题切换时更新图表颜色
themeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    setTimeout(() => {
      if (libraryChart) {
        libraryChart.destroy();
        initChart();
      }
    }, 100);
  });
});


// 注册 Service Worker (PWA 支持)
// 开发时可以注释掉这段代码来禁用 Service Worker
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('Service Worker 注册成功:', registration.scope);
      })
      .catch(error => {
        console.log('Service Worker 注册失败:', error);
      });
  });
}

// PWA 安装提示
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  // 阻止默认的安装提示
  e.preventDefault();
  deferredPrompt = e;
  
  // 可以在这里显示自定义的安装按钮
  console.log('PWA 可以安装');
});

// 监听安装完成
window.addEventListener('appinstalled', () => {
  console.log('PWA 已安装');
  deferredPrompt = null;
});


// 移动端菜单控制
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileMenu = document.getElementById('mobileMenu');
const mobileEmbyLink = document.getElementById('mobileEmbyLink');

if (mobileMenuBtn && mobileMenu) {
  // 切换菜单显示
  mobileMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    mobileMenu.classList.toggle('show');
  });

  // 点击页面其他地方关闭菜单
  document.addEventListener('click', (e) => {
    if (!mobileMenu.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
      mobileMenu.classList.remove('show');
    }
  });

  // 同步 Emby 链接
  if (mobileEmbyLink) {
    mobileEmbyLink.href = embyLink.href;
  }

  // 点击菜单项后关闭菜单
  const menuItems = mobileMenu.querySelectorAll('.mobile-menu-item:not(.mobile-menu-dropdown)');
  menuItems.forEach(item => {
    item.addEventListener('click', () => {
      setTimeout(() => {
        mobileMenu.classList.remove('show');
      }, 200);
    });
  });
}


// Footer 链接和数据同步
const footerEmbyLink = document.getElementById('footerEmbyLink');
const footerStatusLink = document.getElementById('footerStatusLink');
const footerTodayRequests = document.getElementById('footerTodayRequests');
const footerMovieCount = document.getElementById('footerMovieCount');
const footerSeriesCount = document.getElementById('footerSeriesCount');

// 同步 Emby 链接
if (footerEmbyLink && embyLink) {
  footerEmbyLink.href = embyLink.href;
}

// Footer 状态链接点击事件 - 显示综合状态
if (footerStatusLink) {
  footerStatusLink.addEventListener('click', async (e) => {
    e.preventDefault();
    await checkServicesStatus();
    
    const embyDot = document.getElementById('embyStatusDot');
    const mediahelperDot = document.getElementById('mediahelperStatusDot');
    const embyOnline = embyDot && embyDot.classList.contains('online');
    const mediahelperOnline = mediahelperDot && mediahelperDot.classList.contains('online');
    
    let message = '服务状态：\n\n';
    message += embyOnline ? '✅ Emby 服务正常运行\n' : '❌ Emby 服务离线\n';
    message += mediahelperOnline ? '✅ MediaHelper 服务正常运行' : '❌ MediaHelper 服务离线';
    alert(message);
  });
}

// 更新 Footer 统计数据的函数
function updateFooterStats() {
  if (footerTodayRequests) {
    footerTodayRequests.textContent = totalRequests.textContent;
  }
  if (footerMovieCount) {
    footerMovieCount.textContent = movieCount.textContent;
  }
  if (footerSeriesCount) {
    footerSeriesCount.textContent = seriesCount.textContent;
  }
}

// 登出功能
const logoutBtn = document.getElementById('logoutBtn');
const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

async function handleLogout(e) {
  e.preventDefault();
  
  try {
    await fetchWithAuth('/api/logout', { method: 'POST' });
  } catch (error) {
    console.error('登出错误:', error);
  } finally {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', handleLogout);
}

if (mobileLogoutBtn) {
  mobileLogoutBtn.addEventListener('click', handleLogout);
}


// HDHive 批量查找日志
let currentLogTab = 'batch'; // 当前显示的日志标签页

function toggleLogPanel() {
  const panel = document.getElementById('logPanel');
  panel.classList.toggle('active');
  
  // 打开面板时加载对应标签页的日志
  if (panel.classList.contains('active')) {
    // 重置计数器，强制重新渲染
    lastAutoSearchLogCount = -1;
    lastAutoSearchTaskCount = -1;
    lastBatchSearchLogCount = -1;
    lastBatchSearchProgress = -1;
    lastBatchSearchCurrent = null;
    
    loadLogsByTab(currentLogTab);
    
    // 如果是新订阅监控标签页，启动自动刷新
    if (currentLogTab === 'auto') {
      if (autoSearchLogInterval) {
        clearInterval(autoSearchLogInterval);
      }
      let tickCount = 0;
      autoSearchLogInterval = setInterval(() => {
        if (currentLogTab === 'auto') {
          tickCount++;
          // 每秒更新倒计时显示
          updateCountdownDisplay();
          
          // 每3秒重新加载完整数据
          if (tickCount >= 3) {
            tickCount = 0;
            loadAutoSearchNewLogs();
          }
        }
      }, 1000);
    }
  } else {
    // 关闭面板时停止自动刷新
    if (autoSearchLogInterval) {
      clearInterval(autoSearchLogInterval);
      autoSearchLogInterval = null;
    }
  }
}

// 切换日志标签页
function switchLogTab(tab) {
  console.log('切换标签页:', tab, '当前标签页:', currentLogTab);
  currentLogTab = tab;
  console.log('切换后标签页:', currentLogTab);
  
  // 更新标签页样式
  document.querySelectorAll('.log-tab').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // 根据tab参数直接设置active
  const tabs = document.querySelectorAll('.log-tab');
  if (tab === 'batch' && tabs[0]) {
    tabs[0].classList.add('active');
  } else if (tab === 'auto' && tabs[1]) {
    tabs[1].classList.add('active');
  }
  
  // 停止自动刷新
  if (autoSearchLogInterval) {
    clearInterval(autoSearchLogInterval);
    autoSearchLogInterval = null;
  }
  
  // 重置计数器，强制重新渲染
  lastAutoSearchLogCount = -1; // 设置为-1强制重新渲染
  lastAutoSearchTaskCount = -1;
  lastBatchSearchLogCount = -1;
  lastBatchSearchProgress = -1;
  lastBatchSearchCurrent = null;
  
  // 加载对应的日志
  loadLogsByTab(tab);
  
  // 如果切换到新订阅监控标签页，启动自动刷新
  if (tab === 'auto') {
    let tickCount = 0;
    autoSearchLogInterval = setInterval(() => {
      if (currentLogTab === 'auto') {
        tickCount++;
        // 每秒更新倒计时显示
        updateCountdownDisplay();
        
        // 每3秒重新加载完整数据
        if (tickCount >= 3) {
          tickCount = 0;
          loadAutoSearchNewLogs();
        }
      }
    }, 1000); // 每秒执行一次
  }
}

// 更新倒计时显示（不重新加载数据）
function updateCountdownDisplay() {
  // 更新新订阅检测倒计时
  const checkCountdownEl = document.getElementById('checkCountdown');
  if (checkCountdownEl) {
    const currentText = checkCountdownEl.textContent;
    const parts = currentText.split(':');
    if (parts.length === 2) {
      let minutes = parseInt(parts[0]);
      let seconds = parseInt(parts[1]);
      
      // 倒计时减1秒
      if (seconds > 0) {
        seconds--;
      } else if (minutes > 0) {
        minutes--;
        seconds = 59;
      }
      
      checkCountdownEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }
  
  // 更新所有监控任务的倒计时
  const monitoringTasks = document.querySelectorAll('.monitoring-task');
  monitoringTasks.forEach(taskEl => {
    const infoDiv = taskEl.querySelector('.log-item-info');
    if (infoDiv) {
      const text = infoDiv.textContent;
      // 匹配 "下次检查: X:XX" 格式
      const match = text.match(/下次检查:\s*(\d+):(\d+)/);
      if (match) {
        let minutes = parseInt(match[1]);
        let seconds = parseInt(match[2]);
        
        // 倒计时减1秒
        if (seconds > 0) {
          seconds--;
        } else if (minutes > 0) {
          minutes--;
          seconds = 59;
        } else {
          // 倒计时到0，保持0:00
          minutes = 0;
          seconds = 0;
        }
        
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        const newText = text.replace(/下次检查:\s*\d+:\d+/, `下次检查: ${timeStr}`);
        infoDiv.textContent = newText;
      }
    }
  });
}

// 根据标签页加载日志
async function loadLogsByTab(tab) {
  const content = document.getElementById('logPanelContent');
  
  // 只在内容为空时显示加载中
  if (content.children.length === 0) {
    content.innerHTML = '<div class="log-empty">加载中...</div>';
  }
  
  if (tab === 'batch') {
    // 加载批量查找日志
    await loadBatchSearchLogs();
  } else if (tab === 'auto') {
    // 加载新订阅自动查找日志
    await loadAutoSearchNewLogs();
  }
}

// 加载批量查找日志
async function loadBatchSearchLogs() {
  const content = document.getElementById('logPanelContent');
  
  try {
    const response = await fetchWithAuth('/api/hdhive/batch-search/status');
    const data = await response.json();
    
    content.innerHTML = '';
    
    // 显示进度（如果任务正在运行）
    if (data.running && data.current) {
      const progressDiv = document.createElement('div');
      progressDiv.className = 'log-item info batch-progress-info';
      progressDiv.innerHTML = `
        <div class="log-item-title">正在查找: ${escapeHtml(data.current)}</div>
        <div class="log-item-info">进度: ${data.progress}/${data.total}</div>
      `;
      content.appendChild(progressDiv);
    }
    
    // 显示日志
    if (data.logs && data.logs.length > 0) {
      data.logs.forEach(log => {
        // 跳过 searching 状态的日志
        if (log.status === 'searching') {
          return;
        }
        
        const logTime = new Date(log.time);
        const timeStr = `${logTime.getHours().toString().padStart(2, '0')}:${logTime.getMinutes().toString().padStart(2, '0')}:${logTime.getSeconds().toString().padStart(2, '0')}`;
        
        const logItem = document.createElement('div');
        logItem.className = `log-item ${log.status}`;
        logItem.innerHTML = `
          <div class="log-item-title">${escapeHtml(log.title)}</div>
          <div class="log-item-info">${escapeHtml(log.message)}</div>
          <div class="log-item-time">${timeStr}</div>
        `;
        content.appendChild(logItem); // 使用 appendChild 保持服务器端的顺序
      });
    }
    
    if (content.children.length === 0) {
      content.innerHTML = '<div class="log-empty">暂无日志</div>';
    }
  } catch (error) {
    console.error('加载批量查找日志失败:', error);
    content.innerHTML = '<div class="log-empty">加载失败</div>';
  }
}

// 加载新订阅自动查找日志
let autoSearchLogInterval = null;
let lastAutoSearchLogCount = 0;
let lastAutoSearchTaskCount = 0;

async function loadAutoSearchNewLogs() {
  console.log('开始加载新订阅监控日志');
  const content = document.getElementById('logPanelContent');
  
  try {
    // 获取监控任务状态
    const statusResponse = await fetchWithAuth('/api/settings/auto-search-new/status');
    const statusData = await statusResponse.json();
    console.log('新订阅监控状态数据:', statusData);
    
    // 获取日志
    const logsResponse = await fetchWithAuth('/api/settings/auto-search-new/logs');
    const logsData = await logsResponse.json();
    console.log('新订阅监控日志数据:', logsData);
    
    // 检查是否有变化
    const currentLogCount = logsData.logs?.length || 0;
    const currentTaskCount = statusData.tasks?.length || 0;
    const hasChanged = currentLogCount !== lastAutoSearchLogCount || 
                       currentTaskCount !== lastAutoSearchTaskCount;
    
    console.log('日志变化检查:', { currentLogCount, lastAutoSearchLogCount, currentTaskCount, lastAutoSearchTaskCount, hasChanged });
    
    // 如果没有变化，只更新倒计时，不重新渲染
    if (!hasChanged && content.children.length > 0) {
      console.log('日志无变化，只更新倒计时');
      // 只更新检测倒计时的数值
      if (statusData.nextSubscriptionCheck && statusData.nextSubscriptionCheck.enabled) {
        const checkCountdownEl = document.getElementById('checkCountdown');
        if (checkCountdownEl) {
          const remainingSeconds = statusData.nextSubscriptionCheck.remainingSeconds || 0;
          const minutes = Math.floor(remainingSeconds / 60);
          const seconds = remainingSeconds % 60;
          const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
          checkCountdownEl.textContent = timeStr;
        }
      }
      
      // 更新监控任务的倒计时
      if (statusData.tasks && statusData.tasks.length > 0) {
        statusData.tasks.forEach((task, index) => {
          const taskElements = document.querySelectorAll('.monitoring-task');
          if (taskElements[index]) {
            const minutes = Math.floor(task.remainingSeconds / 60);
            const seconds = task.remainingSeconds % 60;
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            const infoDiv = taskElements[index].querySelector('.log-item-info');
            if (infoDiv) {
              infoDiv.textContent = `检查进度: ${task.checkCount}/${task.maxChecks} | 下次检查: ${timeStr}`;
            }
          }
        });
      }
      return;
    }
    
    // 有变化时才重新渲染
    console.log('日志有变化，重新渲染');
    lastAutoSearchLogCount = currentLogCount;
    lastAutoSearchTaskCount = currentTaskCount;
    
    content.innerHTML = '';
    
    // 显示新订阅检测倒计时
    if (statusData.nextSubscriptionCheck && statusData.nextSubscriptionCheck.enabled) {
      const checkInfo = document.createElement('div');
      checkInfo.className = 'log-refresh-info subscription-check-info';
      checkInfo.id = 'subscriptionCheckInfo';
      
      const remainingSeconds = statusData.nextSubscriptionCheck.remainingSeconds || 0;
      const minutes = Math.floor(remainingSeconds / 60);
      const seconds = remainingSeconds % 60;
      const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      checkInfo.innerHTML = `<span>🔍 下次检测新订阅: <span id="checkCountdown">${timeStr}</span></span>`;
      content.appendChild(checkInfo);
    }
    
    // 显示监控任务状态
    if (statusData.tasks && statusData.tasks.length > 0) {
      statusData.tasks.forEach(task => {
        const taskItem = document.createElement('div');
        taskItem.className = 'log-item info monitoring-task';
        
        const minutes = Math.floor(task.remainingSeconds / 60);
        const seconds = task.remainingSeconds % 60;
        const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        taskItem.innerHTML = `
          <div class="log-item-title">🔄 监控中: ${escapeHtml(task.title)}</div>
          <div class="log-item-info">检查进度: ${task.checkCount}/${task.maxChecks} | 下次检查: ${timeStr}</div>
        `;
        
        content.appendChild(taskItem);
      });
    }
    
    // 显示日志
    if (logsData.logs && logsData.logs.length > 0) {
      logsData.logs.forEach(log => {
        const logTime = new Date(log.timestamp);
        const timeStr = `${logTime.getHours().toString().padStart(2, '0')}:${logTime.getMinutes().toString().padStart(2, '0')}:${logTime.getSeconds().toString().padStart(2, '0')}`;
        addLogWithTime(log.title, log.info, log.type, timeStr);
      });
    }
    
    const hasCheckInfo = statusData.nextSubscriptionCheck?.enabled ? 1 : 0;
    const hasContent = (statusData.tasks?.length || 0) + (logsData.logs?.length || 0);
    
    if (hasContent === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'log-empty';
      emptyDiv.textContent = '暂无日志';
      content.appendChild(emptyDiv);
    }
  } catch (error) {
    console.error('加载自动查找日志失败:', error);
    content.innerHTML = '<div class="log-empty">加载失败</div>';
  }
}

// 添加带时间的日志
function addLogWithTime(title, info, type, timeStr) {
  const content = document.getElementById('logPanelContent');
  
  // 移除空状态
  const empty = content.querySelector('.log-empty');
  if (empty) {
    empty.remove();
  }
  
  const logItem = document.createElement('div');
  logItem.className = `log-item ${type}`;
  
  logItem.innerHTML = `
    <div class="log-item-title">${escapeHtml(title)}</div>
    <div class="log-item-info">${escapeHtml(info)}</div>
    <div class="log-item-time">${timeStr}</div>
  `;
  
  content.insertBefore(logItem, content.firstChild);
  
  // 限制日志数量
  const logs = content.querySelectorAll('.log-item');
  if (logs.length > 100) {
    logs[logs.length - 1].remove();
  }
}

// 点击日志面板外部关闭
document.addEventListener('click', function(event) {
  const panel = document.getElementById('logPanel');
  const logBtn = document.getElementById('showLogBtn');
  
  // 如果面板是打开的，且点击的不是面板内部或日志按钮
  if (panel && panel.classList.contains('active')) {
    if (!panel.contains(event.target) && !logBtn.contains(event.target)) {
      panel.classList.remove('active');
      // 停止轮询
      if (autoSearchLogInterval) {
        clearInterval(autoSearchLogInterval);
        autoSearchLogInterval = null;
      }
    }
  }
});

// 定期刷新日志（当面板打开时）
setInterval(() => {
  const panel = document.getElementById('logPanel');
  if (panel && panel.classList.contains('active')) {
    loadLogsByTab(currentLogTab);
  }
}, 10000); // 每10秒刷新一次

function addLog(title, info, type = 'info') {
  const content = document.getElementById('logPanelContent');
  
  // 移除空状态
  const empty = content.querySelector('.log-empty');
  if (empty) {
    empty.remove();
  }
  
  const logItem = document.createElement('div');
  logItem.className = `log-item ${type}`;
  
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
  
  logItem.innerHTML = `
    <div class="log-item-title">${escapeHtml(title)}</div>
    <div class="log-item-info">${escapeHtml(info)}</div>
    <div class="log-item-time">${timeStr}</div>
  `;
  
  content.insertBefore(logItem, content.firstChild);
  
  // 限制日志数量
  const logs = content.querySelectorAll('.log-item');
  if (logs.length > 50) {
    logs[logs.length - 1].remove();
  }
}

function clearLogs() {
  const content = document.getElementById('logPanelContent');
  content.innerHTML = '<div class="log-empty">暂无日志</div>';
}

// 定时任务面板
function toggleSchedulerPanel() {
  const panel = document.getElementById('schedulerPanel');
  panel.classList.toggle('active');
  
  // 打开时加载当前状态
  if (panel.classList.contains('active')) {
    loadSchedulerStatus();
  }
}

// 点击定时任务面板外部关闭
document.addEventListener('click', function(event) {
  const panel = document.getElementById('schedulerPanel');
  const schedulerBtn = document.getElementById('schedulerBtn');
  
  if (panel && panel.classList.contains('active')) {
    // 检查点击是否在面板内、导航按钮上、或者任务按钮上
    const isInsidePanel = panel.contains(event.target);
    const isSchedulerBtn = schedulerBtn && schedulerBtn.contains(event.target);
    const isTaskButton = event.target.closest('.task-run-btn') || event.target.closest('.task-stop-btn');
    
    if (!isInsidePanel && !isSchedulerBtn && !isTaskButton) {
      panel.classList.remove('active');
    }
  }
});

// 加载定时任务状态
async function loadSchedulerStatus() {
  try {
    const response = await fetch('/api/scheduler/status');
    const data = await response.json();
    
    const toggle = document.getElementById('autoSearchToggle');
    const statusBadge = document.getElementById('schedulerStatusBadge');
    const nextRun = document.getElementById('schedulerNextRun');
    
    toggle.checked = data.enabled;
    
    if (data.enabled) {
      statusBadge.textContent = '✓ 已启用';
      statusBadge.className = 'status-badge active';
    } else {
      statusBadge.textContent = '未启用';
      statusBadge.className = 'status-badge inactive';
    }
    
    if (data.enabled && data.nextRun) {
      const nextDate = new Date(data.nextRun);
      const now = new Date();
      const diff = nextDate - now;
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      
      if (days > 0) {
        nextRun.textContent = `${days}天${hours}小时后`;
      } else if (hours > 0) {
        nextRun.textContent = `${hours}小时后`;
      } else {
        nextRun.textContent = '即将运行';
      }
    } else {
      nextRun.textContent = '-';
    }
    
    // 加载新订阅自动查找状态
    const autoSearchNewResponse = await fetchWithAuth('/api/settings/auto-search-new');
    const autoSearchNewData = await autoSearchNewResponse.json();
    
    const autoSearchNewToggle = document.getElementById('autoSearchNewToggle');
    const autoSearchNewBadge = document.getElementById('autoSearchNewBadge');
    
    if (autoSearchNewToggle && autoSearchNewBadge) {
      autoSearchNewToggle.checked = autoSearchNewData.enabled;
      autoSearchNewBadge.textContent = autoSearchNewData.enabled ? '✓ 已启用' : '未启用';
      autoSearchNewBadge.className = autoSearchNewData.enabled ? 'status-badge active' : 'status-badge inactive';
    }
  } catch (error) {
    console.error('加载定时任务状态失败:', error);
  }
}

// 切换自动查找
async function toggleAutoSearch(enabled) {
  try {
    const response = await fetch('/api/scheduler/toggle', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ enabled })
    });
    
    const data = await response.json();
    
    if (data.success) {
      loadSchedulerStatus();
    } else {
      console.error('操作失败:', data.error);
      // 恢复开关状态
      document.getElementById('autoSearchToggle').checked = !enabled;
    }
  } catch (error) {
    console.error('切换定时任务失败:', error);
    // 恢复开关状态
    document.getElementById('autoSearchToggle').checked = !enabled;
  }
}

// 切换新订阅自动查找
async function toggleAutoSearchNew(enabled) {
  try {
    const response = await fetchWithAuth('/api/settings/auto-search-new', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ enabled })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 更新状态显示
      const badge = document.getElementById('autoSearchNewBadge');
      if (badge) {
        badge.textContent = enabled ? '✓ 已启用' : '未启用';
        badge.className = enabled ? 'status-badge active' : 'status-badge inactive';
      }
      console.log(`新订阅自动查找已${enabled ? '启用' : '禁用'}`);
    } else {
      console.error('操作失败:', data.error);
      // 恢复开关状态
      document.getElementById('autoSearchNewToggle').checked = !enabled;
    }
  } catch (error) {
    console.error('切换新订阅自动查找失败:', error);
    // 恢复开关状态
    document.getElementById('autoSearchNewToggle').checked = !enabled;
  }
}

// 立即运行任务
async function runTaskNow(event) {
  event.preventDefault();
  event.stopPropagation(); // 阻止事件冒泡
  
  // 检查是否已有任务在运行
  if (isTaskRunning) {
    console.log('已有任务在运行中');
    return;
  }
  
  try {
    // 调用批量查找（不关闭面板）
    await batchSearchHDHive();
    
  } catch (error) {
    console.error('立即运行失败:', error);
  }
}

// 更新"立即运行"按钮状态
function updateTaskRunButton() {
  const runBtn = document.querySelector('.task-run-btn');
  const stopBtn = document.querySelector('.task-stop-btn');
  
  if (!runBtn || !stopBtn) return;
  
  if (isTaskRunning) {
    // 隐藏运行按钮，显示停止按钮
    runBtn.style.display = 'none';
    stopBtn.style.display = 'inline-flex';
    stopBtn.disabled = false;
    stopBtn.style.opacity = '1';
    stopBtn.style.cursor = 'pointer';
    stopBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="6" width="12" height="12"></rect>
      </svg>
      <span>停止</span>
    `;
  } else {
    // 显示运行按钮，隐藏停止按钮
    runBtn.style.display = 'inline-flex';
    runBtn.disabled = false;
    runBtn.style.opacity = '1';
    runBtn.style.cursor = 'pointer';
    runBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>立即运行</span>
    `;
    stopBtn.style.display = 'none';
  }
}

// 停止任务
async function stopTaskNow(event) {
  event.preventDefault();
  event.stopPropagation(); // 阻止事件冒泡
  
  const btn = event.target.closest('.task-stop-btn');
  if (!btn) return;
  
  // 禁用按钮
  btn.disabled = true;
  btn.style.opacity = '0.5';
  btn.style.cursor = 'not-allowed';
  btn.querySelector('span').textContent = '停止中...';
  
  try {
    const response = await fetchWithAuth('/api/hdhive/batch-search/stop', {
      method: 'POST'
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 停止轮询
      if (batchSearchPollingInterval) {
        clearInterval(batchSearchPollingInterval);
        batchSearchPollingInterval = null;
      }
      
      isTaskRunning = false;
      updateTaskRunButton();
      
      // 清空日志
      clearLogs();
      
      console.log('任务已停止');
    } else {
      throw new Error(data.error || '停止失败');
    }
  } catch (error) {
    console.error('停止任务失败:', error);
    // 恢复按钮
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.querySelector('span').textContent = '停止';
  }
}

// 批量查找 HDHive 链接（使用后台任务）
async function batchSearchHDHive() {
  try {
    // 显示加载提示
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'log-item info';
    loadingMsg.innerHTML = `
      <div class="log-time">${new Date().toLocaleTimeString('zh-CN')}</div>
      <div class="log-content">
        <div class="log-title">正在获取所有订阅...</div>
      </div>
    `;
    const content = document.getElementById('logPanelContent');
    content.innerHTML = '';
    content.appendChild(loadingMsg);
    
    // 从后端获取所有订阅（不分页）
    const allSubsResponse = await fetchWithAuth('/api/incomplete-subscriptions?page=1&per_page=9999');
    if (!allSubsResponse.ok) {
      throw new Error('获取订阅列表失败');
    }
    const allSubsData = await allSubsResponse.json();
    const allSubscriptions = allSubsData.subscriptions || [];
    
    if (allSubscriptions.length === 0) {
      alert('没有订阅可以查找');
      return;
    }
    
    console.log(`📊 获取到 ${allSubscriptions.length} 个订阅，准备批量查找`);
    
    // 启动后台任务
    const response = await fetchWithAuth('/api/hdhive/batch-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscriptions: allSubscriptions })
    });
    
    const data = await response.json();
    
    if (data.success) {
      // 清空日志
      clearLogs();
      
      // 显示启动信息
      const startMsg = document.createElement('div');
      startMsg.className = 'log-item success';
      startMsg.innerHTML = `
        <div class="log-time">${new Date().toLocaleTimeString('zh-CN')}</div>
        <div class="log-content">
          <div class="log-title">批量查找已启动</div>
          <div class="log-message">共 ${data.total} 个订阅需要查找${data.skipped > 0 ? `，跳过 ${data.skipped} 个已完成` : ''}</div>
        </div>
      `;
      content.appendChild(startMsg);
      
      // 开始轮询任务状态（会设置 isTaskRunning = true 并更新按钮）
      startBatchSearchPolling();
    } else {
      throw new Error(data.error || '启动任务失败');
    }
  } catch (error) {
    console.error('启动批量查找失败:', error);
    alert('启动批量查找失败: ' + error.message);
  }
}

// 轮询批量查找任务状态
// 批量查找任务状态
let batchSearchPollingInterval = null;
let isTaskRunning = false;
let lastBatchSearchLogCount = 0; // 记录上次的日志数量

function startBatchSearchPolling() {
  if (batchSearchPollingInterval) {
    clearInterval(batchSearchPollingInterval);
  }
  
  isTaskRunning = true;
  lastBatchSearchLogCount = 0; // 重置日志计数
  console.log('🚀 开始轮询任务状态, isTaskRunning =', isTaskRunning);
  updateTaskRunButton(); // 更新按钮状态
  
  batchSearchPollingInterval = setInterval(async () => {
    try {
      const response = await fetchWithAuth('/api/hdhive/batch-search/status');
      const status = await response.json();
      
      // 更新日志
      updateBatchSearchLogs(status);
      
      // 如果任务完成，停止轮询
      if (!status.running) {
        clearInterval(batchSearchPollingInterval);
        batchSearchPollingInterval = null;
        isTaskRunning = false;
        lastBatchSearchLogCount = 0;
        console.log('✅ 任务完成, isTaskRunning =', isTaskRunning);
        updateTaskRunButton(); // 更新按钮状态
      }
    } catch (error) {
      console.error('获取任务状态失败:', error);
    }
  }, 1000); // 每秒更新一次
}

function updateBatchSearchLogs(status) {
  // 只在批量查找标签页时更新日志
  if (currentLogTab !== 'batch') {
    console.log('跳过批量查找日志更新，当前标签页:', currentLogTab);
    return;
  }
  
  const content = document.getElementById('logPanelContent');
  
  // 检查日志是否有变化（通过日志数量判断）
  const currentLogCount = status.logs?.length || 0;
  const hasLogChanged = currentLogCount !== lastBatchSearchLogCount;
  
  // 如果日志没变化，只更新进度显示
  if (!hasLogChanged && content.children.length > 0) {
    // 确保只有一个进度信息
    let progressDiv = content.querySelector('.batch-progress-info');
    
    if (status.running && status.current) {
      if (!progressDiv) {
        // 如果进度div不存在，创建它并插入到最前面
        progressDiv = document.createElement('div');
        progressDiv.className = 'log-item info batch-progress-info';
        content.insertBefore(progressDiv, content.firstChild);
      }
      
      // 更新进度信息
      progressDiv.innerHTML = `
        <div class="log-item-title">正在查找: ${escapeHtml(status.current)}</div>
        <div class="log-item-info">进度: ${status.progress}/${status.total}</div>
      `;
    } else if (progressDiv) {
      // 任务不在运行，移除进度div
      progressDiv.remove();
    }
    
    // 更新记录的进度
    lastBatchSearchProgress = status.progress;
    lastBatchSearchCurrent = status.current;
    
    return;
  }
  
  // 日志有变化时才重新渲染整个列表
  lastBatchSearchLogCount = currentLogCount;
  lastBatchSearchProgress = status.progress;
  lastBatchSearchCurrent = status.current;
  
  // 清空现有日志（包括旧的进度卡片）
  content.innerHTML = '';
  
  // 显示进度
  if (status.running && status.current) {
    const progressDiv = document.createElement('div');
    progressDiv.className = 'log-item info batch-progress-info';
    progressDiv.innerHTML = `
      <div class="log-item-title">正在查找: ${escapeHtml(status.current)}</div>
      <div class="log-item-info">进度: ${status.progress}/${status.total}</div>
    `;
    content.appendChild(progressDiv);
  }
  
  // 显示日志（过滤掉 searching 状态的日志，因为进度信息已经显示了）
  if (status.logs && status.logs.length > 0) {
    status.logs.forEach(log => {
      // 跳过 searching 状态的日志
      if (log.status === 'searching') {
        return;
      }
      
      const logItem = document.createElement('div');
      logItem.className = `log-item ${log.status}`;
      
      const time = new Date(log.time);
      const timeStr = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}:${time.getSeconds().toString().padStart(2, '0')}`;
      
      logItem.innerHTML = `
        <div class="log-item-title">${escapeHtml(log.title)}</div>
        <div class="log-item-info">${escapeHtml(log.message)}</div>
        <div class="log-item-time">${timeStr}</div>
      `;
      
      content.appendChild(logItem);
    });
  }
  
  if ((status.logs?.length || 0) === 0 && !status.running) {
    content.innerHTML = '<div class="log-empty">暂无日志</div>';
  }
}

// 用于跟踪批量查找状态变化
let lastBatchSearchProgress = -1;
let lastBatchSearchCurrent = null;

// 页面加载时检查是否有正在运行的任务
window.addEventListener('load', async () => {
  try {
    const response = await fetchWithAuth('/api/hdhive/batch-search/status');
    const status = await response.json();
    
    if (status.running) {
      // 有任务正在运行，开始轮询（不自动打开日志面板）
      isTaskRunning = true;
      
      const btn = document.getElementById('batchSearchBtn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner-small" style="display: inline-block; margin-right: 0.5rem;"></div>查找中...';
      }
      
      // 更新立即运行按钮状态
      updateTaskRunButton();
      
      startBatchSearchPolling();
    }
  } catch (error) {
    console.error('检查任务状态失败:', error);
  }
});
