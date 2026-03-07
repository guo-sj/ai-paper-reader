## 项目简介

本项目是一个面向 AI 研究爱好者的「每日论文阅读助手」。
它会从公开数据源获取最新的 AI 相关论文，结合大模型自动生成摘要和要点，帮助你快速浏览当天值得关注的工作，并支持邮件订阅和后台管理订阅者。

### 当前功能概览

- **论文来源**
  - 默认从 HuggingFace 国内镜像站 `https://hf-mirror.com/api/daily_papers` 获取每日论文（国内直连，无需代理）。
  - 可通过 `HF_API_BASE` 环境变量切换为其他源（如原站 `https://huggingface.co`）。
  - 接口本身已经对论文做过初步筛选，聚焦 AI / 机器学习相关内容。
- **论文磁盘缓存**
  - 后端拉取的论文会持久化到 `server/papers-cache.json`，服务器重启后数据不丢失。
  - 前端请求 `/api/papers` 时优先读取磁盘缓存，点击「刷新」按钮时强制从 HF API 拉取并更新缓存。
- **论文筛选与展示**
  - 后端获取当天的论文列表，按 upvotes 降序排列，前端展示为卡片列表。
  - 用户可以选择不同的大模型（Gemini / DeepSeek）对论文进行自动分析，生成：
    - 精炼摘要
    - 关键创新点
    - 潜在影响
    - 相关性评分
- **定时任务（拉取与邮件分离）**
  - **每天 6:00 AM**：自动从 HF API 拉取论文并写入磁盘缓存。失败后按配置间隔重试，直到截止时间停止。
  - **每天 8:00 AM**：读取磁盘缓存，校验日期为今天后并发发送邮件（默认 5 并发），每封邮件独立处理，记录发送日志。
  - 拉取和发邮件解耦，HF API 短暂不可用不会导致邮件完全发不出去。
- **订阅功能（Double Opt-in）**
  - 用户在页面顶部填写邮箱后，系统发送确认邮件，用户点击邮件中的链接后才真正加入订阅。
  - 同一邮箱 5 分钟内只能发起一次确认请求（防滥用）。
  - 退订链接内嵌在每封邮件底部，附带 HMAC 签名 token；退订先展示确认页面，用户点击确认后才执行。
  - 订阅者数据保存在本地 JSON 文件（默认 `server/subscribers.json`，可通过 `SUBSCRIBERS_FILE` 环境变量修改路径）。
- **后台管理**
  - 提供一个 `/admin` 后台页面，只有管理员登录后才能访问。
  - 管理员可以查看所有订阅者、手动添加订阅者（直接生效，无需 double opt-in）、删除订阅者。
  - 新增邮件发送日志接口（`GET /api/admin/email-logs`），可查看最近 20 次批量发送记录。

---

## 技术栈与架构

### 前端

- **框架**：React + TypeScript
- **构建工具**：Vite
- **UI 特点**：
  - 响应式布局，适配桌面和移动端。
  - 论文卡片展示当天精选论文及 AI 分析结果。
  - 顶部提供模型选择、刷新按钮和订阅表单。
- **主要模块**：
  - `App.tsx`：主应用入口，负责加载论文、触发分析、展示结果。
  - `components/SubscriptionForm.tsx`：订阅邮箱表单。
  - `components/PaperCard.tsx`：论文卡片组件（展示论文信息与分析）。
  - `AdminApp.tsx`：管理员登录与订阅者管理 UI（在 `/admin` 路径下使用）。

### 后端

- **框架**：Express
- **运行时**：通过 `tsx` 直接运行 TypeScript，无需预编译
- **数据存储**：JSON 文件
  - `server/subscribers.json` — 订阅者数据
  - `server/papers-cache.json` — 论文磁盘缓存（自动生成）
  - `server/email-send-log.jsonl` — 邮件发送日志（自动生成，JSONL 格式，超 1000 行自动截断）
- **其他依赖**：
  - `nodemailer`：发送邮件（欢迎邮件与每日摘要）。
  - `node-cron`：定时任务（6:00 拉取论文、8:00 发送日报）。
  - `dotenv`：加载环境变量（先加载 `.env`，再加载 `.env.local` 覆盖）。
  - `node-fetch`：后端请求 HF 论文接口。
  - `https-proxy-agent` / `socks-proxy-agent`：支持 HTTP/SOCKS 代理访问外部 API。

---

## 环境变量配置

在项目根目录创建 `.env` 或 `.env.local` 文件。`.env.local` 会覆盖 `.env` 中的同名变量，适合本地开发时覆盖生产配置。

### 完整变量列表

```bash
# ==================== 论文数据源 ====================

# HuggingFace API 基础地址（可选）
# 默认使用国内镜像 https://hf-mirror.com，国内服务器无需代理即可访问。
# 如需切换回原站，取消注释下面这行：
# HF_API_BASE=https://huggingface.co

# HTTP/SOCKS 代理（可选）
# 如果使用原站且服务器在国内，需要配置代理。支持 HTTP/HTTPS/SOCKS5 协议。
# 使用国内镜像时不需要配置代理。
# HTTPS_PROXY=socks5://127.0.0.1:1080
# HTTP_PROXY=http://127.0.0.1:7890

# ==================== LLM API 密钥 ====================
# 至少配置一个，前端论文分析功能才能使用。
# 这些密钥通过 Vite 注入到前端，分析在浏览器中直接调用 LLM API。

GEMINI_API_KEY=你的_Gemini_API_Key
DEEPSEEK_API_KEY=你的_DeepSeek_API_Key

# ==================== 邮件服务（SMTP） ====================
# 如果不配置 SMTP_HOST，系统会以「模拟模式」将邮件内容输出到控制台，不真正发送。

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=你的_SMTP用户名
SMTP_PASS=你的_SMTP密码
SMTP_FROM="AI Insight <no-reply@ai-insight.com>"

# ==================== 管理员认证 ====================

ADMIN_USERNAME=admin
ADMIN_PASSWORD=请修改为强密码
ADMIN_SESSION_SECRET=请使用一个很长且随机的字符串

# ==================== 安全配置（可选） ====================

# 退订链接的 HMAC 签名密钥，默认复用 ADMIN_SESSION_SECRET
# UNSUBSCRIBE_SECRET=独立的随机字符串

# 订阅确认邮件的 HMAC 签名密钥，默认复用 ADMIN_SESSION_SECRET
# CONFIRM_SECRET=独立的随机字符串

# 服务的公网 URL，用于生成退订链接和确认链接（务必配置，否则链接指向 localhost）
BASE_URL=https://your-domain.com

# ==================== 定时任务（可选） ====================
# 注意：FETCH_CRON_SCHEDULE 必须早于 EMAIL_CRON_SCHEDULE 执行，
# 否则邮件发送时论文缓存可能尚未就绪。

# 论文拉取 cron 表达式（默认每天 6:00 AM）
# FETCH_CRON_SCHEDULE=0 6 * * *

# 邮件发送 cron 表达式（默认每天 8:00 AM）
# EMAIL_CRON_SCHEDULE=0 8 * * *

# 论文拉取失败后的重试间隔（分钟），默认 10
# FETCH_RETRY_INTERVAL_MINUTES=10

# 论文拉取重试截止时间（小时），默认 8（即 8:00 AM 后停止重试）
# FETCH_RETRY_DEADLINE_HOUR=8

# ==================== 性能调优（可选） ====================

# 批量发送邮件的并发数，默认 5
# EMAIL_CONCURRENCY=5

# ==================== 存储路径（可选） ====================

# 订阅者数据文件路径，默认为 server/subscribers.json
# 适合 Docker 部署时挂载持久化卷
# SUBSCRIBERS_FILE=/data/subscribers.json

# 邮件发送日志文件路径，默认为 server/email-send-log.jsonl
# EMAIL_LOG_PATH=/data/email-send-log.jsonl
```

### 变量说明速查表

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `HF_API_BASE` | 否 | `https://hf-mirror.com` | HF API 基础地址，国内默认用镜像站 |
| `HTTPS_PROXY` / `HTTP_PROXY` | 否 | 无 | 代理地址，支持 `http://`、`socks5://` 等 |
| `GEMINI_API_KEY` | 否 | 无 | Google Gemini API 密钥（前端分析用） |
| `DEEPSEEK_API_KEY` | 否 | 无 | DeepSeek API 密钥（前端分析用） |
| `SMTP_HOST` | 否 | 无 | 不配置则邮件输出到控制台 |
| `SMTP_PORT` | 否 | `587` | SMTP 端口 |
| `SMTP_USER` | 否 | 无 | SMTP 用户名 |
| `SMTP_PASS` | 否 | 无 | SMTP 密码 |
| `SMTP_FROM` | 否 | `"AI Insight" <no-reply@ai-insight.com>` | 发件人 |
| `ADMIN_USERNAME` | 否 | `admin` | 管理员用户名 |
| `ADMIN_PASSWORD` | 否 | `change_me_123` | 管理员密码，**务必修改** |
| `ADMIN_SESSION_SECRET` | 否 | 内置弱密钥 | 会话签名密钥，**务必修改** |
| `UNSUBSCRIBE_SECRET` | 否 | 同 `ADMIN_SESSION_SECRET` | 退订链接 HMAC 签名密钥 |
| `CONFIRM_SECRET` | 否 | 同 `ADMIN_SESSION_SECRET` | 订阅确认邮件 HMAC 签名密钥 |
| `BASE_URL` | **建议配置** | `http://localhost:3001` | 服务公网 URL，用于生成退订/确认链接 |
| `FETCH_CRON_SCHEDULE` | 否 | `0 6 * * *` | 论文拉取 cron 表达式 |
| `EMAIL_CRON_SCHEDULE` | 否 | `0 8 * * *` | 邮件发送 cron 表达式（必须晚于拉取） |
| `FETCH_RETRY_INTERVAL_MINUTES` | 否 | `10` | 论文拉取失败重试间隔（分钟） |
| `FETCH_RETRY_DEADLINE_HOUR` | 否 | `8` | 重试截止小时，超过后停止重试 |
| `EMAIL_CONCURRENCY` | 否 | `5` | 批量发送邮件的并发数 |
| `SUBSCRIBERS_FILE` | 否 | `server/subscribers.json` | 订阅者数据文件路径 |
| `EMAIL_LOG_PATH` | 否 | `server/email-send-log.jsonl` | 邮件发送日志文件路径 |
| `EMAIL_LOG_MAX_LINES` | 否 | `1000` | 日志文件最大行数，超过后自动截断 |
| `PORT` | 否 | `3001` | 后端服务监听端口 |

---

## 功能细节

### 1. 论文获取与缓存逻辑

- 后端 `server/server.ts` 中定义了 `fetchFromHuggingFace` 函数，从 HF API 获取数据。
- 拉取到的论文会通过 `server/papersCacheFile.ts` 持久化到 `server/papers-cache.json`。
- `/api/papers` 接口行为：
  - 默认请求：优先读取磁盘缓存返回，缓存为空时自动拉取 HF API。
  - `?refresh=true`：强制从 HF API 拉取并更新磁盘缓存。
  - HF API 失败时：返回已有的磁盘缓存（即使过期）。
- 论文数据结构包含：ID、标题、摘要、作者、发布时间、链接、分类、upvotes。
- 前端调用 `/api/papers` 获取论文列表，并根据用户选择的大模型调用浏览器端的分析服务。

### 2. 定时任务

| 时间 | 任务 | 说明 |
|------|------|------|
| 6:00 AM | 拉取论文 | 从 HF API 获取当天论文并写入磁盘缓存。失败后每 `FETCH_RETRY_INTERVAL_MINUTES` 分钟重试，直到 `FETCH_RETRY_DEADLINE_HOUR` 点停止 |
| 8:00 AM | 发送邮件 | 读取磁盘缓存，校验日期为今天后以 `EMAIL_CONCURRENCY` 并发向所有订阅者发送日报邮件，逐封记录结果到日志 |

两个 cron 时间均可通过环境变量调整，但**论文拉取必须早于邮件发送**，否则邮件发送时缓存可能尚未就绪。

### 3. 订阅功能实现

- **前端**
  - `SubscriptionForm.tsx` 提供一个邮箱输入框与订阅按钮。
  - 提交时调用 `POST /api/subscribe`，成功后显示后端返回的提示信息（如「请查收确认邮件」）。
  - 支持 loading / 成功 / 失败状态展示。
- **后端 — 订阅流程（Double Opt-in）**
  - `POST /api/subscribe`：
    - 验证邮箱格式（正则 + 254 字符长度限制）。
    - 速率限制：同一邮箱 5 分钟内只能请求一次（防滥用/垃圾邮件中继）。
    - 无论邮箱是否已存在，均返回相同的通用提示（防止邮箱探测攻击）。
    - 发送包含 HMAC 签名确认链接的验证邮件（24 小时过期）。
  - `GET /api/confirm-subscription?token=...`：
    - 验证 token 的签名和有效期。
    - 通过后将邮箱加入订阅者列表，发送欢迎邮件，展示成功页面。
- **后端 — 退订流程**
  - `GET /api/unsubscribe?email=...&token=...`：
    - 验证 HMAC token（无状态，不需要数据库查询）。
    - 展示退订确认页面（防止邮件安全扫描器预取 URL 导致误退订）。
  - `POST /api/unsubscribe`：
    - 验证 token 后执行退订，支持 HTML 表单和 JSON 两种格式响应。
  - 每封日报邮件底部附带个人专属退订链接，并附加 `List-Unsubscribe` / `List-Unsubscribe-Post` 邮件头（支持 Gmail / Outlook 客户端一键退订）。
- **批量发送机制**
  - 使用并发池（默认 5 并发，可通过 `EMAIL_CONCURRENCY` 调整）并行发送，大幅减少发送耗时。
  - 每封邮件独立处理，单封失败不影响其他邮件。
  - 快速失败：累计 3 次 SMTP 连接级错误（`ECONNREFUSED` 等）时中止整批，剩余邮件标记为 Skipped。
  - 每次批量发送结果（成功数、失败数、耗时、各邮件详情）记录到 JSONL 日志文件。

### 4. 管理员后台与订阅者管理

#### 4.1 管理员认证

- 通过环境变量配置管理员信息：`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`。
- 登录流程：
  - 前端 `/admin` 页面在未登录时显示登录表单。
  - 输入用户名和密码后，调用 `POST /api/admin/login`。
  - 后端验证通过后：
    - 生成随机 `sessionId`，使用 `ADMIN_SESSION_SECRET` 做 HMAC 签名，形成 `admin_session` Cookie。
    - 会话信息保存在内存 Map 中，默认 24 小时过期。
    - **注意**：管理员会话存储在内存中，服务器重启后需要重新登录。
- 退出登录：调用 `POST /api/admin/logout`，删除会话并清除 Cookie。

#### 4.2 订阅者管理 API

所有管理接口都在 `/api/admin/*` 路径下，且必须通过管理员认证：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/admin/login` | 管理员登录 |
| `POST` | `/api/admin/logout` | 管理员退出 |
| `GET` | `/api/admin/me` | 检查认证状态 |
| `GET` | `/api/admin/subscribers` | 获取所有订阅者 |
| `POST` | `/api/admin/subscribers` | 直接添加订阅者 `{ email, sendWelcome? }`（跳过 double opt-in） |
| `DELETE` | `/api/admin/subscribers/:id` | 删除订阅者 |
| `POST` | `/api/admin/send-test-email` | 发送测试邮件 `{ email }`，失败时返回错误详情 |
| `GET` | `/api/admin/email-logs` | 查看最近 20 次批量发送日志（含成功/失败数、耗时、逐封详情） |

**公开接口**（无需认证）：

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/subscribe` | 发起订阅（发送确认邮件） |
| `GET` | `/api/confirm-subscription` | 点击确认链接完成订阅 |
| `GET` | `/api/unsubscribe` | 展示退订确认页面（需 token） |
| `POST` | `/api/unsubscribe` | 执行退订（需 token） |
| `GET` | `/api/papers` | 获取论文列表（支持 `?refresh=true`） |

---

## 使用方法

### 本地运行

1. 安装依赖：

   ```bash
   npm install
   ```

2. 配置环境变量：在项目根目录创建 `.env` 或 `.env.local`，参考上方「环境变量配置」章节。

3. 启动开发服务器（同时启动前端和后端）：

   ```bash
   npm run dev
   ```

4. 打开浏览器访问：
   - 用户界面（阅读论文、订阅）：`http://localhost:3000/`
   - 管理员后台（登录并管理订阅者）：`http://localhost:3000/admin`

### 其他命令

```bash
npm run server    # 仅启动后端
npm run build     # 构建前端生产版本
npm run preview   # 预览生产构建
```

---

## 部署指南

### 1. 构建前端

```bash
npm install
npm run build
```

构建产物输出到 `dist/` 目录，包含纯静态资源（HTML / JS / CSS），可部署到 Nginx、Vercel、Netlify 等。

确保 `/` 和 `/admin` 路径都 fallback 到 `index.html`（SPA 路由需要）。

### 2. 部署后端

后端是一个独立运行的 Node.js 服务，负责：

- 从 HF API 拉取论文并缓存到磁盘
- 处理订阅/退订接口
- 管理后台接口
- 发送欢迎邮件与每日摘要邮件
- 执行 6:00 / 8:00 两个定时任务

#### 必要文件

- `server/` 目录（`server.ts`、`subscriberStoreFile.ts`、`papersCacheFile.ts`）
- `package.json` / `package-lock.json`
- `tsconfig.json`
- `.env`（环境变量配置）

#### 自动生成的数据文件

- `server/subscribers.json` — 订阅者数据（不存在时自动创建）
- `server/papers-cache.json` — 论文缓存（不存在时自动创建）
- `server/email-send-log.jsonl` — 邮件发送日志（不存在时自动创建，超 1000 行自动截断）

#### 启动后端服务

```bash
npm install
npm run server
```

生产环境推荐使用 `pm2` 守护进程：

```bash
npm install -g pm2
pm2 start "npm run server" --name ai-insight-server
```

#### 前端与后端的联通

生产环境中，前端通过相对路径 `/api/...` 访问后端，推荐使用 Nginx 反向代理：

- 静态资源：`https://your-domain.com/` → 指向前端 `dist/`
- API：`https://your-domain.com/api/*` → 反向代理到 `http://localhost:3001/api/*`

#### 数据备份

- **订阅者数据**：定期备份 `server/subscribers.json` 即可。
- **论文缓存**：`server/papers-cache.json` 无需备份，会自动重新拉取。
- **自定义路径**：可设置 `SUBSCRIBERS_FILE=/path/to/subscribers.json` 指定存储位置（适合 Docker 挂载持久化卷）。

---

### 3. 部署检查清单

- [ ] 前端 `npm run build` 成功，`dist/` 已部署到静态服务器
- [ ] 服务器上存在 `.env`，且已配置正确的环境变量
- [ ] `ADMIN_PASSWORD` 和 `ADMIN_SESSION_SECRET` 已修改为强随机值
- [ ] `BASE_URL` 已配置为服务的实际公网地址（用于生成退订/确认链接）
- [ ] 后端服务已启动，访问 `http://<server>:3001/api/papers` 能返回数据
- [ ] 通过浏览器访问首页 `/` 可以正常加载论文列表
- [ ] 通过 `/admin` 可以登录后台，能正常管理订阅者
- [ ] 若配置了 SMTP：
  - 用新邮箱订阅后能收到确认邮件，点击链接后成功加入订阅
  - 可通过管理后台「发送测试邮件」验证邮件模板和退订链接
  - 退订链接可正常打开确认页面并完成退订
  - 定时任务（6:00 拉取 + 8:00 发送）能正常工作
  - 管理后台「邮件发送日志」能查看到发送记录
- [ ] 邮件到达率（可选，提高邮件进入收件箱概率）：
  - 配置域名 SPF 记录
  - 配置域名 DKIM 签名
  - 配置域名 DMARC 策略
  - `SMTP_FROM` 的域名与 SPF/DKIM 一致
  - 可用 [mail-tester.com](https://www.mail-tester.com) 检查邮件评分
