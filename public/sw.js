const CACHE_NAME = 'mhss-v4'; // 改变版本号强制更新
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/256.webp'
];

// 安装 Service Worker
self.addEventListener('install', event => {
  // 强制跳过等待，立即激活
  self.skipWaiting();
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('缓存已打开');
        return cache.addAll(urlsToCache);
      })
  );
});

// 激活 Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('删除旧缓存:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 立即控制所有页面
      return self.clients.claim();
    })
  );
});

// 拦截请求 - 网络优先策略
self.addEventListener('fetch', event => {
  // 只处理 http/https 请求，忽略 chrome-extension 等其他协议
  if (!event.request.url.startsWith('http')) {
    return;
  }
  
  event.respondWith(
    // 先尝试网络请求
    fetch(event.request)
      .then(response => {
        // 检查是否是有效响应
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        
        // 只缓存 GET 请求（POST/PUT/DELETE 等不缓存）
        if (event.request.method !== 'GET') {
          return response;
        }
        
        // 克隆响应并更新缓存
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });
        
        return response;
      })
      .catch(() => {
        // 网络失败时才使用缓存
        return caches.match(event.request);
      })
  );
});
