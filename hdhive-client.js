/**
 * HDHive API 客户端 - Node.js 版本
 * 使用 node-fetch 实现，无需 Python 依赖
 */

const fetch = require('node-fetch');
const stateManager = require('./state-manager');

class HDHiveClient {
  constructor(username, password, baseUrl = 'https://hdhive.com') {
    this.baseUrl = baseUrl;
    this.username = username;
    this.password = password;
    this.cookies = {};
    this.loggedIn = false;
    
    // 默认 next-action ID
    this.nextActionId = process.env.HDHIVE_NEXT_ACTION_ID || '60a3fc399468c700be8a3ecc69cd86c911899c9c85';
    
    // 加载保存的 Cookie
    this._loadCookies();
  }
  
  /**
   * 从状态文件加载 Cookie
   */
  _loadCookies() {
    try {
      const state = stateManager.getState('hdhive') || {};
      const cookiesData = state.cookies || [];
      
      if (cookiesData.length === 0) {
        return;
      }
      
      // 转换为 Cookie 对象
      cookiesData.forEach(cookie => {
        this.cookies[cookie.name] = cookie.value;
      });
      
      console.log(`✓ 已加载保存的 Cookie（${cookiesData.length} 个）`);
      
      // 验证 Cookie 是否有效
      if (this._verifyCookie()) {
        this.loggedIn = true;
        console.log('✓ Cookie 有效，无需重新登录');
      } else {
        console.log('⚠️  Cookie 已过期，需要重新登录');
        this._clearCookies();
      }
    } catch (error) {
      console.error('⚠️  加载 Cookie 失败:', error.message);
    }
  }
  
  /**
   * 保存 Cookie 到状态文件
   */
  _saveCookies() {
    try {
      const cookiesData = Object.entries(this.cookies).map(([name, value]) => ({
        name,
        value,
        domain: '.hdhive.com',
        path: '/'
      }));
      
      // 读取现有状态
      const state = stateManager.getState('hdhive') || {};
      
      // 更新 cookies
      state.cookies = cookiesData;
      state.username = this.username;
      
      // 保存状态
      stateManager.setState('hdhive', state);
      
      console.log(`✓ Cookie 已保存（${cookiesData.length} 个）`);
    } catch (error) {
      console.error('⚠️  保存 Cookie 失败:', error.message);
    }
  }
  
  /**
   * 清除 Cookie
   */
  _clearCookies() {
    this.cookies = {};
    
    try {
      const state = stateManager.getState('hdhive') || {};
      if (state.cookies) {
        delete state.cookies;
        stateManager.setState('hdhive', state);
        console.log('✓ 已清除 Cookie');
      }
    } catch (error) {
      console.error('⚠️  清除 Cookie 失败:', error.message);
    }
  }
  
  /**
   * 验证 Cookie 是否有效（检查 JWT token 是否过期）
   */
  _verifyCookie() {
    try {
      const token = this.cookies.token;
      if (!token) {
        return false;
      }
      
      // 解析 JWT token
      const parts = token.split('.');
      if (parts.length !== 3) {
        return false;
      }
      
      // 解码 payload
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      
      // 检查过期时间（如果 token 还有超过 1 小时的有效期，认为有效）
      const exp = payload.exp;
      if (exp && exp > Date.now() / 1000 + 3600) {
        return true;
      } else {
        console.log('⚠️  Token 即将过期或已过期');
        return false;
      }
    } catch (error) {
      console.error('⚠️  验证 Cookie 失败:', error.message);
      return false;
    }
  }
  
  /**
   * 获取 Cookie 字符串
   */
  _getCookieString() {
    return Object.entries(this.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
  
  /**
   * 从响应头中提取并保存 Cookie
   */
  _extractCookies(response) {
    const setCookieHeaders = response.headers.raw()['set-cookie'] || [];
    
    setCookieHeaders.forEach(cookieStr => {
      const parts = cookieStr.split(';')[0].split('=');
      if (parts.length === 2) {
        this.cookies[parts[0]] = parts[1];
      }
    });
  }
  
  /**
   * 登录 HDHive
   */
  /**
     * 登录 HDHive
     */
    async login() {
      if (this.loggedIn) {
        return true;
      }

      try {
        console.log('🔐 登录 HDHive...');

        // 步骤 1：访问登录页面获取初始 Cookie
        const loginPageResponse = await fetch(`${this.baseUrl}/login`, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0'
          }
        });

        if (!loginPageResponse.ok) {
          console.error(`❌ 访问登录页面失败: ${loginPageResponse.status}`);
          return false;
        }

        // 提取 Cookie
        this._extractCookies(loginPageResponse);
        console.log('✓ 访问登录页面成功');

        // 步骤 2：使用 Next.js Server Actions 登录
        const loginPayload = JSON.stringify([
          {
            username: this.username,
            password: this.password
          },
          '/'
        ]);

        // 获取登录 Action ID（优先使用缓存的）
        let actionId = this._getLoginActionId();

        const loginResponse = await fetch(`${this.baseUrl}/login`, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/x-component',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Content-Type': 'text/plain;charset=UTF-8',
            'next-action': actionId,
            'next-router-state-tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22(auth)%22%2C%7B%22children%22%3A%5B%22login%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
            'Referer': `${this.baseUrl}/login`,
            'Origin': this.baseUrl,
            'Connection': 'keep-alive',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'Cookie': this._getCookieString()
          },
          body: loginPayload,
          redirect: 'manual'
        });

        // 提取登录后的 Cookie
        this._extractCookies(loginResponse);

        // 检查是否登录成功
        if (loginResponse.status === 303) {
          const redirectHeader = loginResponse.headers.get('x-action-redirect');
          console.log('✓ 登录成功！（303 重定向）');
          if (redirectHeader) {
            console.log(`  重定向到: ${redirectHeader}`);
          }

          this.loggedIn = true;

          // 保存 Cookie
          this._saveCookies();

          return true;
        }

        // 检查是否是 Action ID 失效
        const responseText = await loginResponse.text();
        const isActionIdInvalid = loginResponse.status === 404 || 
                                  responseText.includes('Server action not found') ||
                                  responseText.includes('action not found');

        if (isActionIdInvalid) {
          console.log('⚠️  登录 Action ID 已失效，正在查找新的 ID...');

          // 自动查找新的 Action ID
          const newActionId = await this._findLoginActionId();

          if (newActionId) {
            // 保存新的 Action ID
            this._saveLoginActionId(newActionId);

            // 使用新的 Action ID 重试登录
            console.log('🔄 使用新的 Action ID 重试登录...');

            const retryResponse = await fetch(`${this.baseUrl}/login`, {
              method: 'POST',
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/x-component',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Content-Type': 'text/plain;charset=UTF-8',
                'next-action': newActionId,
                'next-router-state-tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22(auth)%22%2C%7B%22children%22%3A%5B%22login%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
                'Referer': `${this.baseUrl}/login`,
                'Origin': this.baseUrl,
                'Connection': 'keep-alive',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin',
                'Cookie': this._getCookieString()
              },
              body: loginPayload,
              redirect: 'manual'
            });

            // 提取登录后的 Cookie
            this._extractCookies(retryResponse);

            if (retryResponse.status === 303) {
              const redirectHeader = retryResponse.headers.get('x-action-redirect');
              console.log('✓ 登录成功！（303 重定向）');
              if (redirectHeader) {
                console.log(`  重定向到: ${redirectHeader}`);
              }

              this.loggedIn = true;

              // 保存 Cookie
              this._saveCookies();

              return true;
            } else {
              console.error(`❌ 重试登录失败: ${retryResponse.status}`);
              const retryText = await retryResponse.text();
              console.error(`   响应体: ${retryText.substring(0, 200)}`);
              return false;
            }
          } else {
            console.error('❌ 无法找到新的登录 Action ID');
            return false;
          }
        } else {
          console.error(`❌ 登录失败: ${loginResponse.status}`);
          console.error(`   响应体: ${responseText.substring(0, 200)}`);
          return false;
        }
      } catch (error) {
        console.error('❌ 登录异常:', error.message);
        return false;
      }
    }
  
  /**
   * 从 TMDB ID 获取 HDHive ID
   */
  async getHDHiveIdFromTmdb(tmdbId, mediaType) {
    if (!this.loggedIn) {
      if (!await this.login()) {
        return null;
      }
    }
    
    try {
      const url = `${this.baseUrl}/tmdb/${mediaType}/${tmdbId}`;
      console.log(`🔍 从 TMDB ID 获取 HDHive ID: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'RSC': '1',
          'Cookie': this._getCookieString()
        }
      });
      
      if (response.ok) {
        const text = await response.text();
        
        // 从 RSC 响应中提取 HDHive ID（32位十六进制）
        const regex = new RegExp(`/${mediaType}/([a-f0-9]{32})`, 'g');
        const matches = text.match(regex);
        
        if (matches && matches.length > 0) {
          const hdhiveId = matches[0].split('/')[2];
          console.log(`✓ 找到 HDHive ID: ${hdhiveId}`);
          return hdhiveId;
        } else {
          console.error('❌ 未找到 HDHive ID');
          return null;
        }
      } else {
        console.error(`❌ 获取 HDHive ID 失败: ${response.status}`);
        return null;
      }
    } catch (error) {
      console.error('❌ 获取 HDHive ID 异常:', error.message);
      return null;
    }
  }
  
  /**
   * 从 HDHive ID 获取资源 ID 列表
   */
  async getResourceIdsFromHDHiveId(hdhiveId, mediaType) {
    if (!this.loggedIn) {
      if (!await this.login()) {
        return [];
      }
    }
    
    try {
      const url = `${this.baseUrl}/${mediaType}/${hdhiveId}`;
      console.log(`🔍 获取资源 ID: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'RSC': '1',
          'Cookie': this._getCookieString()
        }
      });
      
      if (response.ok) {
        const text = await response.text();
        
        // 从 RSC 响应中提取所有 32 位十六进制 ID
        const regex = /([a-f0-9]{32})/g;
        const matches = text.match(regex) || [];
        const uniqueIds = [...new Set(matches)];
        
        console.log(`✓ 找到 ${uniqueIds.length} 个可能的资源 ID`);
        return uniqueIds;
      } else {
        console.error(`❌ 获取资源 ID 失败: ${response.status}`);
        return [];
      }
    } catch (error) {
      console.error('❌ 获取资源 ID 异常:', error.message);
      return [];
    }
  }
  
  /**
   * 获取单个资源的 115 链接
   */
  async getResourceLinks(resourceId) {
    if (!this.loggedIn) {
      if (!await this.login()) {
        return [];
      }
    }
    
    try {
      const url = `${this.baseUrl}/resource/115/${resourceId}`;
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cookie': this._getCookieString()
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        
        // 从 HTML 中解析 115 链接
        const regex = /(https?:\/\/115(?:cdn)?\.com\/s\/[a-zA-Z0-9]+(?:\?password=[a-zA-Z0-9]+)?)/g;
        const matches = html.match(regex) || [];
        
        // 去重
        const uniqueLinks = [...new Set(matches)];
        
        return uniqueLinks;
      } else {
        return [];
      }
    } catch (error) {
      return [];
    }
  }
  
  /**
   * 搜索免费的 115 资源（只返回带密码的已解锁链接）
   */
  async searchFreeResources(hdhiveId, mediaType) {
    // 步骤 1：从 HDHive ID 获取资源 ID 列表
    const resourceIds = await this.getResourceIdsFromHDHiveId(hdhiveId, mediaType);
    
    if (resourceIds.length === 0) {
      console.log('⚠️  未找到资源 ID');
      return [];
    }
    
    // 步骤 2：获取每个资源的 115 链接
    const allLinks = [];
    for (let i = 0; i < resourceIds.length; i++) {
      const resourceId = resourceIds[i];
      console.log(`  [${i + 1}/${resourceIds.length}] 测试资源: ${resourceId}`);
      
      const links = await this.getResourceLinks(resourceId);
      if (links.length > 0) {
        allLinks.push(...links);
      }
    }
    
    // 去重
    const uniqueLinks = [...new Set(allLinks)];
    
    // 只保留带 password 参数的链接（已解锁）
    const unlockedLinks = uniqueLinks.filter(link => link.includes('?password='));
    
    console.log(`✓ 总共找到 ${uniqueLinks.length} 个 115 链接，其中 ${unlockedLinks.length} 个已解锁`);
    unlockedLinks.forEach((link, i) => {
      console.log(`  [${i + 1}] ${link}`);
    });
    
    return unlockedLinks;
  }
  
  /**
   * 从 TMDB ID 搜索资源
   */
  async searchFromTmdb(tmdbId, mediaType) {
    // 登录
    if (!await this.login()) {
      return [];
    }
    
    // 从 TMDB ID 获取 HDHive ID
    const hdhiveId = await this.getHDHiveIdFromTmdb(tmdbId, mediaType);
    
    if (!hdhiveId) {
      return [];
    }
    
    // 搜索资源
    return await this.searchFreeResources(hdhiveId, mediaType);
  }
  /**
   * 获取签到 Action ID
   * 优先从状态文件读取，如果不存在则使用默认值
   */
  _getSigninActionId() {
    try {
      const state = stateManager.getState('hdhive') || {};
      return state.signinActionId || '409fcfaf6015ab7d6e7fbcaf2f551cbbc4875c691b';
    } catch (error) {
      return '409fcfaf6015ab7d6e7fbcaf2f551cbbc4875c691b';
    }
  }
  /**
   * 解码 Next.js SSR 数据
   */
  _decodeNextjsData(html) {
      const regex = /self\.__next_f\.push\(\[1,"(.*?)"\]\)/gs;
      const chunks = [];
      let match;

      while ((match = regex.exec(html)) !== null) {
        chunks.push(match[1]);
      }

      if (chunks.length === 0) {
        return '';
      }

      const combined = chunks.join('');

      // 解码 Unicode 转义序列
      try {
        const decoded = combined.replace(/\\u([0-9a-fA-F]{4})/g, (match, hex) => {
          return String.fromCharCode(parseInt(hex, 16));
        });

        // 解码其他转义字符（注意顺序很重要）
        // 先处理双反斜杠，避免后续处理时出错
        return decoded
          .replace(/\\\\/g, '\x00BACKSLASH\x00')  // 临时标记双反斜杠
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\x00BACKSLASH\x00/g, '\\');  // 恢复单反斜杠
      } catch (error) {
        return combined;
      }
    }

  /**
   * 从 HTML 中提取 SSR 数据（groupData）
   */
  _extractSsrData(html) {
      const decoded = this._decodeNextjsData(html);
      if (!decoded) {
        return null;
      }

      const idx = decoded.indexOf('"groupData":{');
      if (idx < 0) {
        return null;
      }

      const start = decoded.indexOf('{', idx + 12);
      const raw = decoded.substring(start);

      // 找到匹配的闭合括号（考虑字符串中的括号）
      let depth = 0;
      let end = 0;
      let inString = false;
      let escapeNext = false;

      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (ch === '\\') {
          escapeNext = true;
          continue;
        }

        if (ch === '"') {
          inString = !inString;
          continue;
        }

        if (inString) {
          continue;
        }

        if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }

      if (end === 0) {
        return null;
      }

      try {
        const jsonStr = raw.substring(0, end);
        return JSON.parse(jsonStr);
      } catch (error) {
        console.error('⚠️  解析 groupData 失败:', error.message);
        // 尝试修复常见的 JSON 问题
        try {
          const jsonStr = raw.substring(0, end)
            .replace(/\\'/g, "'")  // 处理单引号转义
            .replace(/\\\\/g, '\\'); // 处理双反斜杠
          return JSON.parse(jsonStr);
        } catch (retryError) {
          console.error('⚠️  重试解析也失败:', retryError.message);
          return null;
        }
      }
    }

  /**
   * 从 groupData 中提取影片信息
   */
  _extractMediaInfo(groupData) {
    const info = { name: '', year: '', type: '' };

    // 辅助函数：从标题中提取年份
    const stripYearSuffix = (text) => {
      const t = (text || '').trim();
      if (!t) return ['', ''];

      const match = t.match(/^(?<title>.*?)\s*[（(]\s*(?<year>\d{4})[^）)]*[)）]\s*$/);
      if (match) {
        return [(match.groups.title || '').trim(), (match.groups.year || '').trim()];
      }
      return [t, ''];
    };

    // 遍历所有网盘的资源
    for (const resources of Object.values(groupData)) {
      if (!resources || resources.length === 0) {
        continue;
      }

      const res = resources[0];
      const tv = res.tv || {};
      const movie = res.movie || {};

      if (tv && Object.keys(tv).length > 0) {
        info.type = 'tv';
        info.name = tv.name || tv.original_name || '';
        const date = tv.first_air_date || tv.air_date || '';
        if (date && date.length >= 4) {
          info.year = date.substring(0, 4);
        }
      } else if (movie && Object.keys(movie).length > 0) {
        info.type = 'movie';
        info.name = movie.title || movie.original_title || movie.name || '';
        const date = movie.release_date || movie.air_date || '';
        if (date && date.length >= 4) {
          info.year = date.substring(0, 4);
        }
      } else {
        // 回退：从资源标题中解析
        const [parsedTitle, parsedYear] = stripYearSuffix(res.title || '');
        info.name = parsedTitle;
        info.year = parsedYear;
        return info;
      }

      // 如果没有年份，尝试从标题中解析
      if (!info.year) {
        const [, parsedYear] = stripYearSuffix(res.title || '');
        info.year = parsedYear;
      }

      // 如果没有名称，使用标题
      if (!info.name) {
        const [parsedTitle] = stripYearSuffix(res.title || '');
        info.name = parsedTitle;
      }

      if (info.name || info.year) {
        break;
      }
    }

    return info;
  }

  /**
   * 获取资源页面并解析
   * @param {string} url - HDHive 资源页面 URL
   * @returns {Promise<{groupData: Object, mediaInfo: Object}>}
   */
  async fetchMainPage(url) {
    // 确保已登录
    if (!this.loggedIn) {
      if (!await this.login()) {
        throw new Error('登录失败，无法获取资源页面');
      }
    }

    try {
      console.log(`🔍 请求 HDHive 页面: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cookie': this._getCookieString()
        }
      });

      // 检查是否被重定向到登录页
      if (response.url.includes('/login') || response.status === 401 || response.status === 403) {
        console.log('⚠️  需要重新登录');
        this._clearCookies();
        this.loggedIn = false;

        if (!await this.login()) {
          throw new Error('重新登录失败');
        }

        // 重试请求
        const retryResponse = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Cookie': this._getCookieString()
          }
        });

        if (!retryResponse.ok) {
          throw new Error(`获取页面失败: ${retryResponse.status}`);
        }

        const html = await retryResponse.text();
        const groupData = this._extractSsrData(html);

        if (groupData) {
          const mediaInfo = this._extractMediaInfo(groupData);
          const panCount = Object.values(groupData).filter(v => v && v.length > 0).length;
          const total = Object.values(groupData).reduce((sum, v) => sum + (v ? v.length : 0), 0);
          console.log(`✓ 页面解析成功: ${panCount} 个网盘, ${total} 个资源`);
          if (mediaInfo.name) {
            console.log(`  影片: ${mediaInfo.name}${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`);
          }
          return { groupData, mediaInfo };
        } else {
          console.log('⚠️  未找到 groupData，可能需要重新登录');
          return { groupData: null, mediaInfo: { name: '', year: '', type: '' } };
        }
      }

      if (!response.ok) {
        throw new Error(`获取页面失败: ${response.status}`);
      }

      const html = await response.text();
      const groupData = this._extractSsrData(html);

      if (groupData) {
        const mediaInfo = this._extractMediaInfo(groupData);
        const panCount = Object.values(groupData).filter(v => v && v.length > 0).length;
        const total = Object.values(groupData).reduce((sum, v) => sum + (v ? v.length : 0), 0);
        console.log(`✓ 页面解析成功: ${panCount} 个网盘, ${total} 个资源`);
        if (mediaInfo.name) {
          console.log(`  影片: ${mediaInfo.name}${mediaInfo.year ? ` (${mediaInfo.year})` : ''}`);
        }
        return { groupData, mediaInfo };
      } else {
        console.log('⚠️  未找到 groupData');
        return { groupData: null, mediaInfo: { name: '', year: '', type: '' } };
      }
    } catch (error) {
      console.error('❌ 获取资源页面失败:', error.message);
      throw error;
    }
  }

  /**
   * 解锁付费资源
   * @param {string} slug - 资源 slug
   * @param {string} panType - 网盘类型 (如 '115', 'quark', 'aliPan' 等)
   * @returns {Promise<Object>} 解锁结果，包含资源链接
   */
  async unlockResource(slug, panType) {
      // 确保已登录
      if (!this.loggedIn) {
        if (!await this.login()) {
          throw new Error('登录失败，无法解锁资源');
        }
      }

      console.log(`🔓 解锁资源: ${slug} (${panType})`);

      // 获取解锁 Action ID
      let unlockActionId = this._getUnlockActionId();
      let needRetry = false;

      // 尝试两种路由格式
      const refererPaths = [
        `/resource/${slug}`,
        `/resource/${panType}/${slug}`
      ];

      let lastError = null;

      for (const refererPath of refererPaths) {
        try {
          const url = `${this.baseUrl}${refererPath}`;

          // 如果没有 Action ID，先尝试自动发现
          if (!unlockActionId) {
            console.log('⚠️  未找到解锁 Action ID，尝试自动发现...');
            unlockActionId = await this._findUnlockActionId(url);
            if (!unlockActionId) {
              throw new Error('无法获取解锁 Action ID');
            }
          }

          // 构建 Next-Router-State-Tree
          const routerStateTree = this._buildRouterStateTree(refererPath, slug, panType);

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
              'Accept': 'text/x-component',
              'Content-Type': 'text/plain;charset=UTF-8',
              'Next-Action': unlockActionId,
              'Next-Router-State-Tree': routerStateTree,
              'Referer': url,
              'Origin': this.baseUrl,
              'Cookie': this._getCookieString()
            },
            body: JSON.stringify([slug])
          });

          const text = await response.text();

          // 检测 Action ID 失效
          if (response.status === 404 || text.includes('Server action not found')) {
            if (!needRetry) {
              console.log('⚠️  解锁 Action ID 可能已失效，尝试重新获取...');
              unlockActionId = await this._findUnlockActionId(url);
              if (unlockActionId) {
                needRetry = true;
                // 重试当前路由
                const retryResponse = await fetch(url, {
                  method: 'POST',
                  headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
                    'Accept': 'text/x-component',
                    'Content-Type': 'text/plain;charset=UTF-8',
                    'Next-Action': unlockActionId,
                    'Next-Router-State-Tree': routerStateTree,
                    'Referer': url,
                    'Origin': this.baseUrl,
                    'Cookie': this._getCookieString()
                  },
                  body: JSON.stringify([slug])
                });

                const retryText = await retryResponse.text();

                if (retryResponse.status === 404) {
                  console.log(`⚠️  路由 ${refererPath} 返回 404，尝试下一个路由`);
                  lastError = new Error(`路由不存在: ${refererPath}`);
                  continue;
                }

                if (!retryResponse.ok) {
                  throw new Error(`解锁请求失败: ${retryResponse.status}`);
                }

                // 解析重试响应
                const result = this._parseFlightResponse(retryText);

                if (result && result.response && result.response.success && result.response.data) {
                  const data = result.response.data;
                  console.log(`✓ 解锁成功`);

                  // 构建完整 URL（包含密码）
                  const fullUrl = this._buildFullUrl(data);

                  // 提取 data 中除了 url 之外的所有字段
                  const { url: _, ...otherData } = data;

                  return {
                    success: true,
                    url: fullUrl,
                    full_url: data.full_url || data.url,
                    access_code: data.access_code,
                    ...otherData  // 展开其他字段，但不包括 url
                  };
                } else {
                  throw new Error('解锁响应格式异常');
                }
              } else {
                throw new Error('无法获取新的解锁 Action ID');
              }
            } else {
              console.log(`⚠️  路由 ${refererPath} 返回 404，尝试下一个路由`);
              lastError = new Error(`路由不存在: ${refererPath}`);
              continue;
            }
          }

          if (response.status === 404) {
            console.log(`⚠️  路由 ${refererPath} 返回 404，尝试下一个路由`);
            lastError = new Error(`路由不存在: ${refererPath}`);
            continue;
          }

          if (!response.ok) {
            throw new Error(`解锁请求失败: ${response.status}`);
          }

          // 解析 Flight 响应
          const result = this._parseFlightResponse(text);

          if (result && result.response && result.response.success && result.response.data) {
            const data = result.response.data;
            console.log(`✓ 解锁成功`);

            // 构建完整 URL（包含密码）
            const fullUrl = this._buildFullUrl(data);

            // 提取 data 中除了 url 之外的所有字段
            const { url: _, ...otherData } = data;

            return {
              success: true,
              url: fullUrl,
              full_url: data.full_url || data.url,
              access_code: data.access_code,
              ...otherData  // 展开其他字段，但不包括 url
            };
          } else {
            throw new Error('解锁响应格式异常');
          }
        } catch (error) {
          console.log(`⚠️  使用路由 ${refererPath} 失败: ${error.message}`);
          lastError = error;
        }
      }

      // 所有路由都失败
      throw lastError || new Error('解锁失败：所有路由都不可用');
    }

  /**
   * 构建 Next-Router-State-Tree
   */
  _buildRouterStateTree(refererPath, slug, panType) {
    const segments = refererPath.split('/').filter(s => s);

    let tree;

    // /resource/<slug>
    if (segments.length === 2 && segments[0] === 'resource') {
      tree = [
        '',
        {
          children: [
            '(no-layout)',
            {
              children: [
                'resource',
                {
                  children: [
                    ['slug', slug, 'd'],
                    { children: ['__PAGE__', {}, null, null] },
                    null,
                    null
                  ]
                },
                null,
                null
              ]
            },
            null,
            null
          ]
        },
        null,
        null,
        true
      ];
    }
    // /resource/<pan>/<slug>
    else if (segments.length === 3 && segments[0] === 'resource') {
      tree = [
        '',
        {
          children: [
            '(no-layout)',
            {
              children: [
                'resource',
                {
                  children: [
                    panType,
                    {
                      children: [
                        ['slug', slug, 'd'],
                        { children: ['__PAGE__', {}, null, null] },
                        null,
                        null
                      ]
                    },
                    null,
                    null
                  ]
                },
                null,
                null
              ]
            },
            null,
            null
          ]
        },
        null,
        null,
        true
      ];
    } else {
      return '';
    }

    const raw = JSON.stringify(tree);
    // URL encode，但保留括号
    return encodeURIComponent(raw).replace(/%28/g, '(').replace(/%29/g, ')');
  }

  /**
   * 解析 Flight 响应
   */
  _parseFlightResponse(text) {
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('1:')) {
        const raw = trimmed.substring(2).trim();
        try {
          return JSON.parse(raw);
        } catch (error) {
          return { raw };
        }
      }
    }

    return null;
  }

  /**
   * 构建完整 URL（包含密码参数）
   */
  _buildFullUrl(data) {
    let url = data.full_url || data.url || '';
    const code = data.access_code || '';

    if (url && code && !url.includes(`password=${code}`)) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}password=${code}`;
    }

    return url;
  }
  
  /**
   * 保存签到 Action ID 到状态文件
   */
  _saveSigninActionId(actionId) {
    try {
      const state = stateManager.getState('hdhive') || {};
      state.signinActionId = actionId;
      stateManager.setState('hdhive', state);
      console.log(`✓ 已保存新的签到 Action ID: ${actionId}`);
    } catch (error) {
      console.error('⚠️  保存签到 Action ID 失败:', error.message);
    }
  }
  /**
   * 获取登录 Action ID
   * 优先从状态文件读取，如果不存在则使用默认值
   */
  _getLoginActionId() {
    try {
      const state = stateManager.getState('hdhive') || {};
      return state.loginActionId || this.nextActionId;
    } catch (error) {
      return this.nextActionId;
    }
  }

  /**
   * 保存登录 Action ID 到状态文件
   */
  _saveLoginActionId(actionId) {
    try {
      const state = stateManager.getState('hdhive') || {};
      state.loginActionId = actionId;
      stateManager.setState('hdhive', state);
      console.log(`✓ 已保存新的登录 Action ID: ${actionId}`);
    } catch (error) {
      console.error('⚠️  保存登录 Action ID 失败:', error.message);
    }
  }
  /**
   * 获取解锁 Action ID
   */
  _getUnlockActionId() {
    try {
      const appState = stateManager.getState('app') || {};
      const hdhiveState = appState.hdhive || {};
      return hdhiveState.unlockActionId || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 保存解锁 Action ID 到状态文件
   */
  /**
     * 获取解锁 Action ID
     */
    _getUnlockActionId() {
      try {
        const appState = stateManager.getState('app') || {};
        const hdhiveState = appState.hdhive || {};
        return hdhiveState.unlockActionId || null;
      } catch (error) {
        return null;
      }
    }

    /**
     * 保存解锁 Action ID 到状态文件
     */
    /**
       * 获取解锁 Action ID
       */
      _getUnlockActionId() {
        try {
          const state = stateManager.getState('hdhive') || {};
          return state.unlockActionId || null;
        } catch (error) {
          return null;
        }
      }

      /**
       * 保存解锁 Action ID 到状态文件
       */
      _saveUnlockActionId(actionId) {
        try {
          const state = stateManager.getState('hdhive') || {};
          state.unlockActionId = actionId;
          stateManager.setState('hdhive', state);
          console.log(`✓ 已保存新的解锁 Action ID: ${actionId}`);
        } catch (error) {
          console.error('⚠️  保存解锁 Action ID 失败:', error.message);
        }
      }

  /**
   * 评分登录上下文
   */
  _scoreLoginContext(context) {
    let score = 0;
    const lower = context.toLowerCase();

    // 强信号
    if (context.includes('"username"')) score += 6;
    if (context.includes('"password"')) score += 6;

    // 路径和重定向
    if (lower.includes('/login')) score += 5;
    if (lower.includes('redirect')) score += 3;

    // 认证相关
    if (lower.includes('signin') || lower.includes('sign_in')) score += 2;
    if (lower.includes('auth') || lower.includes('credential')) score += 1;

    return score;
  }
  /**
   * 评分解锁上下文
   */
  _scoreUnlockContext(context) {
    let score = 0;

    // 解锁相关关键词
    if (context.includes('unlock')) score += 5;
    if (context.includes('解锁')) score += 5;
    if (context.includes('resource')) score += 3;
    if (context.includes('资源')) score += 3;
    if (context.includes('pan')) score += 2;
    if (context.includes('网盘')) score += 2;

    // 网盘类型关键词
    if (context.includes('115')) score += 2;
    if (context.includes('quark')) score += 2;
    if (context.includes('aliPan') || context.includes('aliyun')) score += 2;
    if (context.includes('baidu')) score += 2;

    // 积分相关
    if (context.includes('point') || context.includes('积分')) score += 2;
    if (context.includes('cost') || context.includes('消耗')) score += 1;

    // 请求参数格式
    if (context.includes('slug')) score += 3;
    if (context.includes('[slug]')) score += 2;

    return score;
  }

  /**
   * 从资源页面自动查找解锁 Action ID
   */
  async _findUnlockActionId(resourceUrl) {
    try {
      console.log('🔍 正在从资源页面中查找解锁 Action ID...');

      // 步骤 1: 获取资源页面 HTML
      const response = await fetch(resourceUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
          'Cookie': this._getCookieString()
        }
      });

      if (!response.ok) {
        console.log(`⚠️  获取页面失败: ${response.status}`);
        return null;
      }

      const html = await response.text();

      // 步骤 2: 提取所有 JavaScript 文件 URL
      const jsUrls = this._extractJsUrls(html);
      console.log(`  找到 ${jsUrls.length} 个 JavaScript 文件`);

      if (jsUrls.length === 0) {
        console.log('⚠️  未找到 JavaScript 文件');
        return null;
      }

      // 步骤 3: 优先扫描与 resource 相关的文件
      const sortedUrls = jsUrls.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aScore = (aLower.includes('resource') ? 0 : aLower.includes('slug') ? 1 : 2);
        const bScore = (bLower.includes('resource') ? 0 : bLower.includes('slug') ? 1 : 2);
        return aScore - bScore;
      });

      // 步骤 4: 扫描 JS 文件查找候选 Action IDs
      const candidates = new Map(); // id -> score
      const strongIds = new Set(); // 通过强模式找到的 IDs
      const toScan = sortedUrls.slice(0, 30); // 扫描前 30 个文件

      for (let i = 0; i < toScan.length; i++) {
        const url = toScan[i];
        console.log(`  [${i + 1}/${toScan.length}] 扫描: ${url.substring(0, 60)}...`);

        try {
          const jsResponse = await fetch(`${this.baseUrl}${url}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': '*/*'
            }
          });

          if (!jsResponse.ok) continue;

          const js = await jsResponse.text();

          // 使用改进的提取方法
          const actionIds = this._extractActionIds(js);
          if (actionIds.size === 0) continue;

          console.log(`    找到 ${actionIds.size} 个候选 Action IDs`);

          // 检查是否有强模式匹配
          const hasStrong = js.includes('createServerReference') ||
                           js.includes('createServerActionReference') ||
                           js.includes('server-reference');

          // 对每个候选 ID 进行评分
          for (const id of actionIds) {
            const index = js.indexOf(id);
            if (index < 0) continue;

            // 提取上下文（前后 800 个字符）
            const start = Math.max(0, index - 800);
            const end = Math.min(js.length, index + 800);
            const context = js.substring(start, end);

            // 评分
            let score = this._scoreUnlockContext(context);

            // 如果是通过强模式找到的，加分
            if (hasStrong) {
              score += 10;
              strongIds.add(id);
            }

            // 保存最高分
            const currentScore = candidates.get(id) || 0;
            if (score > currentScore) {
              candidates.set(id, score);
            }
          }

          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.log(`    ⚠️  扫描失败: ${error.message}`);
        }
      }

      if (candidates.size === 0) {
        console.log('⚠️  未找到候选 Action IDs');
        return null;
      }

      // 步骤 5: 按评分排序（强模式的优先）
      const sorted = Array.from(candidates.entries())
        .sort((a, b) => {
          const aIsStrong = strongIds.has(a[0]) ? 1 : 0;
          const bIsStrong = strongIds.has(b[0]) ? 1 : 0;
          if (aIsStrong !== bIsStrong) return bIsStrong - aIsStrong;
          return b[1] - a[1];
        });

      console.log(`  找到 ${sorted.length} 个候选，开始验证...`);
      if (strongIds.size > 0) {
        console.log(`  其中 ${strongIds.size} 个通过强模式匹配`);
      }

      // 步骤 6: 验证候选 Action IDs
      // 从 resourceUrl 中提取 slug 和 panType 用于测试
      const urlParts = resourceUrl.split('/').filter(s => s);
      const resourceIndex = urlParts.indexOf('resource');
      let testSlug = null;
      let testPanType = null;

      if (resourceIndex >= 0 && resourceIndex < urlParts.length - 1) {
        if (resourceIndex === urlParts.length - 2) {
          // /resource/<slug>
          testSlug = urlParts[resourceIndex + 1];
        } else if (resourceIndex === urlParts.length - 3) {
          // /resource/<pan>/<slug>
          testPanType = urlParts[resourceIndex + 1];
          testSlug = urlParts[resourceIndex + 2];
        }
      }

      if (!testSlug) {
        console.log('⚠️  无法从 URL 中提取 slug，无法验证');
        return null;
      }

      // 尝试两种路由格式
      const refererPaths = testPanType
        ? [`/resource/${testPanType}/${testSlug}`, `/resource/${testSlug}`]
        : [`/resource/${testSlug}`];

      for (let i = 0; i < Math.min(sorted.length, 15); i++) {
        const [testId, score] = sorted[i];
        const isStrong = strongIds.has(testId);
        console.log(`  [${i + 1}] 测试: ${testId.substring(0, 10)}... (评分: ${score}${isStrong ? ' 强匹配' : ''})`);

        for (const refererPath of refererPaths) {
          try {
            const testUrl = `${this.baseUrl}${refererPath}`;
            const routerStateTree = this._buildRouterStateTree(refererPath, testSlug, testPanType);

            const testResponse = await fetch(testUrl, {
              method: 'POST',
              headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
                'Accept': 'text/x-component',
                'Content-Type': 'text/plain;charset=UTF-8',
                'Next-Action': testId,
                'Next-Router-State-Tree': routerStateTree,
                'Referer': testUrl,
                'Origin': this.baseUrl,
                'Cookie': this._getCookieString()
              },
              body: JSON.stringify([testSlug])
            });

            const text = await testResponse.text();

            // 检查是否是有效的解锁响应
            if (testResponse.status === 200 && (
              text.includes('success') ||
              text.includes('url') ||
              text.includes('full_url') ||
              text.includes('access_code') ||
              (text.includes('error') && text.includes('message'))
            )) {
              console.log(`✓ 找到有效的解锁 Action ID: ${testId}`);
              this._saveUnlockActionId(testId);
              return testId;
            } else if (testResponse.status === 404) {
              console.log(`    ✗ 路由 ${refererPath} 无效 (404)`);
              break; // 尝试下一个候选 ID
            }

            // 避免请求过快
            await new Promise(resolve => setTimeout(resolve, 400));
          } catch (error) {
            console.log(`    ✗ 测试失败: ${error.message}`);
          }
        }
      }

      console.log('⚠️  未找到有效的解锁 Action ID');
      return null;
    } catch (error) {
      console.error('⚠️  查找解锁 Action ID 失败:', error.message);
      return null;
    }
  }

  /**
   * 从页面中查找登录 Action ID（基于 Python 实现）
   */
  async _findLoginActionId() {
    try {
      console.log('🔍 正在从页面中查找登录 Action ID...');

      // 步骤 1: 获取登录页 HTML
      const response = await fetch(`${this.baseUrl}/login`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        }
      });

      if (!response.ok) {
        console.log(`⚠️  获取登录页失败: ${response.status}`);
        return null;
      }

      const html = await response.text();

      // 步骤 2: 提取所有 JavaScript 文件 URL
      const jsUrls = this._extractJsUrls(html);
      console.log(`  找到 ${jsUrls.length} 个 JavaScript 文件`);

      if (jsUrls.length === 0) {
        console.log('⚠️  未找到 JavaScript 文件');
        return null;
      }

      // 步骤 3: 优先扫描与 login/auth 相关的文件
      const sortedUrls = jsUrls.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aScore = (aLower.includes('login') || aLower.includes('auth') ? 0 : aLower.includes('app') ? 1 : 2);
        const bScore = (bLower.includes('login') || bLower.includes('auth') ? 0 : bLower.includes('app') ? 1 : 2);
        return aScore - bScore;
      });

      // 步骤 4: 扫描 JS 文件查找候选 Action IDs
      const candidates = new Map(); // id -> score
      const strongIds = new Set(); // 通过强模式找到的 IDs
      const toScan = sortedUrls.slice(0, 30); // 扫描前 30 个文件

      for (let i = 0; i < toScan.length; i++) {
        const url = toScan[i];
        console.log(`  [${i + 1}/${toScan.length}] 扫描: ${url.substring(0, 60)}...`);

        try {
          const jsResponse = await fetch(`${this.baseUrl}${url}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': '*/*'
            }
          });

          if (!jsResponse.ok) continue;

          const js = await jsResponse.text();

          // 使用改进的提取方法
          const actionIds = this._extractActionIds(js);
          if (actionIds.size === 0) continue;

          console.log(`    找到 ${actionIds.size} 个候选 Action IDs`);

          // 检查是否有强模式匹配
          const hasStrong = js.includes('createServerReference') ||
                           js.includes('createServerActionReference') ||
                           js.includes('server-reference');

          // 对每个候选 ID 进行评分
          for (const id of actionIds) {
            const index = js.indexOf(id);
            if (index < 0) continue;

            // 提取上下文（前后 800 个字符）
            const start = Math.max(0, index - 800);
            const end = Math.min(js.length, index + 800);
            const context = js.substring(start, end);

            // 评分
            let score = this._scoreLoginContext(context);

            // 如果是通过强模式找到的，加分并记录
            if (hasStrong) {
              score += 10;
              strongIds.add(id);
            }

            // 更新最高分
            if (!candidates.has(id) || candidates.get(id) < score) {
              candidates.set(id, score);
            }
          }
        } catch (error) {
          console.log(`    ⚠️  扫描失败: ${error.message}`);
        }
      }

      if (candidates.size === 0) {
        console.log('⚠️  未找到候选 Action IDs');
        return null;
      }

      console.log(`找到 ${candidates.size} 个候选，开始验证...`);
      console.log(`  其中 ${strongIds.size} 个通过强模式匹配`);

      // 步骤 5: 按评分排序候选
      const sorted = Array.from(candidates.entries())
        .sort((a, b) => {
          // 优先选择强模式匹配的
          const aStrong = strongIds.has(a[0]) ? 1 : 0;
          const bStrong = strongIds.has(b[0]) ? 1 : 0;
          if (aStrong !== bStrong) return bStrong - aStrong;
          // 然后按评分排序
          return b[1] - a[1];
        });

      // 步骤 6: 验证候选（测试前 15 个）
      for (let i = 0; i < Math.min(15, sorted.length); i++) {
        const [id, score] = sorted[i];
        const isStrong = strongIds.has(id);
        console.log(`  [${i + 1}] 测试: ${id.substring(0, 10)}... (评分: ${score}${isStrong ? ' 强匹配' : ''})`);

        // 验证这个 Action ID 是否有效
        if (await this._verifyLoginActionId(id)) {
          console.log(`✓ 找到有效的登录 Action ID: ${id}`);
          return id;
        }
      }

      console.log('⚠️  所有候选都验证失败');
      return null;
    } catch (error) {
      console.error('⚠️  查找登录 Action ID 失败:', error.message);
      return null;
    }
  }

  /**
   * 验证登录 Action ID 是否有效
   */
  async _verifyLoginActionId(actionId) {
    try {
      // 使用空凭据测试，如果 Action ID 有效，应该返回业务错误而不是 "Server action not found"
      const payload = JSON.stringify([
        { username: '', password: '' },
        '/'
      ]);

      const response = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15',
          'Accept': 'text/x-component',
          'Content-Type': 'text/plain;charset=UTF-8',
          'next-action': actionId,
          'next-router-state-tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22(auth)%22%2C%7B%22children%22%3A%5B%22login%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
          'Referer': `${this.baseUrl}/login`,
          'Origin': this.baseUrl,
        },
        body: payload
      });

      const text = await response.text();

      // 如果返回 404 且包含 "Server action not found"，说明 Action ID 无效
      if (response.status === 404 && text.includes('Server action not found')) {
        return false;
      }

      // 其他情况认为 Action ID 有效（即使登录失败，也说明 Action 存在）
      return true;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * 从 JavaScript 代码中提取候选 Action IDs
   */
  _extractActionIds(js) {
    const ids = new Set();
    
    // 强模式：查找 createServerReference 和 createServerActionReference
    const strongPatterns = [
      /createServerReference\("([a-f0-9]{40,64})"\)/g,
      /createServerActionReference\("([a-f0-9]{40,64})"\)/g,
      /"server-reference"\s*:\s*"([a-f0-9]{40,64})"/g
    ];
    
    for (const pattern of strongPatterns) {
      const matches = js.matchAll(pattern);
      for (const match of matches) {
        ids.add(match[1]);
      }
    }
    
    // 如果强模式找到了结果，优先使用
    if (ids.size > 0) {
      return ids;
    }
    
    // 弱模式：查找所有被引号包围的 40-64 位十六进制字符串
    const weakPattern = /"([a-f0-9]{40,64})"/g;
    const matches = js.matchAll(weakPattern);
    for (const match of matches) {
      ids.add(match[1]);
    }
    
    return ids;
  }
  
  /**
   * 从页面中查找签到 Action ID（改进版 - 基于 Python 实现）
   */
  async _findSigninActionId() {
    try {
      console.log('🔍 正在从页面中查找签到 Action ID...');
      
      // 步骤 1: 获取首页 HTML
      const response = await fetch(`${this.baseUrl}/user/dashboard`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
          'Cookie': this._getCookieString()
        }
      });
      
      if (!response.ok) {
        console.log(`⚠️  获取页面失败: ${response.status}`);
        return null;
      }
      
      const html = await response.text();
      
      // 步骤 2: 提取所有 JavaScript 文件 URL
      const jsUrls = this._extractJsUrls(html);
      console.log(`  找到 ${jsUrls.length} 个 JavaScript 文件`);
      
      if (jsUrls.length === 0) {
        console.log('⚠️  未找到 JavaScript 文件');
        return null;
      }
      
      // 步骤 3: 优先扫描与 dashboard 相关的文件
      const sortedUrls = jsUrls.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const aScore = (aLower.includes('dashboard') ? 0 : aLower.includes('user') ? 1 : 2);
        const bScore = (bLower.includes('dashboard') ? 0 : bLower.includes('user') ? 1 : 2);
        return aScore - bScore;
      });
      
      // 步骤 4: 扫描 JS 文件查找候选 Action IDs
      const candidates = new Map(); // id -> score
      const strongIds = new Set(); // 通过强模式找到的 IDs
      const toScan = sortedUrls.slice(0, 30); // 扫描前 30 个文件
      
      for (let i = 0; i < toScan.length; i++) {
        const url = toScan[i];
        console.log(`  [${i + 1}/${toScan.length}] 扫描: ${url.substring(0, 60)}...`);
        
        try {
          const jsResponse = await fetch(`${this.baseUrl}${url}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': '*/*'
            }
          });
          
          if (!jsResponse.ok) continue;
          
          const js = await jsResponse.text();
          
          // 使用改进的提取方法
          const actionIds = this._extractActionIds(js);
          if (actionIds.size === 0) continue;
          
          console.log(`    找到 ${actionIds.size} 个候选 Action IDs`);
          
          // 检查是否有强模式匹配
          const hasStrong = js.includes('createServerReference') || 
                           js.includes('createServerActionReference') ||
                           js.includes('server-reference');
          
          // 对每个候选 ID 进行评分
          for (const id of actionIds) {
            const index = js.indexOf(id);
            if (index < 0) continue;
            
            // 提取上下文（前后 800 个字符）
            const start = Math.max(0, index - 800);
            const end = Math.min(js.length, index + 800);
            const context = js.substring(start, end);
            
            // 评分
            let score = this._scoreCheckinContext(context);
            
            // 如果是通过强模式找到的，加分
            if (hasStrong) {
              score += 10;
              strongIds.add(id);
            }
            
            // 保存最高分
            const currentScore = candidates.get(id) || 0;
            if (score > currentScore) {
              candidates.set(id, score);
            }
          }
          
          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.log(`    ⚠️  扫描失败: ${error.message}`);
        }
      }
      
      if (candidates.size === 0) {
        console.log('⚠️  未找到候选 Action IDs');
        return null;
      }
      
      // 步骤 5: 按评分排序（强模式的优先）
      const sorted = Array.from(candidates.entries())
        .sort((a, b) => {
          const aIsStrong = strongIds.has(a[0]) ? 1 : 0;
          const bIsStrong = strongIds.has(b[0]) ? 1 : 0;
          if (aIsStrong !== bIsStrong) return bIsStrong - aIsStrong;
          return b[1] - a[1];
        });
      
      console.log(`  找到 ${sorted.length} 个候选，开始验证...`);
      if (strongIds.size > 0) {
        console.log(`  其中 ${strongIds.size} 个通过强模式匹配`);
      }
      
      // 步骤 6: 验证候选 Action IDs
      const routerStateTree = '%5B%22%22%2C%7B%22children%22%3A%5B%22(app)%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2Cfalse%5D%7D%2Cnull%2Cnull%2Cfalse%5D%7D%2Cnull%2Cnull%2Ctrue%5D';
      
      for (let i = 0; i < Math.min(sorted.length, 15); i++) {
        const [testId, score] = sorted[i];
        const isStrong = strongIds.has(testId);
        console.log(`  [${i + 1}] 测试: ${testId.substring(0, 10)}... (评分: ${score}${isStrong ? ' 强匹配' : ''})`);
        
        try {
          const testResponse = await fetch(`${this.baseUrl}/`, {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              'Accept': 'text/x-component',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'Content-Type': 'text/plain;charset=UTF-8',
              'next-action': testId,
              'next-router-state-tree': routerStateTree,
              'Origin': this.baseUrl,
              'Referer': `${this.baseUrl}/`,
              'Cookie': this._getCookieString()
            },
            body: '[false]'
          });
          
          const text = await testResponse.text();
          
          // 检查是否是有效的签到响应
          if (testResponse.status === 200 && (text.includes('签到') || (text.includes('error') && text.includes('message')))) {
            console.log(`✓ 找到有效的签到 Action ID: ${testId}`);
            this._saveSigninActionId(testId);
            return testId;
          } else if (testResponse.status === 404) {
            console.log(`    ✗ 无效 (404)`);
          }
          
          // 避免请求过快
          await new Promise(resolve => setTimeout(resolve, 400));
        } catch (error) {
          console.log(`    ✗ 测试失败: ${error.message}`);
        }
      }
      
      console.log('⚠️  未找到有效的签到 Action ID');
      return null;
    } catch (error) {
      console.error('⚠️  查找签到 Action ID 失败:', error.message);
      return null;
    }
  }
  
  /**
   * 从 HTML 中提取 JavaScript 文件 URL
   */
  _extractJsUrls(html) {
    const urls = new Set();
    
    // 匹配 /_next/static/ 下的所有 .js 文件
    const regex = /(\/\_next\/static\/[^"'<>\\]+\.js)/g;
    const matches = html.match(regex);
    
    if (matches) {
      matches.forEach(url => urls.add(url));
    }
    
    // 处理转义的斜杠
    const escapedRegex = /(\\\/\_next\\\/static\\\/[^"'<>\\]+\\.js)/g;
    const escapedMatches = html.match(escapedRegex);
    
    if (escapedMatches) {
      escapedMatches.forEach(url => {
        urls.add(url.replace(/\\\//g, '/'));
      });
    }
    
    return Array.from(urls);
  }
  
  /**
   * 评分签到上下文
   */
  _scoreCheckinContext(context) {
    let score = 0;
    
    // 强信号
    if (context.includes('[false]')) score += 8;
    if (context.includes('每日签到')) score += 6;
    if (context.includes('签到')) score += 4;
    
    const lower = context.toLowerCase();
    if (lower.includes('signin') || lower.includes('sign_in')) score += 3;
    if (lower.includes('checkin') || lower.includes('check-in')) score += 3;
    if (lower.includes('/user/dashboard') || lower.includes('dashboard')) score += 1;
    if (lower.includes('signin_days_total')) score += 2;
    
    return score;
  }
  
  /**
   * 每日签到
   * @param {boolean} gamble - 是否使用赌狗模式（true=赌狗签到，false=普通签到）
   */
  async signin(gamble = false) {
    if (!this.loggedIn) {
      if (!await this.login()) {
        return { success: false, message: '登录失败' };
      }
    }

    try {
      const mode = gamble ? '赌狗签到' : '普通签到';
      console.log(`📝 执行${mode}...`);

      // 获取签到的 Server Action ID
      let actionId = this._getSigninActionId();
      const routerStateTree = '%5B%22%22%2C%7B%22children%22%3A%5B%22(app)%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2Cfalse%5D%7D%2Cnull%2Cnull%2Cfalse%5D%7D%2Cnull%2Cnull%2Ctrue%5D';

      const response = await fetch(`${this.baseUrl}/`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/x-component',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Content-Type': 'text/plain;charset=UTF-8',
          'next-action': actionId,
          'next-router-state-tree': routerStateTree,
          'Origin': this.baseUrl,
          'Referer': `${this.baseUrl}/`,
          'Cookie': this._getCookieString()
        },
        body: `[${gamble}]`  // [false] = 普通签到, [true] = 赌狗签到
      });

      // 如果返回 404，说明 Action ID 失效，尝试查找新的
      if (response.status === 404) {
        console.log('⚠️  签到 Action ID 已失效，正在查找新的 ID...');
        const newActionId = await this._findSigninActionId();
        
        if (newActionId) {
          actionId = newActionId;
          
          // 使用新的 Action ID 重试
          const retryResponse = await fetch(`${this.baseUrl}/`, {
            method: 'POST',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/x-component',
              'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
              'Content-Type': 'text/plain;charset=UTF-8',
              'next-action': actionId,
              'next-router-state-tree': routerStateTree,
              'Origin': this.baseUrl,
              'Referer': `${this.baseUrl}/`,
              'Cookie': this._getCookieString()
            },
            body: `[${gamble}]`
          });
          
          return await this._parseSigninResponse(retryResponse, mode);
        } else {
          return {
            success: false,
            message: '签到 Action ID 已失效，且无法自动获取新的 ID',
            description: '请手动更新 Action ID 或联系开发者',
            mode: mode
          };
        }
      }

      return await this._parseSigninResponse(response, mode);
    } catch (error) {
      console.error('❌ 签到异常:', error.message);
      return {
        success: false,
        message: error.message,
        mode: gamble ? '赌狗签到' : '普通签到'
      };
    }
  }
  
  /**
   * 解析签到响应
   */
  async _parseSigninResponse(response, mode) {
    if (response.ok) {
      const text = await response.text();

      // 解析 RSC 响应
      // 格式: 0:{...}\n1:{"error":{...}}
      const lines = text.split('\n');
      const resultLine = lines.find(line => line.includes('error') || line.includes('success'));

      if (resultLine) {
        // 提取 JSON 部分
        const jsonMatch = resultLine.match(/\d+:(\{.+\})/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[1]);

          if (result.error) {
            const error = result.error;

            // 判断是否已签到
            if (error.description && error.description.includes('已经签到')) {
              console.log('⚠️  今天已经签到过了');
              return {
                success: false,
                alreadySigned: true,
                message: error.message,
                description: error.description,
                mode: mode
              };
            } else {
              console.log(`❌ 签到失败: ${error.message}`);
              return {
                success: false,
                message: error.message,
                description: error.description,
                mode: mode
              };
            }
          } else if (result.success !== false) {
            console.log(`✓ ${mode}成功！`);
            return {
              success: true,
              message: `${mode}成功`,
              data: result,
              mode: mode
            };
          }
        }
      }

      // 如果无法解析，返回原始响应
      console.log('⚠️  无法解析签到响应');
      return {
        success: false,
        message: '无法解析响应',
        raw: text,
        mode: mode
      };
    } else {
      console.error(`❌ 签到请求失败: ${response.status}`);
      return {
        success: false,
        message: `请求失败: ${response.status}`,
        mode: mode
      };
    }
  }
  /**
   * 获取用户积分和签到信息
   * @returns {Promise<Object>} 用户信息，包含积分、签到天数等
   */
  async getUserPoints() {
    // 确保已登录
    if (!this.loggedIn) {
      if (!await this.login()) {
        throw new Error('登录失败，无法获取用户信息');
      }
    }

    try {
      console.log('🔍 获取用户积分信息...');

      const response = await fetch(`${this.baseUrl}/user/signin`, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': '*/*',
          'RSC': '1',
          'Cookie': this._getCookieString()
        }
      });

      if (!response.ok) {
        throw new Error(`获取用户信息失败: ${response.status}`);
      }

      const rscText = await response.text();

      // 提取用户信息
      const userInfo = {
        points: 0,
        signinDays: 0,
        nickname: '',
        isVip: false
      };

      // 提取积分
      const pointsMatch = rscText.match(/"points"\s*:\s*(\d+)/);
      if (pointsMatch) {
        userInfo.points = parseInt(pointsMatch[1]);
      }

      // 提取签到天数
      const signinDaysMatch = rscText.match(/"signin_days_total"\s*:\s*(\d+)/);
      if (signinDaysMatch) {
        userInfo.signinDays = parseInt(signinDaysMatch[1]);
      }

      // 提取昵称
      const nicknameMatch = rscText.match(/"nickname"\s*:\s*"([^"]+)"/);
      if (nicknameMatch) {
        userInfo.nickname = nicknameMatch[1];
      }

      // 提取 VIP 状态
      const isVipMatch = rscText.match(/"is_vip"\s*:\s*(true|false)/);
      if (isVipMatch) {
        userInfo.isVip = isVipMatch[1] === 'true';
      }

      console.log(`✓ 用户信息: 积分=${userInfo.points}, 签到天数=${userInfo.signinDays}`);

      return userInfo;
    } catch (error) {
      console.error('❌ 获取用户积分失败:', error.message);
      throw error;
    }
  }
  /**
     * 智能搜索资源（支持积分解锁）
     * @param {string} tmdbId - TMDB ID
     * @param {string} mediaType - 媒体类型 ('movie' 或 'tv')
     * @param {Object} options - 选项
     * @param {boolean} options.usePoints - 是否使用积分解锁
     * @param {number} options.maxPoints - 最大使用积分数
     * @returns {Promise<Array>} 资源链接列表
     */
    async searchFromTmdbWithUnlock(tmdbId, mediaType, options = {}) {
      const { usePoints = false, maxPoints = 10 } = options;

      // 登录
      if (!await this.login()) {
        return [];
      }

      console.log(`\n🔍 智能搜索: tmdb_id=${tmdbId}, type=${mediaType}, 积分解锁=${usePoints}`);

      // 步骤 1：从 TMDB ID 获取 HDHive ID
      const hdhiveId = await this.getHDHiveIdFromTmdb(tmdbId, mediaType);
      if (!hdhiveId) {
        console.log('❌ 未找到 HDHive ID');
        return [];
      }

      // 步骤 2：获取资源页面
      const url = `${this.baseUrl}/${mediaType}/${hdhiveId}`;
      const { groupData } = await this.fetchMainPage(url);

      if (!groupData) {
        console.log('❌ 无法获取资源页面');
        return [];
      }

      // 步骤 3：检查是否有免费资源
      const freeLinks = [];
      const lockedResources = []; // 记录锁定的资源

      for (const [panType, resources] of Object.entries(groupData)) {
        if (!resources || resources.length === 0) continue;

        for (const resource of resources) {
          if (resource.is_unlocked) {
            // 已解锁的资源，获取链接
            console.log(`  ✓ 找到免费资源: ${resource.title || 'Unknown'} (${panType})`);

            // 构建链接
            if (resource.full_url) {
              let link = resource.full_url;
              if (resource.access_code) {
                link += `?password=${resource.access_code}`;
              }
              freeLinks.push(link);
            } else {
              // 虽然是 is_unlocked，但没有 full_url，需要"解锁"来获取链接
              console.log(`  ℹ️  免费资源无 full_url，需要解锁获取: ${resource.title || 'Unknown'}`);
              lockedResources.push({
                slug: resource.slug,
                panType: panType,
                title: resource.title || 'Unknown',
                points: resource.unlock_points || resource.points || 0,  // 优先使用 unlock_points
                isFree: true  // 标记为免费资源
              });
            }
          } else {
            // 锁定的资源
            lockedResources.push({
              slug: resource.slug,
              panType: panType,
              title: resource.title || 'Unknown',
              points: resource.unlock_points || resource.points || 0,  // 优先使用 unlock_points
              isFree: false
            });
          }
        }
      }

      console.log(`  📊 免费资源: ${freeLinks.length} 个, 锁定资源: ${lockedResources.length} 个`);

      // 步骤 4：如果有免费资源，直接返回
      if (freeLinks.length > 0) {
        console.log(`  ✓ 返回 ${freeLinks.length} 个免费资源`);
        return freeLinks;
      }

      // 步骤 5：如果没有免费资源但有需要解锁的资源
      if (lockedResources.length > 0) {
        // 优先解锁免费资源（is_unlocked 但没有 full_url 的）
        const freeResources = lockedResources.filter(r => r.isFree);
        const paidResources = lockedResources.filter(r => !r.isFree);

        if (freeResources.length > 0) {
          console.log(`  🔓 解锁免费资源（获取链接）...`);
          
          const unlockedLinks = [];
          for (const resource of freeResources) {
            try {
              console.log(`  🔓 解锁: ${resource.title} (免费)`);
              const result = await this.unlockResource(resource.slug, resource.panType);

              if (result.success && result.url) {
                unlockedLinks.push(result.url);
                console.log(`  ✓ 解锁成功`);
                // 只解锁一个，立即返回
                break;
              } else {
                console.log(`  ❌ 解锁失败: ${resource.title}`);
              }
            } catch (error) {
              console.log(`  ❌ 解锁异常: ${resource.title}, ${error.message}`);
            }

            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          if (unlockedLinks.length > 0) {
            console.log(`  🎉 免费资源解锁完成: ${unlockedLinks.length} 个\n`);
            return unlockedLinks;
          }
        }

        // 如果允许使用积分且有付费资源
        if (usePoints && paidResources.length > 0) {
          console.log(`  🔓 没有免费资源，尝试使用积分解锁（只解锁一个）...`);

          // 按积分从低到高排序（将 0 和 null 排到最后）
          paidResources.sort((a, b) => {
            const aPoints = a.points > 0 ? a.points : 9999;
            const bPoints = b.points > 0 ? b.points : 9999;
            return aPoints - bPoints;
          });

          const unlockedLinks = [];
          let totalPointsUsed = 0;

          // 只解锁第一个资源
          for (const resource of paidResources) {
            // 检查是否超过最大积分限制（使用预估积分）
            if (totalPointsUsed + resource.points > maxPoints) {
              console.log(`  ⚠️  跳过 ${resource.title}: 预估需要 ${resource.points} 积分，会超过限制 (已用 ${totalPointsUsed}/${maxPoints})`);
              continue;
            }

            try {
              // 显示解锁前的积分信息
              const pointsDisplay = resource.points > 0 ? `${resource.points} 积分` : '未知积分';
              console.log(`  🔓 解锁: ${resource.title} (${pointsDisplay})`);
              
              const result = await this.unlockResource(resource.slug, resource.panType);

              if (result.success && result.url) {
                unlockedLinks.push(result.url);
                
                // 检查是否已拥有（不消耗积分）
                if (result.already_owned) {
                  console.log(`  ✓ 解锁成功（已拥有，未消耗积分）`);
                } else if (resource.points > 0) {
                  // 如果解锁前有明确的积分数，累计它
                  totalPointsUsed += resource.points;
                  console.log(`  ✓ 解锁成功，消耗 ${resource.points} 积分，已使用 ${totalPointsUsed}/${maxPoints} 积分`);
                } else {
                  // 如果解锁前积分未知（0 或 null），提示用户查看余额
                  console.log(`  ✓ 解锁成功，实际消耗积分请查看账户余额`);
                }

                // 只解锁一个资源，立即停止
                break;
              } else {
                console.log(`  ❌ 解锁失败: ${resource.title}`);
              }
            } catch (error) {
              console.log(`  ❌ 解锁异常: ${resource.title}, ${error.message}`);
            }

            // 延迟，避免请求过快
            await new Promise(resolve => setTimeout(resolve, 1000));
          }

          console.log(`  🎉 积分解锁完成: ${unlockedLinks.length} 个资源\n`);
          return unlockedLinks;
        }
      }

      console.log(`  ❌ 没有可用资源\n`);
      return [];
    }

    /**
     * 获取用户积分和签到信息
     * @returns {Promise<Object>} 用户信息，包含积分、签到天数等
     */

}

module.exports = HDHiveClient;
