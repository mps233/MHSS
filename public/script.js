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
document.documentElement.setAttribute('data-theme', savedTheme);

// 更新按钮状态
themeButtons.forEach(btn => {
  btn.classList.remove('active'); // 先移除所有 active
  if (btn.dataset.theme === savedTheme) {
    btn.classList.add('active');
  }
});

// 主题切换事件
themeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const theme = btn.dataset.theme;
    document.documentElement.setAttribute('data-theme', theme);
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
  loadRecentRequests()
]).catch(error => {
  console.error('加载页面数据失败:', error);
});

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
  const recentItems = requests.slice(0, 20); // 增加到20条
  
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

// 加载热门内容
async function loadTrending(moviePage = 1, tvPage = 1) {
  try {
    // 并行加载热门电影和电视剧
    const [moviesResponse, tvResponse] = await Promise.all([
      fetchWithAuth(`/api/trending/movies?page=${moviePage}`),
      fetchWithAuth(`/api/trending/tv?page=${tvPage}`)
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
    
    if (movie.inLibrary) {
      return `
        <div class="movie-card">
          <div class="movie-poster-wrapper">
            ${movie.poster ? `<img src="${movie.poster}" class="movie-poster" alt="${escapeHtml(movie.title)}" loading="lazy">` : ''}
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
            ${movie.poster ? `<img src="${movie.poster}" class="movie-poster" alt="${escapeHtml(movie.title)}" loading="lazy">` : ''}
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
            ${movie.poster ? `<img src="${movie.poster}" class="movie-poster" alt="${escapeHtml(movie.title)}" loading="lazy">` : ''}
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
  
  // 动态计算并隐藏超过2行的卡片
  limitToTwoRows(container);
}

// 限制只显示指定行数
function limitToTwoRows(container) {
  setTimeout(() => {
    const cards = container.querySelectorAll('.movie-card');
    if (cards.length === 0) return;
    
    // 先显示所有卡片，让 Grid 自然布局
    cards.forEach(card => card.style.display = '');
    
    // 等待布局完成后再计算
    requestAnimationFrame(() => {
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
      
      // 隐藏超过指定行数的卡片
      rows.forEach((row, index) => {
        if (index >= maxRows) {
          row.cards.forEach(card => card.style.display = 'none');
        }
      });
    });
  }, 100); // 等待DOM渲染完成
}

// 窗口大小改变时重新计算
window.addEventListener('resize', () => {
  limitToTwoRows(trendingMovies);
  limitToTwoRows(trendingTV);
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
      buttonElement.title = '已请求';
      
      // 重新加载统计和热门内容
      loadEmbyStats();
      loadTrending();
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
