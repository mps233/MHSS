#!/usr/bin/env python3.12
"""
HDHive Python 桥接脚本
用于从 Node.js 调用查询免费 115 链接

工作模式：
1. 优先使用 Cookie（如果有效）
2. Cookie 无效时，使用 Playwright 自动登录获取新 Cookie
3. Cookie 自动保存到 hdhive_state.json，下次直接使用

重要：stdout 只输出 JSON 结果，所有日志输出到 stderr
"""

import sys
import json
import os
import time

# 添加 hdhive 模块路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'hdhive_module'))

STATE_FILE = 'hdhive_state.json'

def log(message):
    """输出日志到 stderr"""
    print(message, file=sys.stderr, flush=True)

def load_state():
    """加载保存的状态（Cookie）"""
    try:
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        log(f"加载状态文件失败: {e}")
    return {}

def save_state(state):
    """保存状态（Cookie）"""
    try:
        with open(STATE_FILE, 'w', encoding='utf-8') as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
        log(f"✓ Cookie 已保存到 {STATE_FILE}")
    except Exception as e:
        log(f"保存状态文件失败: {e}")

def check_cookie_valid(cookie: str, refresh_before: int = 3600):
    """检查 Cookie 是否有效"""
    import base64
    
    if not cookie:
        return False, "Cookie 为空"
    
    # 从 Cookie 中提取 token
    token = None
    for part in cookie.split(';'):
        part = part.strip()
        if part.startswith('token='):
            token = part.split('=', 1)[1]
            break
    
    if not token:
        return False, "Cookie 中无 token"
    
    try:
        # JWT 格式: header.payload.signature
        parts = token.split('.')
        if len(parts) != 3:
            return False, "token 格式错误"
        
        # 解码 payload（第二部分）
        payload = parts[1]
        # 补齐 base64 padding
        padding = 4 - len(payload) % 4
        if padding != 4:
            payload += '=' * padding
        
        decoded = base64.urlsafe_b64decode(payload)
        payload_data = json.loads(decoded)
        
        exp = payload_data.get('exp')
        if not exp:
            return False, "token 无过期时间"
        
        now = time.time()
        time_left = exp - now
        
        if time_left <= 0:
            return False, "Cookie 已过期"
        
        if time_left < refresh_before:
            hours_left = time_left / 3600
            return False, f"Cookie 将在 {hours_left:.1f} 小时后过期"
        
        return True, f"Cookie 有效，还有 {time_left / 3600:.1f} 小时"
        
    except Exception as e:
        return False, f"解析失败: {e}"

def query_hdhive_with_cookie(tmdb_id, media_type, cookie):
    """
    使用 Cookie 查询 HDHive（hdhive 模块）
    
    Args:
        tmdb_id: TMDB ID
        media_type: 'movie' 或 'tv'
        cookie: HDHive Cookie（必需）
    
    Returns:
        list: 成功返回免费 115 分享链接列表
        str: 返回 "COOKIE_EXPIRED" 表示 Cookie 过期
    """
    try:
        import hdhive
    except ImportError:
        log(f"✗ hdhive 模块未安装")
        return []
    
    try:
        log(f"使用 hdhive 模块查询")
        
        # 转换媒体类型
        h_type = hdhive.MediaType.MOVIE if media_type == 'movie' else hdhive.MediaType.TV
        
        links = []
        
        # 使用 Cookie 创建客户端
        log(f"使用 Cookie 创建 HDHive 客户端")
        client_context = hdhive.create_client(cookie=cookie)
        
        with client_context as client:
            # 1. 查询媒体信息
            media = client.get_media_by_tmdb_id(int(tmdb_id), h_type)
            
            if not media:
                log(f"✗ 未找到媒体 tmdb_id={tmdb_id}")
                return links
            
            log(f"✓ 找到媒体: slug={media.slug}, id={media.id}")
            
            # 2. 获取资源列表
            try:
                resources = client.get_resources(media.slug, h_type, media_id=media.id)
            except Exception as e:
                log(f"✗ 获取资源异常: {type(e).__name__}: {e}")
                if '401' in str(e):
                    log(f"⚠️ Cookie 可能已过期")
                    return "COOKIE_EXPIRED"
                return links
            
            if not resources or not resources.success:
                log(f"✗ 获取资源失败")
                return links
            
            log(f"✓ 获取到 {len(resources.resources)} 个资源")
            
            # 3. 筛选 115 资源（不管是否免费，都尝试获取）
            resources_115 = []
            for idx, item in enumerate(resources.resources):
                website_val = item.website.value if hasattr(item.website, 'value') else str(item.website)
                is_free = getattr(item, 'is_free', False)
                unlock_points = getattr(item, 'unlock_points', None)
                
                log(f"资源 {idx+1}: website={website_val}, is_free={is_free}, unlock_points={unlock_points}, slug={getattr(item, 'slug', 'N/A')}")
                
                # 只要是 115 资源就添加（不管是否免费）
                if website_val == '115':
                    resources_115.append(item)
            
            log(f"✓ 找到 {len(resources_115)} 个 115 资源，尝试获取链接...")
            
            # 4. 获取分享链接（尝试所有115资源，已解锁的会成功）
            for i, item in enumerate(resources_115):
                try:
                    log(f"正在获取第 {i+1}/{len(resources_115)} 个链接...")
                    share = client.get_share_url(item.slug)
                    if share and share.url:
                        # 调试：打印 share 对象的所有属性
                        log(f"Share 对象属性: {dir(share)}")
                        log(f"Share 对象内容: url={share.url}")
                        
                        # 尝试获取提取码的各种可能字段名
                        share_code = None
                        for attr in ['share_code', 'code', 'password', 'pwd', 'extract_code', 'access_code']:
                            if hasattr(share, attr):
                                val = getattr(share, attr)
                                if val:
                                    share_code = val
                                    log(f"找到提取码字段 {attr}: {val}")
                                    break
                        
                        if share_code:
                            full_url = f"{share.url}?password={share_code}"
                            log(f"✓ 获取成功: {share.url} (提取码: {share_code})")
                            links.append(full_url)
                        else:
                            log(f"✓ 获取成功: {share.url[:60]}... (无提取码)")
                            links.append(share.url)
                    else:
                        log(f"✗ 未获取到链接（可能需要解锁）")
                except Exception as e:
                    log(f"✗ 获取失败（可能需要解锁）: {type(e).__name__}: {str(e)[:100]}")
                    continue
        
        return links
        
    except Exception as e:
        log(f"✗ hdhive 模块查询失败: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc(file=sys.stderr)
        return []

def refresh_cookie_with_playwright(username, password):
    """使用 Playwright 自动登录获取新 Cookie（需要浏览器）
    
    推荐浏览器：
    - chromium-headless-shell（最轻量，Linux ~158MB，macOS ~184MB）
    - chromium（标准版，Linux ~282MB，macOS ~324MB）
    """
    try:
        from playwright.sync_api import sync_playwright, TimeoutError as PWTimeoutError
    except ImportError:
        log(f"✗ Playwright 未安装，无法使用浏览器自动登录")
        log(f"")
        log(f"如需浏览器自动登录功能，请安装 Playwright：")
        log(f"  pip install playwright")
        log(f"  # 推荐：安装轻量版浏览器（Linux ~158MB）")
        log(f"  playwright install chromium-headless-shell")
        log(f"  # 或标准版（Linux ~282MB）")
        log(f"  playwright install chromium")
        log(f"")
        log(f"或者手动获取 Cookie：")
        log(f"  1. 登录 https://hdhive.com")
        log(f"  2. 按 F12 打开开发者工具")
        log(f"  3. 在 Network 标签找到任意请求")
        log(f"  4. 复制 Cookie 值到 .env 文件的 HDHIVE_COOKIE")
        return None
    
    try:
        base_url = "https://hdhive.com"
        login_url = f"{base_url}/login"
        
        log(f"正在使用 Playwright 自动登录刷新 Cookie...")
        
        with sync_playwright() as pw:
            # 尝试使用轻量版浏览器，如果不存在则回退到标准版
            browser = None
            browser_name = None
            
            # 优先尝试 chromium（会自动使用 headless-shell 如果已安装）
            try:
                browser = pw.chromium.launch(headless=True)
                browser_name = "chromium"
                log(f"✓ 使用 Chromium 浏览器")
            except Exception as e:
                log(f"Chromium 不可用: {e}")
                
                # 尝试 webkit（更轻量）
                try:
                    browser = pw.webkit.launch(headless=True)
                    browser_name = "webkit"
                    log(f"✓ 使用 WebKit 浏览器")
                except Exception as e2:
                    log(f"WebKit 不可用: {e2}")
                    
                    # 最后尝试 firefox
                    try:
                        browser = pw.firefox.launch(headless=True)
                        browser_name = "firefox"
                        log(f"✓ 使用 Firefox 浏览器")
                    except Exception as e3:
                        log(f"Firefox 不可用: {e3}")
                        log(f"✗ 没有可用的浏览器，请安装：")
                        log(f"  playwright install chromium-headless-shell  # 推荐，~180MB")
                        log(f"  playwright install chromium  # 或标准版，~280MB")
                        return None
            
            if not browser:
                return None
            
            # 创建上下文，模拟真实浏览器
            context = browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                locale='zh-CN',
                timezone_id='Asia/Shanghai'
            )
            page = context.new_page()
            
            log(f"访问登录页: {login_url}")
            page.goto(login_url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(2000)
            
            # 填写用户名
            username_selectors = ['#username', 'input[name="username"]', 'input[name="email"]', 'input[type="email"]']
            username_filled = False
            for sel in username_selectors:
                try:
                    if page.query_selector(sel):
                        page.fill(sel, username)
                        log(f"✓ 填写用户名")
                        username_filled = True
                        break
                except Exception:
                    continue
            
            if not username_filled:
                log(f"✗ 未找到用户名输入框")
                context.close()
                browser.close()
                return None
            
            # 填写密码
            password_selectors = ['#password', 'input[name="password"]', 'input[type="password"]']
            password_filled = False
            for sel in password_selectors:
                try:
                    if page.query_selector(sel):
                        page.fill(sel, password)
                        log(f"✓ 填写密码")
                        password_filled = True
                        break
                except Exception:
                    continue
            
            if not password_filled:
                log(f"✗ 未找到密码输入框")
                context.close()
                browser.close()
                return None
            
            # 提交登录
            page.wait_for_timeout(500)
            try:
                btn = page.query_selector('button[type="submit"]')
                if btn:
                    btn.click()
                    log(f"✓ 点击登录按钮")
                else:
                    page.keyboard.press("Enter")
                    log(f"✓ 按 Enter 键提交")
            except Exception:
                page.keyboard.press("Enter")
            
            # 等待登录完成
            try:
                page.wait_for_load_state("domcontentloaded", timeout=15000)
            except Exception:
                pass
            
            # 增加等待时间，确保登录完成和 Cookie 设置
            page.wait_for_timeout(5000)
            
            # 检查当前 URL
            current_url = page.url
            log(f"登录后 URL: {current_url}")
            
            # 获取 Cookie
            cookies = context.cookies()
            log(f"获取到 {len(cookies)} 个 Cookie")
            
            token = None
            csrf_token = None
            
            for cookie in cookies:
                log(f"  Cookie: {cookie['name']} = {cookie['value'][:20]}..." if len(cookie['value']) > 20 else f"  Cookie: {cookie['name']} = {cookie['value']}")
                if cookie['name'] == 'token':
                    token = cookie['value']
                elif cookie['name'] == 'csrf_access_token':
                    csrf_token = cookie['value']
            
            context.close()
            browser.close()
            
            if token:
                cookie_str = f"token={token}"
                if csrf_token:
                    cookie_str += f"; csrf_access_token={csrf_token}"
                log(f"✓ 成功获取新 Cookie")
                return cookie_str
            else:
                log(f"✗ 登录后未获取到 token")
                return None
                
    except Exception as e:
        log(f"Playwright 登录失败: {type(e).__name__}: {e}")
        return None

def query_hdhive(tmdb_id, media_type, cookie, username=None, password=None):
    """
    查询 HDHive 免费 115 链接
    
    简化逻辑：
    1. 优先使用 Cookie（传入的或保存的）
    2. Cookie 无效时，使用 Playwright 获取新 Cookie
    3. 使用新 Cookie 查询
    
    Args:
        tmdb_id: TMDB ID
        media_type: 'movie' 或 'tv'
        cookie: HDHive Cookie（可选）
        username: HDHive 账号（可选，用于 Playwright 登录）
        password: HDHive 密码（可选，用于 Playwright 登录）
    
    Returns:
        list: 免费 115 分享链接列表
    """
    # 加载保存的状态
    state = load_state()
    
    # 优先使用传入的 Cookie
    if cookie and cookie.strip():
        log(f"使用传入的 Cookie")
        is_valid, reason = check_cookie_valid(cookie)
        if is_valid:
            log(f"Cookie 有效: {reason}")
        else:
            log(f"Cookie 状态: {reason}")
            cookie = None
    
    # 其次使用保存的 Cookie
    if not cookie and state.get('cookie'):
        log(f"使用保存的 Cookie")
        is_valid, reason = check_cookie_valid(state['cookie'])
        if is_valid:
            cookie = state['cookie']
            log(f"Cookie 有效: {reason}")
        else:
            log(f"保存的 Cookie 无效: {reason}")
            cookie = None
    
    # 如果没有有效的 Cookie，使用 Playwright 获取
    if not cookie:
        if username and password:
            log(f"")
            log(f"========== 使用 Playwright 获取 Cookie ==========")
            new_cookie = refresh_cookie_with_playwright(username, password)
            if new_cookie:
                cookie = new_cookie
                state['cookie'] = new_cookie
                state['username'] = username
                save_state(state)
                log(f"✓ Cookie 已获取并保存")
            else:
                log(f"✗ 获取 Cookie 失败")
                return []
        else:
            log(f"✗ 错误: 未提供有效的 Cookie 或账号密码")
            log(f"提示: 请在 .env 文件中配置 HDHIVE_COOKIE 或 HDHIVE_USERNAME/HDHIVE_PASSWORD")
            return []
    
    # 保存有效的 Cookie
    if cookie and cookie != state.get('cookie'):
        state['cookie'] = cookie
        save_state(state)
    
    # 使用 Cookie 查询
    log(f"")
    log(f"========== 使用 Cookie 查询 ==========")
    results = query_hdhive_with_cookie(tmdb_id, media_type, cookie)
    
    # 如果查询失败且是 401 错误，可能是 Cookie 过期了
    if results == "COOKIE_EXPIRED":
        if username and password:
            log(f"")
            log(f"========== Cookie 过期，重新获取 ==========")
            new_cookie = refresh_cookie_with_playwright(username, password)
            if new_cookie:
                cookie = new_cookie
                state['cookie'] = new_cookie
                save_state(state)
                log(f"✓ Cookie 已刷新，重试查询")
                
                log(f"")
                log(f"========== 使用新 Cookie 重试 ==========")
                results = query_hdhive_with_cookie(tmdb_id, media_type, new_cookie)
                if results == "COOKIE_EXPIRED":
                    log(f"✗ 新 Cookie 仍然失败")
                    return []
                return results
            else:
                log(f"✗ 刷新 Cookie 失败")
                return []
        else:
            log(f"✗ Cookie 过期但未配置账号密码，无法自动刷新")
            return []
    
    return results

if __name__ == '__main__':
    if len(sys.argv) < 4:
        result = {
            "success": False,
            "error": "用法: hdhive_bridge.py <tmdb_id> <type> <cookie> [username] [password]"
        }
        sys.stdout.write(json.dumps(result) + '\n')
        sys.stdout.flush()
        sys.exit(1)
    
    tmdb_id = sys.argv[1]
    media_type = sys.argv[2]
    cookie = sys.argv[3] if len(sys.argv) > 3 else ""
    username = sys.argv[4] if len(sys.argv) > 4 else None
    password = sys.argv[5] if len(sys.argv) > 5 else None
    
    try:
        links = query_hdhive(tmdb_id, media_type, cookie, username, password)
        
        result = {
            "success": True,
            "links": links,
            "count": len(links)
        }
        
        sys.stdout.write(json.dumps(result) + '\n')
        sys.stdout.flush()
        
    except Exception as e:
        result = {
            "success": False,
            "error": str(e)
        }
        sys.stdout.write(json.dumps(result) + '\n')
        sys.stdout.flush()
        sys.exit(1)
