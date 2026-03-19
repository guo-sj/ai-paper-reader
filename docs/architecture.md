# 技术栈与架构

## 前端

- **框架**：React + TypeScript
- **构建工具**：Vite
- **主要模块**
  - `App.tsx`：主应用入口，负责加载论文、展示结果
  - `components/SubscriptionForm.tsx`：订阅邮箱表单
  - `components/PaperCard.tsx`：论文卡片组件
  - `AdminApp.tsx`：管理员登录与订阅者管理 UI（`/admin`）

## 后端

- **框架**：Express
- **运行时**：通过 `tsx` 直接运行 TypeScript，无需预编译
- **数据存储**：JSON 文件（无需数据库）
  - `server/subscribers.json` — 订阅者数据
  - `server/papers-cache.json` — 论文磁盘缓存（自动生成）
  - `server/analyze_papers_result.json` — AI 分析结果缓存（自动生成）
  - `server/email-send-log.jsonl` — 邮件发送日志（自动生成，超 1000 行自动截断）
- **主要依赖**
  - `nodemailer`：发送邮件
  - `node-cron`：定时任务
  - `dotenv`：环境变量（先加载 `.env`，再加载 `.env.local` 覆盖）
  - `node-fetch`：请求 HF 论文接口与 OpenAI API
  - `https-proxy-agent` / `socks-proxy-agent`：HTTP/SOCKS 代理支持
