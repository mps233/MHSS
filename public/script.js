const searchInput = document.getElementById('searchInput');
const suggestions = document.getElementById('suggestions');
const totalRequests = document.getElementById('totalRequests');
const movieCount = document.getElementById('movieCount');
const seriesCount = document.getElementById('seriesCount');
const trendingMovies = document.getElementById('trendingMovies');
const trendingTV = document.getElementById('trendingTV');
const embyLink = document.getElementById('embyLink');
const statusLink = document.getElementById('statusLink');
const statusIcon = statusLink.querySelector('.nav-icon svg');
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

// 加载 Emby 影片库统计
async function loadEmbyStats() {
  try {
    const response = await fetch('/api/emby/stats');
    const data = await response.json();
    
    if (data.total !== null) {
      movieCount.textContent = data.movies || '∞';
      seriesCount.textContent = data.series || '∞';
      statusIcon.style.color = '#10b981'; // 绿色表示在线
      
      // 设置 Emby 链接
      if (data.embyUrl) {
        embyLink.href = data.embyUrl;
      }
    } else {
      movieCount.textContent = '∞';
      seriesCount.textContent = '∞';
      statusIcon.style.color = '#ef4444'; // 红色表示离线
    }
    
    // 更新今日请求数
    if (data.todayRequests !== undefined) {
      updateRequestCount(data.todayRequests);
    }
  } catch (error) {
    console.error('加载 Emby 统计失败:', error);
    movieCount.textContent = '∞';
    seriesCount.textContent = '∞';
    statusIcon.style.color = '#ef4444'; // 红色表示离线
  }
}

// 状态链接点击事件
statusLink.addEventListener('click', (e) => {
  e.preventDefault();
  loadEmbyStats();
  const isOnline = statusIcon.style.color === 'rgb(16, 185, 129)';
  alert(isOnline ? '✅ 服务正常运行' : '❌ Emby 服务离线');
});

loadEmbyStats();
loadTrending(); // 页面加载时获取热门内容
loadRecentRequests(); // 加载最近请求

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
    const response = await fetch('/api/recent-requests');
    const data = await response.json();
    
    if (data.requests && data.requests.length > 0) {
      displayRecentCarousel(data.requests);
    }
  } catch (error) {
    console.error('加载最近请求失败:', error);
  }
}

function displayRecentCarousel(requests) {
  const recentItems = requests.slice(0, 20); // 增加到20条
  
  // 复制一份用于无缝循环
  const doubledItems = [...recentItems, ...recentItems];
  
  recentCarousel.innerHTML = doubledItems.map(item => {
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
    const totalItems = items.length / 2; // 因为复制了一份
    if (totalItems > 0) {
      startCarousel(totalItems, false); // 不重置索引，从当前位置继续
    }
  });
}

// 窗口大小改变时重新计算轮播
window.addEventListener('resize', () => {
  if (carouselInterval) {
    clearInterval(carouselInterval);
    const items = recentCarousel.querySelectorAll('.recent-item');
    const totalItems = items.length / 2;
    if (totalItems > 0) {
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

// 加载热门内容
async function loadTrending() {
  try {
    // 加载热门电影
    const moviesResponse = await fetch('/api/trending/movies');
    const moviesData = await moviesResponse.json();
    displayMovies(moviesData.results, trendingMovies);

    // 加载热门电视剧
    const tvResponse = await fetch('/api/trending/tv');
    const tvData = await tvResponse.json();
    displayMovies(tvData.results, trendingTV);
  } catch (error) {
    console.error('加载热门内容失败:', error);
    trendingMovies.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div><div style="color: #9ca3af;">加载失败</div></div>';
    trendingTV.innerHTML = '<div class="empty-state"><div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 15s1.5-2 4-2 4 2 4 2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></div><div style="color: #9ca3af;">加载失败</div></div>';
  }
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
}

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
    
    const response = await fetch(`/api/search?query=${encodeURIComponent(query)}`);
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
        <button class="suggestion-btn" onclick="event.stopPropagation(); selectMovie(${item.id}, '${escapeHtml(item.title)}', '${item.mediaType}', this)" title="订阅">
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

async function selectMovie(id, title, mediaType, buttonElement) {
  // 显示加载状态
  buttonElement.disabled = true;
  buttonElement.classList.add('loading');
  const originalContent = buttonElement.innerHTML;
  buttonElement.innerHTML = '<div class="spinner-small"></div>';

  try {
    const response = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title, mediaType }),
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
    buttonElement.classList.remove('loading');
    buttonElement.classList.add('error');
    buttonElement.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    `;
    buttonElement.title = '订阅失败: ' + error.message;
    
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
  if (!ctx) return;
  
  try {
    // 从 API 获取真实数据
    const response = await fetch('/api/emby/trends');
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
          label: '电视剧',
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
  } catch (error) {
    console.error('加载图表数据失败:', error);
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
const mobileStatusLink = document.getElementById('mobileStatusLink');

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

  // 移动端状态链接点击事件
  if (mobileStatusLink) {
    mobileStatusLink.addEventListener('click', (e) => {
      e.preventDefault();
      loadEmbyStats();
      const isOnline = statusIcon.style.color === 'rgb(16, 185, 129)';
      alert(isOnline ? '✅ 服务正常运行' : '❌ Emby 服务离线');
      mobileMenu.classList.remove('show');
    });
  }

  // 点击菜单项后关闭菜单
  const menuItems = mobileMenu.querySelectorAll('.mobile-menu-item');
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

// Footer 状态链接点击事件
if (footerStatusLink) {
  footerStatusLink.addEventListener('click', (e) => {
    e.preventDefault();
    loadEmbyStats();
    const isOnline = statusIcon.style.color === 'rgb(16, 185, 129)';
    alert(isOnline ? '✅ 服务正常运行' : '❌ Emby 服务离线');
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

// 在加载统计数据后更新 Footer
const originalLoadEmbyStats = loadEmbyStats;
loadEmbyStats = async function() {
  await originalLoadEmbyStats();
  updateFooterStats();
};
