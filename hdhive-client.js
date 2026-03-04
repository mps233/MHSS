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
      
      const loginResponse = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/x-component',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Content-Type': 'text/plain;charset=UTF-8',
          'next-action': this.nextActionId,
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
      } else {
        console.error(`❌ 登录失败: ${loginResponse.status}`);
        const responseText = await loginResponse.text();
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
}

module.exports = HDHiveClient;
