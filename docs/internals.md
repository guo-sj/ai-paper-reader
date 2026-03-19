# 功能实现细节

## 1. 论文获取与分析流程

- `fetchFromHuggingFace` 从 HF API 获取数据，按 upvotes 降序排列后写入 `papers-cache.json`
- 随后对 Top 10 论文调用 GPT-4o 进行中文分析，结果写入 `analyze_papers_result.json`
- `/api/papers` 接口行为：
  - 默认：读取缓存，若不存在或非今日数据则自动触发完整的抓取+分析流程
  - `?refresh=true`：强制重新抓取并分析

## 2. 定时任务

| 时间（UTC） | 任务 |
|-------------|------|
| 1:00 AM | 抓取 → GPT-4o 分析 → 发送每日邮件。失败后按 `FETCH_RETRY_INTERVAL_MINUTES` 重试，直到 `FETCH_RETRY_DEADLINE_HOUR` 停止 |

## 3. 订阅流程（Double Opt-in）

- `POST /api/subscribe`：验证邮箱格式 → 速率限制（5 分钟/次）→ 发送 HMAC 签名确认邮件（24 小时有效）
- `GET /api/confirm-subscription?token=...`：验证签名和有效期 → 加入订阅者列表 → 发送欢迎邮件
- 退订：`GET /api/unsubscribe` 展示确认页，`POST /api/unsubscribe` 执行退订
- 每封邮件附带 `List-Unsubscribe` / `List-Unsubscribe-Post` 邮件头

## 4. 批量发送机制

- 并发池（默认 5）并行发送，单封失败不影响其他
- 累计 3 次 SMTP 连接错误时中止整批，剩余标记为 Skipped
- 每次发送结果记录到 JSONL 日志文件

## 5. 管理员后台

- 认证：HMAC 签名 Cookie，会话存储在内存（服务重启后需重新登录），默认 24 小时过期
- API 一览（均需认证）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/admin/login` | 管理员登录 |
| `POST` | `/api/admin/logout` | 退出 |
| `GET` | `/api/admin/me` | 检查认证状态 |
| `GET` | `/api/admin/subscribers` | 获取所有订阅者 |
| `POST` | `/api/admin/subscribers` | 直接添加订阅者（跳过 double opt-in） |
| `DELETE` | `/api/admin/subscribers/:id` | 删除订阅者 |
| `POST` | `/api/admin/send-test-email` | 发送测试邮件 |
| `GET` | `/api/admin/email-logs` | 查看最近 20 次发送日志 |
