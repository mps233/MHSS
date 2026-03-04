# 更新 next-action ID

## 问题

如果登录失败并看到错误：`请求参数错误` 或 `Field validation for 'Username' failed`，说明 `next-action` ID 已经改变。

## 解决方法

### 步骤 1：用浏览器开发者工具获取新的 ID

1. **打开 Chrome 浏览器**

2. **按 F12 打开开发者工具**

3. **切换到 Network 标签**

4. **访问登录页面**
   ```
   https://hdhive.com/login
   ```

5. **输入用户名和密码，点击登录**

6. **在 Network 列表中找到 `login` 的 POST 请求**
   - 点击它

7. **查看 Request Headers**
   - 在右侧面板中点击 "Headers" 标签
   - 滚动到 "Request Headers" 部分
   - 找到 `next-action` 这一行
   - 复制它的值（一个 40 位的十六进制字符串）

### 步骤 2：更新代码

#### 方法 1：使用环境变量（推荐）

在 `.env` 文件中添加：
```bash
HDHIVE_NEXT_ACTION_ID=你复制的新值
```

#### 方法 2：修改代码

编辑 `hdhive_curl_client.py`，找到这一行（大约第 127 行）：
```python
next_action_id = os.getenv('HDHIVE_NEXT_ACTION_ID', '60a3fc399468c700be8a3ecc69cd86c911899c9c85')
```

将默认值替换为新的 ID：
```python
next_action_id = os.getenv('HDHIVE_NEXT_ACTION_ID', '你复制的新值')
```

### 步骤 3：测试

```bash
python3 hdhive_curl_client.py tmdb 278882 tv "$HDHIVE_USERNAME" "$HDHIVE_PASSWORD"
```

如果看到 `✓ 登录成功！（303 重定向）`，说明更新成功！

## 示例

假设你从浏览器中复制到的新值是：`abc123def456...`

### 使用环境变量：
```bash
# .env
HDHIVE_NEXT_ACTION_ID=abc123def456...
```

### 或修改代码：
```python
next_action_id = os.getenv('HDHIVE_NEXT_ACTION_ID', 'abc123def456...')
```

## 注意

- 这个 ID 是 Next.js 构建时生成的
- HDHive 更新代码时会改变
- 通常几个月才会变一次
- 建议使用环境变量方式，方便更新
