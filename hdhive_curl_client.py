#!/usr/bin/env python3
"""
HDHive API 客户端 - 使用 curl-cffi（不需要浏览器）
基于 Neo 捕获的 API 端点

安装依赖：
pip install curl_cffi

使用方法：
python hdhive_curl_client.py url <hdhive_url> <username> <password>
python hdhive_curl_client.py id <hdhive_id> <type> <username> <password>
"""

import sys
import json
import re
from typing import List, Dict, Optional, Tuple
from curl_cffi import requests

class HDHiveClient:
    """HDHive API 客户端（使用 curl-cffi 模拟浏览器）"""
    
    def __init__(self, username: str, password: str, base_url: str = "https://hdhive.com"):
        self.base_url = base_url
        self.username = username
        self.password = password
        self.session = requests.Session()
        self.logged_in = False
        
        # 模拟 Chrome 120 的 TLS 指纹
        self.impersonate = 'chrome120'
        
        # 设置默认 headers
        self.session.headers.update({
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
            'Cache-Control': 'max-age=0',
        })
    
    def get_next_action_id(self) -> Optional[str]:
        """从登录页面自动获取 next-action ID"""
        try:
            login_page_url = f"{self.base_url}/login"
            response = self.session.get(
                login_page_url,
                impersonate=self.impersonate,
                timeout=30
            )
            
            if response.status_code == 200:
                html = response.text
                
                # 方法 1: 从 HTML 中查找（form action 或 data 属性）
                patterns = [
                    r'next-action["\']?\s*[:=]\s*["\']([a-f0-9]{40,})["\']',
                    r'action["\']?\s*[:=]\s*["\']([a-f0-9]{40,})["\']',
                    r'data-action["\']?\s*[:=]\s*["\']([a-f0-9]{40,})["\']',
                    r'"([a-f0-9]{40,})"',  # 任何 40+ 位的十六进制字符串
                ]
                
                for pattern in patterns:
                    matches = re.findall(pattern, html)
                    if matches:
                        # 取第一个匹配的，通常就是 next-action ID
                        action_id = matches[0]
                        if len(action_id) >= 40:  # 确保长度足够
                            print(f"✓ 自动获取到 next-action ID: {action_id[:20]}...", file=sys.stderr)
                            return action_id
                
                # 方法 2: 从 <script> 标签中的 JavaScript 代码查找
                script_pattern = r'<script[^>]*>(.*?)</script>'
                scripts = re.findall(script_pattern, html, re.DOTALL)
                
                for script in scripts:
                    # 查找类似 "60a3fc399468c700be8a3ecc69cd86c911899c9c85" 的字符串
                    hex_pattern = r'["\']([a-f0-9]{40,})["\']'
                    matches = re.findall(hex_pattern, script)
                    if matches:
                        action_id = matches[0]
                        print(f"✓ 从 JavaScript 中获取到 next-action ID: {action_id[:20]}...", file=sys.stderr)
                        return action_id
                
                print(f"⚠️  未找到 next-action ID，使用默认值", file=sys.stderr)
                return None
            else:
                return None
        except Exception as e:
            print(f"⚠️  获取 next-action ID 失败: {e}", file=sys.stderr)
            return None
    
    def login(self) -> bool:
        """登录 HDHive（使用 Next.js Server Actions）"""
        if self.logged_in:
            return True
        
        try:
            print(f"🔐 登录 HDHive...", file=sys.stderr)
            
            # 步骤 1：访问登录页面获取 Cookie
            login_page_url = f"{self.base_url}/login"
            response = self.session.get(
                login_page_url,
                impersonate=self.impersonate,
                timeout=30
            )
            
            if response.status_code != 200:
                print(f"❌ 访问登录页面失败: {response.status_code}", file=sys.stderr)
                return False
            
            print(f"✓ 访问登录页面成功", file=sys.stderr)
            
            # 尝试自动获取 next-action ID
            next_action_id = self.get_next_action_id()
            if not next_action_id:
                # 使用环境变量或默认值
                import os
                next_action_id = os.getenv('HDHIVE_NEXT_ACTION_ID', '60a3fc399468c700be8a3ecc69cd86c911899c9c85')
                print(f"  使用默认 next-action ID", file=sys.stderr)
            
            # 步骤 2：使用 Next.js Server Actions 登录
            # 基于捕获的真实请求数据
            login_api_url = f"{self.base_url}/login"
            
            # Next.js Server Actions 的特殊格式
            # 请求体是 JSON 数组：[{username, password}, redirect_path]
            login_payload = json.dumps([
                {
                    "username": self.username,
                    "password": self.password
                },
                "/"
            ])
            
            # Next.js Server Actions 需要特殊的 headers
            headers = {
                'Accept': 'text/x-component',
                'Content-Type': 'text/plain;charset=UTF-8',
                'next-action': next_action_id,  # 使用自动获取或默认的 Server Action ID
                'next-router-state-tree': '%5B%22%22%2C%7B%22children%22%3A%5B%22(auth)%22%2C%7B%22children%22%3A%5B%22login%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%5D%7D%2Cnull%2Cnull%2Ctrue%5D',
                'Referer': f'{self.base_url}/login',
            }
            
            response = self.session.post(
                login_api_url,
                data=login_payload,  # 使用 data 而不是 json，因为 Content-Type 是 text/plain
                headers=headers,
                impersonate=self.impersonate,
                timeout=30,
                allow_redirects=False  # 不自动跟随重定向，我们需要检查 303 状态码
            )
            
            # 检查是否登录成功（Next.js Server Actions 返回 303 重定向）
            if response.status_code == 303:
                print(f"✓ 登录成功！（303 重定向）", file=sys.stderr)
                
                # 检查响应头中的重定向信息
                redirect_header = response.headers.get('x-action-redirect', '')
                if redirect_header:
                    print(f"  重定向到: {redirect_header}", file=sys.stderr)
                
                self.logged_in = True
                return True
            else:
                print(f"❌ 登录失败: {response.status_code}", file=sys.stderr)
                print(f"   响应头: {dict(response.headers)}", file=sys.stderr)
                print(f"   响应体: {response.text[:200]}", file=sys.stderr)
                return False
            
        except Exception as e:
            print(f"❌ 登录异常: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc(file=sys.stderr)
            return False
    
    def extract_hdhive_id_from_url(self, url: str) -> Optional[Tuple[str, str]]:
        """从 HDHive URL 中提取媒体类型和 ID"""
        match = re.search(r'/(tv|movie)/([a-f0-9]{32})', url)
        if match:
            media_type, hdhive_id = match.groups()
            return media_type, hdhive_id
        return None
    
    def get_hdhive_id_from_tmdb(self, tmdb_id: str, media_type: str) -> Optional[str]:
        """从 TMDB ID 获取 HDHive ID（使用 RSC）"""
        if not self.logged_in:
            if not self.login():
                return None
        
        try:
            # 使用 RSC header 请求 TMDB 页面
            url = f"{self.base_url}/tmdb/{media_type}/{tmdb_id}"
            print(f"🔍 从 TMDB ID 获取 HDHive ID: {url}", file=sys.stderr)
            
            response = self.session.get(
                url,
                headers={'RSC': '1'},
                impersonate=self.impersonate,
                timeout=30
            )
            
            if response.status_code == 200:
                # 从 RSC 响应中提取 HDHive ID（32位十六进制）
                # HDHive ID 通常在 /{media_type}/{hdhive_id} 路径中
                hdhive_ids = re.findall(rf'/{media_type}/([a-f0-9]{{32}})', response.text)
                
                if hdhive_ids:
                    hdhive_id = hdhive_ids[0]  # 取第一个匹配的 ID
                    print(f"✓ 找到 HDHive ID: {hdhive_id}", file=sys.stderr)
                    return hdhive_id
                else:
                    print(f"❌ 未找到 HDHive ID", file=sys.stderr)
                    return None
            else:
                print(f"❌ 获取 HDHive ID 失败: {response.status_code}", file=sys.stderr)
                return None
                
        except Exception as e:
            print(f"❌ 获取 HDHive ID 异常: {e}", file=sys.stderr)
            return None
    
    def get_resource_ids_from_hdhive_id(self, hdhive_id: str, media_type: str) -> List[str]:
        """从 HDHive ID 获取资源 ID 列表（使用 RSC）"""
        if not self.logged_in:
            if not self.login():
                return []
        
        try:
            # 使用 RSC header 请求页面
            url = f"{self.base_url}/{media_type}/{hdhive_id}"
            print(f"🔍 获取资源 ID: {url}", file=sys.stderr)
            
            response = self.session.get(
                url,
                headers={'RSC': '1'},
                impersonate=self.impersonate,
                timeout=30
            )
            
            if response.status_code == 200:
                # 从 RSC 响应中提取所有 32 位十六进制 ID
                resource_ids = re.findall(r'([a-f0-9]{32})', response.text)
                unique_ids = list(set(resource_ids))
                
                print(f"✓ 找到 {len(unique_ids)} 个可能的资源 ID", file=sys.stderr)
                return unique_ids
            else:
                print(f"❌ 获取资源 ID 失败: {response.status_code}", file=sys.stderr)
                return []
                
        except Exception as e:
            print(f"❌ 获取资源 ID 异常: {e}", file=sys.stderr)
            return []
    
    def get_resource_links(self, resource_id: str) -> List[str]:
        """获取单个资源的 115 链接"""
        if not self.logged_in:
            if not self.login():
                return []
        
        try:
            resource_url = f"{self.base_url}/resource/115/{resource_id}"
            
            response = self.session.get(
                resource_url,
                impersonate=self.impersonate,
                timeout=30
            )
            
            if response.status_code == 200:
                # 从响应中提取 115 链接
                links = self.parse_115_links(response.text)
                return links
            else:
                print(f"❌ 获取资源失败: {response.status_code}", file=sys.stderr)
                return []
                
        except Exception as e:
            print(f"❌ 获取资源异常: {e}", file=sys.stderr)
            return []
    
    def parse_115_links(self, html: str) -> List[str]:
        """从 HTML 中解析 115 链接"""
        # 查找 115 链接（更精确的正则表达式）
        links = re.findall(r'(https?://115(?:cdn)?\.com/s/[a-zA-Z0-9]+(?:\?password=[a-zA-Z0-9]+)?)', html)
        
        # 去重并清理
        unique_links = []
        for link in links:
            # 移除可能的尾部字符
            link = link.rstrip('\\#;')
            if link not in unique_links:
                unique_links.append(link)
        
        return unique_links
    
    def search_free_resources(self, hdhive_id: str, media_type: str) -> List[str]:
        """搜索免费的 115 资源（只返回带密码的已解锁链接）"""
        # 步骤 1：从 HDHive ID 获取资源 ID 列表
        resource_ids = self.get_resource_ids_from_hdhive_id(hdhive_id, media_type)
        
        if not resource_ids:
            print(f"⚠️  未找到资源 ID", file=sys.stderr)
            return []
        
        # 步骤 2：获取每个资源的 115 链接
        all_links = []
        for i, resource_id in enumerate(resource_ids, 1):
            print(f"  [{i}/{len(resource_ids)}] 测试资源: {resource_id}", file=sys.stderr)
            links = self.get_resource_links(resource_id)
            if links:
                all_links.extend(links)
        
        # 去重
        all_links = list(set(all_links))
        
        # 只保留带 password 参数的链接（已解锁）
        unlocked_links = [link for link in all_links if '?password=' in link]
        
        print(f"✓ 总共找到 {len(all_links)} 个 115 链接，其中 {len(unlocked_links)} 个已解锁", file=sys.stderr)
        for i, link in enumerate(unlocked_links, 1):
            print(f"  [{i}] {link}", file=sys.stderr)
        
        return unlocked_links
    
    def search_from_url(self, url: str) -> List[str]:
        """从 HDHive URL 搜索资源"""
        # 提取 HDHive ID
        result = self.extract_hdhive_id_from_url(url)
        if not result:
            print(f"❌ 无法从 URL 中提取 HDHive ID: {url}", file=sys.stderr)
            return []
        
        media_type, hdhive_id = result
        print(f"✓ 提取到 HDHive ID: {hdhive_id} (类型: {media_type})", file=sys.stderr)
        
        # 搜索资源
        return self.search_free_resources(hdhive_id, media_type)
    
    def get_media_api(self, tmdb_id: str, media_type: str) -> Optional[Dict]:
        """
        通过 API 获取媒体信息（需要从 Neo 捕获的数据中确认实际的 API）
        这是一个示例，实际的 API 端点需要根据 Neo 捕获的数据调整
        """
        if not self.logged_in:
            if not self.login():
                return None
        
        try:
            # 尝试 GraphQL API
            api_url = f"{self.base_url}/api/graphql"
            query_data = {
                "operationName": "GetMediaByTmdb",
                "variables": {
                    "tmdbId": int(tmdb_id),
                    "type": media_type.upper()
                },
                "query": """
                    query GetMediaByTmdb($tmdbId: Int!, $type: MediaType!) {
                        mediaByTmdb(tmdbId: $tmdbId, type: $type) {
                            id
                            title
                            slug
                            resources {
                                id
                                title
                                website
                                isFree
                                shareUrl
                            }
                        }
                    }
                """
            }
            
            response = self.session.post(
                api_url,
                json=query_data,
                impersonate=self.impersonate,
                timeout=30
            )
            
            if response.status_code == 200:
                result = response.json()
                if 'data' in result:
                    return result['data']
            
            # 尝试 REST API
            api_url = f"{self.base_url}/api/media/tmdb/{media_type}/{tmdb_id}"
            response = self.session.get(
                api_url,
                impersonate=self.impersonate,
                timeout=30
            )
            
            if response.status_code == 200:
                return response.json()
            
            return None
            
        except Exception as e:
            print(f"❌ API 调用异常: {e}", file=sys.stderr)
            return None


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print(json.dumps({
            "success": False,
            "error": "用法:\n  python hdhive_curl_client.py url <hdhive_url> <username> <password>\n  python hdhive_curl_client.py id <hdhive_id> <type> <username> <password>\n  python hdhive_curl_client.py tmdb <tmdb_id> <type> <username> <password>"
        }))
        sys.exit(1)
    
    action = sys.argv[1]
    
    if action == 'tmdb':
        # 从 TMDB ID 搜索
        if len(sys.argv) < 6:
            print(json.dumps({
                "success": False,
                "error": "用法: python hdhive_curl_client.py tmdb <tmdb_id> <type> <username> <password>"
            }))
            sys.exit(1)
        
        tmdb_id = sys.argv[2]
        media_type = sys.argv[3]
        username = sys.argv[4]
        password = sys.argv[5]
        
        # 创建客户端
        client = HDHiveClient(username, password)
        
        # 登录
        if not client.login():
            print(json.dumps({
                "success": False,
                "error": "登录失败"
            }))
            sys.exit(1)
        
        # 从 TMDB ID 获取 HDHive ID
        hdhive_id = client.get_hdhive_id_from_tmdb(tmdb_id, media_type)
        
        if not hdhive_id:
            print(json.dumps({
                "success": False,
                "error": "无法从 TMDB ID 获取 HDHive ID"
            }))
            sys.exit(1)
        
        # 搜索资源
        links = client.search_free_resources(hdhive_id, media_type)
        
        # 输出结果
        result = {
            "success": True,
            "links": links,
            "count": len(links)
        }
        
        print(json.dumps(result))
        
    elif action == 'url':
        # 从 URL 搜索
        if len(sys.argv) < 5:
            print(json.dumps({
                "success": False,
                "error": "用法: python hdhive_curl_client.py url <hdhive_url> <username> <password>"
            }))
            sys.exit(1)
        
        url = sys.argv[2]
        username = sys.argv[3]
        password = sys.argv[4]
        
        # 创建客户端
        client = HDHiveClient(username, password)
        
        # 登录
        if not client.login():
            print(json.dumps({
                "success": False,
                "error": "登录失败"
            }))
            sys.exit(1)
        
        # 搜索资源
        links = client.search_from_url(url)
        
        # 输出结果
        result = {
            "success": True,
            "links": links,
            "count": len(links)
        }
        
        print(json.dumps(result))
        
    elif action == 'id':
        # 从 HDHive ID 搜索
        if len(sys.argv) < 6:
            print(json.dumps({
                "success": False,
                "error": "用法: python hdhive_curl_client.py id <hdhive_id> <type> <username> <password>"
            }))
            sys.exit(1)
        
        hdhive_id = sys.argv[2]
        media_type = sys.argv[3]
        username = sys.argv[4]
        password = sys.argv[5]
        
        # 创建客户端
        client = HDHiveClient(username, password)
        
        # 登录
        if not client.login():
            print(json.dumps({
                "success": False,
                "error": "登录失败"
            }))
            sys.exit(1)
        
        # 搜索资源
        links = client.search_free_resources(hdhive_id, media_type)
        
        # 输出结果
        result = {
            "success": True,
            "links": links,
            "count": len(links)
        }
        
        print(json.dumps(result))
        
    else:
        print(json.dumps({
            "success": False,
            "error": f"未知操作: {action}"
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
