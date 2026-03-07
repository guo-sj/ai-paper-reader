# Code Review 报告：server/server.ts 重构

**审查范围**: `server/server.ts`（约 424 行变更，共 916 行）、`components/SubscriptionForm.tsx`、`README.md`
**审查日期**: 2026-03-07
**审查方式**: 6 个专项 Agent 并行审查，按优先级合并

---

## 优先级总览

| 优先级 | 问题 | 严重程度 |
|--------|------|----------|
| P0 | §1.1 硬编码弱默认凭据 | CRITICAL |
| P0 | §1.3 完整 Admin 攻击链 | CRITICAL |
| P0 | §2.1 Subscribe 缺少 IP 速率限制（Spam Relay） | 高 |
| P0 | §2.2 Admin login 无暴力破解防护 | 高 |
| P1 | §1.2 三密钥共享回退，域隔离失败 | 高 |
| P1 | §5.1 Cookie 缺少 `Secure` 标志 | 高 |
| P1 | §5.4 GDPR 被遗忘权不合规 | 高 |
| P1 | §7.2 缺少 `/health` `/ready` 端点 | 高 |
| P1 | §7.4 `BASE_URL` 默认 localhost，链接静默失效 | 高 |
| P2 | §3.1 `sendEmail` 返回值未检查，SMTP 失败静默丢弃 | 中高 |
| P2 | §4.1 `connFailCount` 不重置，非连续失败触发 abort | 中高 |
| P2 | §1.4 退订令牌不可撤销 | 中 |
| P2 | §2.3 内存 Map 速率限制不可靠 | 中 |
| P2 | §3.2 Admin 路由 email 未归一化 | 中 |
| P2 | §5.2 日志存储明文邮箱（PII） | 中高 |
| P2 | §5.3 日志轮转无法定向删除 | 中 |
| P3 | §1.5 CORS 完全开放 | 中 |
| P3 | §4.2 变量名 `MAX_CONSECUTIVE_CONN_FAILURES` 误导 | 低 |
| P3 | §4.3 abort signal 无法中断已执行的 sendEmail | 低 |
| P3 | §6.1 单文件 916 行 God File | 高（可维护性） |
| P3 | §6.2 GET/POST unsubscribe 重复 token 验证 | 中 |
| P3 | §6.3 9 处 HTML 模板嵌入路由 | 中 |
| P3 | §6.4 日志中英混用 | 低 |
| P3 | §7.1 `generateUnsubscribeToken` 重复 HMAC 计算 | 低 |
| P3 | §7.3 `setInterval` 未清理，阻止 graceful shutdown | 中 |
| P3 | §7.5 `adminSessions` 无过期清理（内存泄漏） | 低 |
| P3 | §7.6 日志追加时全量读文件做轮转 | 低 |

---

## §1 密钥管理、令牌不可撤销性与 Admin 攻击链

### §1.1 硬编码弱默认凭据与密钥

**严重程度**: CRITICAL
**代码引用**: `server/server.ts:80-83`

```typescript
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_123';
const ADMIN_SESSION_SECRET =
    process.env.ADMIN_SESSION_SECRET || 'please_change_to_a_long_random_string';
```

如果部署时未配置环境变量，攻击者可使用公开的默认凭据直接登录管理后台。

**修复方案**：启动时强制校验，缺失则拒绝启动：

```typescript
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET;

if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    console.error(
        'FATAL: ADMIN_USERNAME, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET must be set in environment variables.'
    );
    process.exit(1);
}

if (ADMIN_SESSION_SECRET.length < 32) {
    console.error('FATAL: ADMIN_SESSION_SECRET must be at least 32 characters long.');
    process.exit(1);
}
```

---

### §1.2 三密钥共享回退，域隔离失败

**严重程度**: 高
**代码引用**: `server/server.ts:166-167`

```typescript
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || ADMIN_SESSION_SECRET;
const CONFIRM_SECRET = process.env.CONFIRM_SECRET || ADMIN_SESSION_SECRET;
```

当三个密钥相同时，任何一处泄漏同时危及 Admin 会话签名、退订令牌、订阅确认令牌。

**修复方案**（最小改动，从主密钥安全派生以保证域隔离）：

```typescript
const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET ||
    crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update('unsubscribe-domain').digest('hex');
const CONFIRM_SECRET = process.env.CONFIRM_SECRET ||
    crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update('confirm-domain').digest('hex');
```

---

### §1.3 完整攻击链

**严重程度**: CRITICAL

默认配置下的完整攻击路径：

1. **获取默认凭据**：用户名 `admin`、密码 `change_me_123`（公开在源码中）
2. **登录获取 session**：`POST /api/admin/login` → `Set-Cookie: admin_session=...`
3. **访问全部 Admin API**：
   - `GET /api/admin/subscribers` → 泄露所有订阅者邮箱
   - `DELETE /api/admin/subscribers/:id` → 批量删除订阅者
   - `POST /api/admin/send-test-email` → 向任意邮箱发邮件（spam relay）
   - `GET /api/admin/email-logs` → 读取包含所有邮箱的发送日志
4. **伪造令牌**：已知默认密钥 → 本地为任意邮箱生成退订/确认令牌，无需登录即可操作

修复依赖 §1.1、§1.2 和 §2.2 的修复共同完成。同时建议将 `SameSite=Lax` 升级为 `SameSite=Strict`：

```typescript
const cookie = [
    `admin_session=${encodeURIComponent(signed)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
    ...(isProduction ? ['Secure'] : []),
].join('; ');
```

---

### §1.4 退订令牌不可撤销

**严重程度**: 中
**代码引用**: `server/server.ts:71-76`

```typescript
function generateUnsubscribeToken(email: string): string {
    return crypto
        .createHmac('sha256', UNSUBSCRIBE_SECRET)
        .update(email.trim().toLowerCase())
        .digest('hex');
}
```

令牌仅由 `HMAC(secret, email)` 派生，无时间戳、无随机盐，永久有效且无法针对单用户撤销。

**修复方案 A**（最小改动，添加时间窗口）：

```typescript
function generateUnsubscribeToken(email: string): string {
    const window = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    return crypto
        .createHmac('sha256', UNSUBSCRIBE_SECRET)
        .update(`${window}:${email.trim().toLowerCase()}`)
        .digest('hex');
}

function verifyUnsubscribeToken(email: string, token: string): boolean {
    const currentWindow = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    for (const w of [currentWindow, currentWindow - 1]) {
        const expected = crypto
            .createHmac('sha256', UNSUBSCRIBE_SECRET)
            .update(`${w}:${email.trim().toLowerCase()}`)
            .digest('hex');
        const bufToken = Buffer.from(token);
        const bufExpected = Buffer.from(expected);
        if (bufToken.length === bufExpected.length && crypto.timingSafeEqual(bufToken, bufExpected)) {
            return true;
        }
    }
    return false;
}
```

---

### §1.5 CORS 完全开放

**严重程度**: 中
**代码引用**: `server/server.ts:36`

```typescript
app.use(cors());  // 允许所有来源
```

**修复方案**：

```typescript
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
}));
```

---

## §2 速率限制不足与 Spam Relay 风险

### §2.1 POST /api/subscribe 缺少 IP 维度速率限制

**严重程度**: 高
**代码引用**: `server/server.ts:198-200`, `server/server.ts:628-664`

当前速率限制仅以 `normalizedEmail` 为键，攻击者可从单一 IP 对大量不同邮箱发送订阅请求，将 SMTP 服务用作 spam relay，损害域名/IP 声誉。

**修复方案**：在现有 email 维度限制之上增加 IP 维度限制：

```typescript
const SUBSCRIBE_IP_RATE_LIMIT_MAX = Number(process.env.SUBSCRIBE_IP_RATE_LIMIT_MAX || 10);
const SUBSCRIBE_IP_RATE_LIMIT_WINDOW_MS = Number(process.env.SUBSCRIBE_IP_RATE_LIMIT_WINDOW_MS || 60 * 60 * 1000);
const subscribeIpRateLimit = new Map<string, { count: number; windowStart: number }>();

// 在 POST /api/subscribe 的 email 验证之后，email 速率限制之前插入：
const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
const now = Date.now();
const ipEntry = subscribeIpRateLimit.get(clientIp);
if (ipEntry) {
    if (now - ipEntry.windowStart < SUBSCRIBE_IP_RATE_LIMIT_WINDOW_MS) {
        if (ipEntry.count >= SUBSCRIBE_IP_RATE_LIMIT_MAX) {
            return res.json({ message: SUBSCRIBE_PENDING_MSG }); // 统一消息防枚举
        }
        ipEntry.count++;
    } else {
        subscribeIpRateLimit.set(clientIp, { count: 1, windowStart: now });
    }
} else {
    subscribeIpRateLimit.set(clientIp, { count: 1, windowStart: now });
}
```

> **注意**：若部署在反向代理后面，需设置 `app.set('trust proxy', 1)`，否则 `req.ip` 始终为 `127.0.0.1`。

---

### §2.2 Admin login 无暴力破解防护

**严重程度**: 高
**代码引用**: `server/server.ts:408-437`, `server/server.ts:80-81`

无失败次数限制、无延时机制，配合默认弱密码 `change_me_123` 极易被暴力破解。

**修复方案**：

```typescript
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOGIN_LOCKOUT_MS = Number(process.env.LOGIN_LOCKOUT_MS || 15 * 60 * 1000);
const LOGIN_BASE_DELAY_MS = 500;
const loginAttempts = new Map<string, { count: number; lastAttempt: number; lockedUntil: number }>();

app.post('/api/admin/login', async (req, res) => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const attempt = loginAttempts.get(clientIp);

    // 检查锁定
    if (attempt && attempt.lockedUntil > now) {
        const retryAfterSec = Math.ceil((attempt.lockedUntil - now) / 1000);
        res.setHeader('Retry-After', String(retryAfterSec));
        return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    const { username, password } = req.body || {};
    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        const current = attempt || { count: 0, lastAttempt: now, lockedUntil: 0 };
        current.count++;
        current.lastAttempt = now;
        if (current.count >= LOGIN_MAX_ATTEMPTS) {
            current.lockedUntil = now + LOGIN_LOCKOUT_MS;
            console.warn(`[Security] Admin login locked for IP ${clientIp} after ${current.count} failed attempts`);
            loginAttempts.set(clientIp, current);
            return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
        }
        loginAttempts.set(clientIp, current);
        // 渐进延时，防止高速暴力破解
        const delay = Math.min(LOGIN_BASE_DELAY_MS * Math.pow(2, current.count - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    // 登录成功，清除失败计数
    loginAttempts.delete(clientIp);
    // ... 原有 session 创建逻辑 ...
});
```

---

### §2.3 内存 Map 速率限制不可靠

**严重程度**: 中
**代码引用**: `server/server.ts:200`, `server/server.ts:92`

进程重启后速率限制状态丢失，多实例部署时不共享。

**修复方案**（三选一，按部署规模选择）：

- **方案 A（单实例）**：定期将 Map 序列化到磁盘，启动时恢复
- **方案 B（多实例生产环境）**：使用 Redis + `rate-limit-redis` store
- **方案 C（快速接入）**：使用 `express-rate-limit` 中间件：

```typescript
import rateLimit from 'express-rate-limit';

const subscribeIpLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { message: SUBSCRIBE_PENDING_MSG },
    keyGenerator: (req) => req.ip || 'unknown',
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many login attempts. Please try again later.' },
    keyGenerator: (req) => req.ip || 'unknown',
});

app.post('/api/subscribe', subscribeIpLimiter, async (req, res) => { /* ... */ });
app.post('/api/admin/login', loginLimiter, async (req, res) => { /* ... */ });
```

---

## §3 邮件正确性

### §3.1 `sendEmail` 返回值未检查，SMTP 失败静默丢弃

**严重程度**: 中高
**代码引用**: `server/server.ts:652`

`sendEmail` 内部捕获异常返回 `{ success: false }`（不会 throw），但调用方未检查返回值。SMTP 失败时用户收到"请查收确认邮件"提示，但实际没有邮件发出，订阅请求被静默丢弃。

对比：`POST /api/admin/send-test-email`（`server/server.ts:580-583`）正确检查了返回值。

**修复方案**：

```typescript
const confirmResult = await sendEmail(
    normalizedEmail,
    'Confirm your AI Insight subscription',
    confirmEmailHtml
);

if (!confirmResult.success) {
    console.error(`[subscribe] Failed to send confirmation email to ${normalizedEmail}: ${confirmResult.error}`);
    subscribeRateLimit.delete(normalizedEmail); // 清除限制，允许用户重试
    return res.status(500).json({ message: SUBSCRIBE_PENDING_MSG }); // 保持统一消息防枚举
}
```

---

### §3.2 Admin 路由 email 未做大小写归一化

**严重程度**: 中
**代码引用**: `server/server.ts:498-528`（对比 `server/server.ts:634`）

`POST /api/subscribe` 对 email 做了 `trim().toLowerCase()`，但 `POST /api/admin/subscribers` 直接使用原始值。若存储层区分大小写，可能导致重复订阅或退订失败。

**修复方案**：在 admin 路由中添加归一化：

```typescript
const normalizedEmail = email.trim().toLowerCase();
await addSubscriber(normalizedEmail);
```

---

## §4 邮件并发控制

### §4.1 `connFailCount` 只递增不重置

**严重程度**: 中高
**代码引用**: `server/server.ts:861-878`

`connFailCount` 成功发送时从不重置，实际上是"总失败计数"而非"连续失败计数"。在 1000 个订阅者中，仅 3 次离散的网络抖动就会触发 abort，过于敏感。

**修复方案**：成功发送时重置计数器：

```typescript
if (!result.success && SMTP_CONNECTION_ERRORS.some(code => result.error?.includes(code))) {
    connFailCount++;
    if (connFailCount >= MAX_CONSECUTIVE_CONN_FAILURES) {
        console.error(`[Cron email] SMTP unreachable (${connFailCount} consecutive connection failures). Aborting.`);
        signal.aborted = true;
    }
} else if (result.success) {
    connFailCount = 0; // 重置连续失败计数
}
```

---

### §4.2 变量名 `MAX_CONSECUTIVE_CONN_FAILURES` 误导

**严重程度**: 低
**代码引用**: `server/server.ts:814`

变量名暗示"连续失败"，但实际上是累计计数（配合 §4.1 修复后语义才对齐）。

**修复方案**：重命名为 `MAX_CONN_FAILURES_BEFORE_ABORT`，或在注释中说明语义。

---

### §4.3 abort signal 无法中断已执行的 sendEmail

**严重程度**: 低
**代码引用**: `server/server.ts:826, 832, 860`

`signal` 是简单的 `{ aborted: boolean }` 对象，worker 仅在拾取新任务时检查。abort 触发后，最多还有 `concurrency - 1` 封邮件正在发送无法取消。

**修复方案**（最佳折中，避免不必要的新 SMTP 连接）：

```typescript
const rawResults = await runWithConcurrency(emails, EMAIL_CONCURRENCY, async (email) => {
    if (signal.aborted) {
        return { success: false, email, error: 'Skipped: SMTP unreachable' } as SendEmailResult;
    }
    // ... 原有逻辑
}, signal);
```

> nodemailer 不支持 `AbortSignal`，真正的连接级中断暂不可行。建议在注释中说明 abort 的 graceful stop 语义。

---

## §5 Cookie 安全性与 PII 日志合规

### §5.1 admin_session Cookie 缺少 `Secure` 标志

**严重程度**: 高
**代码引用**: `server/server.ts:427-434`, `server/server.ts:449-455`

HTTP 连接下 admin session cookie 明文传输，可被 MITM 攻击截获。

**修复方案**：

```typescript
const isProduction = process.env.NODE_ENV === 'production' || BASE_URL.startsWith('https://');

const cookieParts = [
    `admin_session=${encodeURIComponent(signed)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
];
if (isProduction) cookieParts.push('Secure');
const cookie = cookieParts.join('; ');
```

登出路由的 `expiredCookie` 同理需要添加 `Secure` 标志。

---

### §5.2 日志文件存储明文邮箱地址（PII）

**严重程度**: 中高
**代码引用**: `server/server.ts:265`, `server/server.ts:897-910`

`EmailSendLog.details` 数组包含所有订阅者完整邮箱，日志文件成为高价值攻击目标，违反数据最小化原则（GDPR Article 5(1)(c)）。

额外 PII 泄露点（console 输出）：`server/server.ts:233`, `506`, `663`, `686`, `894`。

**修复方案**：

```typescript
// 日志中使用哈希替代明文邮箱
function hashEmail(email: string): string {
    return crypto.createHash('sha256').update(email.trim().toLowerCase()).digest('hex').substring(0, 12);
}

// console 输出使用部分脱敏
function maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!domain) return '***';
    const maskedLocal = local.length <= 2
        ? '*'.repeat(local.length)
        : local[0] + '*'.repeat(local.length - 2) + local[local.length - 1];
    return `${maskedLocal}@${domain}`;
}

// 写入日志时：
details: results.map(r => ({
    emailHash: hashEmail(r.email),  // 替代 email 字段
    success: r.success,
    messageId: r.messageId,
    error: r.error,
})),
```

---

### §5.3 日志轮转无法支持定向数据删除

**严重程度**: 中
**代码引用**: `server/server.ts:273-279`

JSONL 日志轮转是随机丢弃旧行，无法针对特定用户删除。读写之间也无锁，存在竞态条件。

**修复方案**（在 §5.2 哈希化后风险大幅降低）：添加按用户擦除日志的函数：

```typescript
async function purgeEmailFromLogs(emailToPurge: string): Promise<number> {
    const hash = hashEmail(emailToPurge);
    const content = await fs.readFile(EMAIL_LOG_PATH, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    let purgedCount = 0;

    const cleanedLines = lines.map(line => {
        try {
            const log: EmailSendLog = JSON.parse(line);
            const originalLen = log.details.length;
            log.details = log.details.filter(d => (d as any).emailHash !== hash && d.email !== emailToPurge);
            if (log.details.length < originalLen) purgedCount += originalLen - log.details.length;
            return JSON.stringify(log);
        } catch { return line; }
    });

    await fs.writeFile(EMAIL_LOG_PATH, cleanedLines.join('\n') + '\n', 'utf8');
    return purgedCount;
}

// 在退订流程中自动触发（server/server.ts:758-768）：
await removeSubscriberByEmail(email);
await purgeEmailFromLogs(email);
```

---

### §5.4 GDPR Article 17（被遗忘权）整体合规评估

**严重程度**: 高

| 数据位置 | 含 PII | 可定向删除 | 状态 |
|---------|--------|-----------|------|
| 订阅者存储文件 | 邮箱 | `removeSubscriberByEmail()` | 合规 |
| 邮件发送日志 | 邮箱 | 无删除机制 | **不合规** |
| 控制台输出 | 邮箱 | 无法追溯 | 取决于日志收集系统 |
| 速率限制 Map | 邮箱 | 10 分钟自动过期 | 基本合规 |

**建议**：实现管理员 GDPR 擦除端点：

```typescript
app.delete('/api/admin/user-data/:email', requireAdminAuth, async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });

    const results = {
        subscriberRemoved: await removeSubscriberByEmail(email),
        logEntriesPurged: await purgeEmailFromLogs(email),
    };
    subscribeRateLimit.delete(email.trim().toLowerCase());
    console.log(`[GDPR Erasure] Completed for ${maskEmail(email)}: ${JSON.stringify(results)}`);
    return res.json({ success: true, ...results });
});
```

---

## §6 可维护性

### §6.1 单文件 916 行 God File

**严重程度**: 高（可维护性）
**代码引用**: `server/server.ts:1-916`

认证、订阅、退订、邮件发送、cron 任务、HTML 模板、工具函数全部集中在单文件中。

**建议目录结构**：

```
server/
├── server.ts              # 入口：仅 app 初始化 + 路由注册 + listen (~40 行)
├── config.ts              # 环境变量集中管理
├── utils/
│   ├── html.ts            # escapeHtml, sanitizeUrl
│   ├── date.ts            # getTodayKey, toLocalDateKey, getYesterdayKey
│   └── validation.ts      # isValidEmail
├── auth/
│   ├── session.ts         # AdminSession, create/verify, parseCookies
│   ├── tokens.ts          # unsubscribe token, confirm token
│   └── middleware.ts      # requireAdminAuth, requireUnsubscribeToken
├── email/
│   ├── transport.ts       # nodemailer transporter + sendEmail
│   ├── templates.ts       # buildDailyEmailHtml + 所有 HTML 页面模板
│   └── log.ts             # appendEmailLog, EmailSendLog
├── papers/
│   └── fetcher.ts         # fetchFromHuggingFace, fetchAndCachePapers
├── routes/
│   ├── admin.ts           # /api/admin/* 路由
│   ├── subscribe.ts       # /api/subscribe, /api/confirm-subscription
│   └── unsubscribe.ts     # /api/unsubscribe (GET+POST)
├── cron/
│   └── jobs.ts            # fetch cron + email cron
├── subscriberStoreFile.ts # (已有)
└── papersCacheFile.ts     # (已有)
```

推荐实施顺序：先修低风险问题（§6.4 → §6.2 → §6.3），最后做大重构（§6.1）。

---

### §6.2 GET/POST `/api/unsubscribe` 重复 token 验证代码

**严重程度**: 中
**代码引用**: `server/server.ts:722-727` vs `server/server.ts:751-755`

两个路由包含完全相同的 HMAC token 验证逻辑。

**修复方案**：提取为中间件：

```typescript
function requireUnsubscribeToken(req: express.Request, res: express.Response, next: express.NextFunction) {
    const email = (req.query.email || req.body?.email) as string | undefined;
    const token = (req.query.token || req.body?.token) as string | undefined;
    if (!email || !token) {
        return res.status(400).send(req.method === 'GET' ? '<p>Invalid link.</p>' : JSON.stringify({ error: 'Email and token required' }));
    }
    const expected = generateUnsubscribeToken(email);
    const bufToken = Buffer.from(token);
    const bufExpected = Buffer.from(expected);
    if (bufToken.length !== bufExpected.length || !crypto.timingSafeEqual(bufToken, bufExpected)) {
        return res.status(403).send(req.method === 'GET'
            ? '<p>Invalid or expired unsubscribe link.</p>'
            : JSON.stringify({ error: 'Invalid unsubscribe token' }));
    }
    (req as any).unsubEmail = email;
    (req as any).unsubToken = token;
    next();
}
```

---

### §6.3 HTML 模板嵌入路由处理器（9 处）

**严重程度**: 中
**代码引用**: `server/server.ts:655`, `676`, `695`, `703`, `729-741`, `761`, `389-398`, `690`, `513`

建议提取到 `email/templates.ts`，提供统一的 `statusPage()` 外壳函数和 `pages` / `emails` 对象。细节见 §6.1 重构方案。

---

### §6.4 日志中英混用

**严重程度**: 低
**代码引用**: `server/server.ts:849`, `server/server.ts:854`

```typescript
// 改为英文：
console.error('[Cron email] Disk cache is empty, no papers to send. Skipping email dispatch.');
console.error(`[Cron email] No papers for today (${todayKey}) in cache (cached date: ${cached.dateKey}). Skipping email dispatch.`);
```

---

## §7 性能与运维

### §7.1 `generateUnsubscribeToken` 重复 HMAC 计算

**严重程度**: 低
**代码引用**: `server/server.ts:379`, `server/server.ts:865`

`buildDailyEmailHtml` 内部和外层 cron 循环各调用一次，每封邮件执行两次相同 HMAC-SHA256。

**修复方案**：将 token 作为参数传入 `buildDailyEmailHtml`，cron 循环中只计算一次：

```typescript
const unsubToken = generateUnsubscribeToken(email);  // 只调用一次
const personalizedHtml = buildDailyEmailHtml(cached.papers, email, unsubToken);
const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubToken}`;
```

---

### §7.2 缺少 `/health` `/ready` 端点

**严重程度**: 高（运维）

无健康检查端点，容器编排（K8s/Docker Compose）无法做 liveness/readiness 探针，负载均衡器无法感知服务状态。

**修复方案**：

```typescript
app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/ready', async (_req, res) => {
    const checks: Record<string, boolean> = {};
    try {
        const cached = await readPapersCache();
        checks.papersCache = cached !== null;
    } catch { checks.papersCache = false; }

    const allReady = Object.values(checks).every(Boolean);
    res.status(allReady ? 200 : 503).json({ status: allReady ? 'ready' : 'not_ready', checks });
});
```

---

### §7.3 `setInterval` 未清理，阻止 graceful shutdown

**严重程度**: 中
**代码引用**: `server/server.ts:203`, `server/server.ts:779`

速率限制清理定时器和 `fetchRetryInterval` 未在进程退出时清理，K8s Pod 收到 SIGTERM 后进程挂起直到被 SIGKILL。`app.listen()` 的返回值未保存，无法调用 `server.close()`。

**修复方案**：

```typescript
const rateLimitCleanupTimer = setInterval(() => { /* 清理逻辑 */ }, 10 * 60 * 1000);
const server = app.listen(PORT, () => { console.log(`Server running on http://localhost:${PORT}`); });

function gracefulShutdown(signal: string) {
    console.log(`[shutdown] Received ${signal}, shutting down gracefully...`);
    server.close(() => { console.log('[shutdown] HTTP server closed.'); });
    clearInterval(rateLimitCleanupTimer);
    if (fetchRetryInterval) { clearInterval(fetchRetryInterval); fetchRetryInterval = null; }
    setTimeout(() => { process.exit(1); }, 10_000).unref();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
```

---

### §7.4 `BASE_URL` 默认 localhost，生产环境链接静默失效

**严重程度**: 高
**代码引用**: `server/server.ts:69`

未配置 `BASE_URL` 时，所有用户可见链接（退订、订阅确认、`List-Unsubscribe` header）指向 `http://localhost:3001`，服务照常运行但链接全部失效。

**修复方案**：

```typescript
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

if (!process.env.BASE_URL) {
    console.warn('\n⚠️  WARNING: BASE_URL is not set! All user-facing links will point to localhost.\n');
}

if (process.env.NODE_ENV === 'production' && !process.env.BASE_URL) {
    console.error('FATAL: BASE_URL must be set in production. Exiting.');
    process.exit(1);
}
```

---

### §7.5 `adminSessions` 无过期清理（内存泄漏）

**严重程度**: 低
**代码引用**: `server/server.ts:92`

过期的 admin session 仅在被访问时才删除，长期运行会积累内存。

**修复方案**：合并到已有的速率限制清理定时器中：

```typescript
const rateLimitCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of subscribeRateLimit) {
        if (now - ts > SUBSCRIBE_RATE_LIMIT_MS * 2) subscribeRateLimit.delete(key);
    }
    for (const [id, session] of adminSessions) {
        if (session.expiresAt < now) adminSessions.delete(id);
    }
}, 10 * 60 * 1000);
```

---

### §7.6 日志追加时全量读文件做轮转

**严重程度**: 低
**代码引用**: `server/server.ts:268-284`

每次 `appendEmailLog` 后立即全量读取并解析整个日志文件检查行数，文件大时 I/O 开销明显。

**修复方案**：将轮转逻辑拆出为独立函数，仅在每日 cron 任务结束后调用一次。

---

## 积极发现

以下实现做得好，值得保留：

- **HMAC 验证全部使用 `crypto.timingSafeEqual()`**，且带长度预检查，防止时序攻击（4 处调用）
- **XSS 防护完整**：`escapeHtml()` 覆盖 5 种 HTML 特殊字符，`sanitizeUrl()` 阻断非 http/https 协议
- **Anti-enumeration 设计**：`POST /api/subscribe` 对所有情况返回相同通用消息，防止邮箱探测
- **退订流程 GET→POST 两步设计**：防止邮件安全扫描器预取 URL 导致误退订
- **存储层 `enqueue()` 序列化**：通过 Promise 链防止并发写入竞态，操作天然幂等
- **List-Unsubscribe / List-Unsubscribe-Post header** 符合 RFC 2369，支持邮件客户端一键退订
- **SMTP 连接错误快速失败机制**的整体思路正确

---

## 其他注意事项

- **CLAUDE.md 删除**：git status 显示 `CLAUDE.md` 被删除。确认是否有意为之，其他开发者是否有依赖。
