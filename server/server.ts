
import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import cron from 'node-cron';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import {
    addSubscriber,
    listEmails,
    listSubscribers,
    removeSubscriberByEmail,
    removeSubscriberById,
    EmailAlreadySubscribedError,
} from './subscriberStoreFile.js';
import { readPapersCache, writePapersCache } from './papersCacheFile.js';
import { analyzeWithOpenAI } from './analyzeService.js';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
// Load local overrides after .env so per-machine settings win.
dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });

const app = express();
const PORT = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// --- Subscriber Store ---
// Uses JSON file storage (no sqlite dependency). Configure path via SUBSCRIBERS_FILE.

// --- Utility Functions ---

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function sanitizeUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) {
        return escapeHtml(url);
    }
    return '#';
}

function isValidEmail(email: string): boolean {
    if (typeof email !== 'string') return false;
    const trimmed = email.trim();
    if (trimmed.length > 254) return false; // RFC 5321
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// Stateless HMAC token for unsubscribe links — no DB storage needed
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '');

function generateUnsubscribeToken(email: string): string {
    return crypto
        .createHmac('sha256', UNSUBSCRIBE_SECRET)
        .update(email.trim().toLowerCase())
        .digest('hex');
}

// --- Admin Auth Config & Session Management ---

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change_me_123';
const ADMIN_SESSION_SECRET =
    process.env.ADMIN_SESSION_SECRET || 'please_change_to_a_long_random_string';

interface AdminSession {
    id: string;
    createdAt: number;
    expiresAt: number;
}

const ADMIN_SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const adminSessions = new Map<string, AdminSession>();

function createSignedSessionId(): { rawId: string; signed: string } {
    const rawId = crypto.randomUUID();
    const hmac = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(rawId).digest('hex');
    const signed = `${rawId}.${hmac}`;
    return { rawId, signed };
}

function verifySignedSessionId(signed: string): string | null {
    const [rawId, sig] = signed.split('.');
    if (!rawId || !sig) return null;

    const expected = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(rawId).digest('hex');

    const bufSig = Buffer.from(sig);
    const bufExpected = Buffer.from(expected);
    if (bufSig.length !== bufExpected.length) return null;

    if (!crypto.timingSafeEqual(bufSig, bufExpected)) {
        return null;
    }

    return rawId;
}

function parseCookies(req: express.Request): Record<string, string> {
    const header = req.headers['cookie'];
    const cookies: Record<string, string> = {};
    if (!header) return cookies;

    const parts = header.split(';');
    for (const part of parts) {
        const [rawKey, ...rest] = part.split('=');
        if (!rawKey || rest.length === 0) continue;
        const key = rawKey.trim();
        const value = rest.join('=').trim();
        cookies[key] = decodeURIComponent(value);
    }
    return cookies;
}

function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    try {
        const cookies = parseCookies(req);
        const signed = cookies['admin_session'];
        if (!signed) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const rawId = verifySignedSessionId(signed);
        if (!rawId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const session = adminSessions.get(rawId);
        if (!session) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        if (session.expiresAt < Date.now()) {
            adminSessions.delete(rawId);
            return res.status(401).json({ error: 'Session expired' });
        }

        (req as any).adminSession = session;
        session.expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;

        next();
    } catch (error) {
        console.error('Admin auth error:', error);
        return res.status(401).json({ error: 'Unauthorized' });
    }
}

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET || ADMIN_SESSION_SECRET;
const CONFIRM_SECRET = process.env.CONFIRM_SECRET || ADMIN_SESSION_SECRET;
const CONFIRM_TOKEN_MAX_AGE_S = 24 * 60 * 60; // 24 hours

function generateConfirmToken(email: string): string {
    const ts = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ email, ts });
    const sig = crypto.createHmac('sha256', CONFIRM_SECRET).update(payload).digest('hex');
    return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}

function verifyConfirmToken(token: string): string | null {
    try {
        const outer = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
        const { payload, sig } = outer;
        if (!payload || !sig) return null;

        const expectedSig = crypto.createHmac('sha256', CONFIRM_SECRET).update(payload).digest('hex');
        const bufSig = Buffer.from(sig);
        const bufExpected = Buffer.from(expectedSig);
        if (bufSig.length !== bufExpected.length || !crypto.timingSafeEqual(bufSig, bufExpected)) {
            return null;
        }

        const { email, ts } = JSON.parse(payload);
        if (Date.now() / 1000 - ts > CONFIRM_TOKEN_MAX_AGE_S) return null;
        return email as string;
    } catch {
        return null;
    }
}

// Rate limit for /api/subscribe: same email can only request once per 5 minutes
const SUBSCRIBE_RATE_LIMIT_MS = 5 * 60 * 1000;
const subscribeRateLimit = new Map<string, number>(); // email -> last request timestamp

// Periodically clean up expired entries to avoid memory leak
setInterval(() => {
    const now = Date.now();
    for (const [key, ts] of subscribeRateLimit) {
        if (now - ts > SUBSCRIBE_RATE_LIMIT_MS * 2) subscribeRateLimit.delete(key);
    }
}, 10 * 60 * 1000);

// --- Email Service ---
const transporter = nodemailer.createTransport({
    // For development, we can use a dummy transport or look for Ethereal credentials
    // For now, we will use JSON transport which logs to console if no SMTP provided
    // In production, user should provide SMTP_HOST, SMTP_USER, SMTP_PASS in .env
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || 'ethereal_user',
        pass: process.env.SMTP_PASS || 'ethereal_pass',
    },
});

interface SendEmailResult {
    success: boolean;
    email: string;
    messageId?: string;
    error?: string;
}

const sendEmail = async (to: string, subject: string, html: string, headers?: Record<string, string>): Promise<SendEmailResult> => {
    if (!process.env.SMTP_HOST) {
        console.log(`[MOCK EMAIL] To: ${to}\nSubject: ${subject}\nBody Preview: ${html.substring(0, 100)}...`);
        return { success: true, email: to, messageId: 'mock' };
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"AI Insight" <no-reply@ai-insight.com>',
            to,
            subject,
            html,
            headers: headers || {},
        });
        console.log('Message sent: %s', info.messageId);
        return { success: true, email: to, messageId: info.messageId };
    } catch (error: any) {
        console.error('Error sending email:', error);
        return { success: false, email: to, error: error?.message || String(error) };
    }
};

// --- Email Send Log ---
// Note: log entries contain email addresses (PII). File is admin-only accessible.
const EMAIL_LOG_PATH = process.env.EMAIL_LOG_PATH || path.resolve(__dirname, 'email-send-log.jsonl');
const EMAIL_LOG_MAX_LINES = Number(process.env.EMAIL_LOG_MAX_LINES || 1000);

interface EmailSendLog {
    timestamp: string;
    dateKey: string;
    totalSubscribers: number;
    succeeded: number;
    failed: number;
    durationMs: number;
    details: Array<{ email: string; success: boolean; messageId?: string; error?: string }>;
}

async function appendEmailLog(log: EmailSendLog): Promise<void> {
    try {
        const line = JSON.stringify(log) + '\n';
        await fs.appendFile(EMAIL_LOG_PATH, line, 'utf8');

        // Rotate: keep last half when exceeding max lines
        const content = await fs.readFile(EMAIL_LOG_PATH, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        if (lines.length > EMAIL_LOG_MAX_LINES) {
            const kept = lines.slice(-Math.floor(EMAIL_LOG_MAX_LINES / 2));
            await fs.writeFile(EMAIL_LOG_PATH, kept.join('\n') + '\n', 'utf8');
        }
    } catch (err) {
        // Log write failure must not affect the main email-sending flow
        console.error('[EmailLog] Failed to write email log:', err);
    }
}

const getTodayKey = (): string => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const toLocalDateKey = (isoString: string): string => {
    const d = new Date(isoString);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const getYesterdayKey = (): string => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

// --- Fetch Papers Logic ---

/** Fetch papers from HuggingFace API, filter/sort, and return them. Does NOT touch cache. */
const fetchFromHuggingFace = async () => {
    const todayKey = getTodayKey();
    const url = process.env.HF_API_BASE
        ? `${process.env.HF_API_BASE}/api/daily_papers`
        : 'https://hf-mirror.com/api/daily_papers';
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    const fetchOptions: any = {
        timeout: 30000,
    };
    if (proxyUrl) {
        console.log(`Using proxy: ${proxyUrl}`);
        if (proxyUrl.startsWith('socks://') || proxyUrl.startsWith('socks5://') || proxyUrl.startsWith('socks4://')) {
            fetchOptions.agent = new SocksProxyAgent(proxyUrl);
        } else {
            fetchOptions.agent = new HttpsProxyAgent(proxyUrl);
        }
    }

    const response = await fetch(url, fetchOptions);
    if (!response.ok) throw new Error('Failed to fetch from HF');
    const data = await response.json() as any[];

    let filteredData = data.filter((item: any) =>
        item.paper?.submittedOnDailyAt && toLocalDateKey(item.paper.submittedOnDailyAt) === todayKey
    );
    if (filteredData.length === 0) {
        const yesterdayKey = getYesterdayKey();
        filteredData = data.filter((item: any) =>
            item.paper?.submittedOnDailyAt && toLocalDateKey(item.paper.submittedOnDailyAt) === yesterdayKey
        );
    }
    console.log(`Filtered papers count: ${filteredData.length} (date: ${todayKey})`);

    const papers = filteredData.map((item: any) => {
        const p = item.paper;
        return {
            id: p.id,
            title: p.title,
            summary: p.summary,
            authors: p.authors.map((a: any) => a.name),
            published: p.publishedAt,
            link: `https://huggingface.co/papers/${p.id}`,
            category: p.ai_keywords ? p.ai_keywords[0] : 'AI',
            upvotes: item.paper.upvotes || 0
        };
    });

    papers.sort((a, b) => (b.upvotes || 0) - (a.upvotes || 0));
    console.log('Papers sorted by upvotes (top 3):', papers.slice(0, 3).map(p => ({ title: p.title, upvotes: p.upvotes })));

    return { dateKey: todayKey, papers };
};

/** Fetch from HF and persist to disk cache. Returns the papers. */
const fetchAndCachePapers = async () => {
    const { dateKey, papers } = await fetchFromHuggingFace();
    await writePapersCache(dateKey, papers);
    return papers;
};

const buildDailyEmailHtml = (papers: Array<{
    title: string;
    summary: string;
    link: string;
}>, subscriberEmail: string) => {
    const unsubToken = generateUnsubscribeToken(subscriberEmail);
    const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(subscriberEmail)}&token=${unsubToken}`;

    const paperHtml = papers.map((p) => `
        <div style="margin-bottom: 20px; padding-bottom: 20px; border-bottom: 1px solid #eee;">
            <h3 style="margin: 0 0 10px 0;"><a href="${sanitizeUrl(p.link)}">${escapeHtml(p.title)}</a></h3>
            <p style="color: #666; font-size: 14px; line-height: 1.5;">${escapeHtml(p.summary)}</p>
        </div>
    `).join('');

    return `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #2563eb;">Daily AI Papers</h1>
            ${paperHtml}
            <p style="font-size: 12px; color: #999; margin-top: 30px;">
                You are receiving this because you subscribed to AI Insight.
                <br><a href="${escapeHtml(unsubUrl)}">Unsubscribe</a>
            </p>
        </div>
    `;
};

const getDailyEmailSubject = () => {
    return `Daily AI Papers - ${getTodayKey()}`;
};

// --- API Routes ---

// Admin auth routes
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { rawId, signed } = createSignedSessionId();
    const now = Date.now();
    const session: AdminSession = {
        id: rawId,
        createdAt: now,
        expiresAt: now + ADMIN_SESSION_TTL_MS,
    };
    adminSessions.set(rawId, session);

    const cookie = [
        `admin_session=${encodeURIComponent(signed)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
    ].join('; ');

    res.setHeader('Set-Cookie', cookie);
    return res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
    const cookies = parseCookies(req);
    const signed = cookies['admin_session'];
    if (signed) {
        const rawId = verifySignedSessionId(signed);
        if (rawId) {
            adminSessions.delete(rawId);
        }
    }

    const expiredCookie = [
        'admin_session=',
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0',
    ].join('; ');
    res.setHeader('Set-Cookie', expiredCookie);

    return res.json({ success: true });
});

app.get('/api/admin/me', (req, res) => {
    const cookies = parseCookies(req);
    const signed = cookies['admin_session'];
    if (!signed) {
        return res.json({ authenticated: false });
    }
    const rawId = verifySignedSessionId(signed);
    if (!rawId) {
        return res.json({ authenticated: false });
    }
    const session = adminSessions.get(rawId);
    if (!session || session.expiresAt < Date.now()) {
        if (session && session.expiresAt < Date.now()) {
            adminSessions.delete(rawId);
        }
        return res.json({ authenticated: false });
    }
    return res.json({ authenticated: true });
});

// Admin subscribers routes
app.get('/api/admin/subscribers', requireAdminAuth, async (req, res) => {
    try {
        const rows = await listSubscribers();
        return res.json({
            subscribers: rows.map((s) => ({
                id: s.id,
                email: s.email,
                subscribed_at: s.subscribedAt,
            })),
        });
    } catch (error) {
        console.error('Error fetching subscribers:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/subscribers', requireAdminAuth, async (req, res) => {
    const { email, sendWelcome = true } = req.body || {};
    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
        await addSubscriber(email);
        console.log(`[ADMIN] Added subscriber: ${email}`);

        if (sendWelcome) {
            try {
                await sendEmail(
                    email,
                    'Welcome to AI Insight',
                    '<h1>Welcome!</h1><p>You have been added by admin to daily AI paper updates.</p>'
                );
            } catch (error) {
                console.error('Error sending welcome email from admin route:', error);
            }
        }

        return res.json({ success: true });
    } catch (error: any) {
        if (error instanceof EmailAlreadySubscribedError) {
            return res.status(409).json({ error: 'Email already subscribed' });
        }
        console.error('Error adding subscriber (admin):', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.delete('/api/admin/subscribers/:id', requireAdminAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
        return res.status(400).json({ error: 'Invalid subscriber id' });
    }

    try {
        const deleted = await removeSubscriberById(id);
        if (!deleted) {
            return res.status(404).json({ error: 'Subscriber not found' });
        }
        console.log(`[ADMIN] Deleted subscriber id=${id}`);
        return res.json({ success: true });
    } catch (error) {
        console.error('Error deleting subscriber (admin):', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/admin/email-logs', requireAdminAuth, async (req, res) => {
    try {
        const raw = await fs.readFile(EMAIL_LOG_PATH, 'utf8').catch(() => '');
        const lines = raw.trim().split('\n').filter(Boolean);
        const logs = lines.slice(-20).map(line => JSON.parse(line)).reverse();
        return res.json({ logs });
    } catch (error) {
        console.error('Error reading email logs:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/send-test-email', requireAdminAuth, async (req, res) => {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    try {
        // Try disk cache first, fall back to HF fetch
        let papers: any[];
        const cached = await readPapersCache();
        if (cached && cached.papers.length > 0) {
            papers = cached.papers;
        } else {
            papers = await fetchAndCachePapers();
        }
        if (papers.length === 0) {
            return res.status(500).json({ error: 'No papers available today' });
        }
        const html = buildDailyEmailHtml(papers, email);
        const result = await sendEmail(email, getDailyEmailSubject(), html);
        if (!result.success) {
            return res.status(500).json({ error: 'Failed to send email', details: result.error });
        }
        return res.json({ success: true });
    } catch (error) {
        console.error('Error sending test email:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

app.get('/api/papers', async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 12;
    const refresh = req.query.refresh === 'true';

    try {
        if (refresh) {
            console.log('[/api/papers] refresh=true, fetching from HuggingFace...');
            const papers = await fetchAndCachePapers();
            return res.json(papers.slice(0, limit));
        }

        // Try disk cache first
        const cached = await readPapersCache();
        if (cached && cached.papers.length > 0) {
            console.log(`[/api/papers] Serving ${cached.papers.length} papers from disk cache (date: ${cached.dateKey})`);
            return res.json(cached.papers.slice(0, limit));
        }

        // No cache, fetch from HF
        console.log('[/api/papers] No disk cache, fetching from HuggingFace...');
        const papers = await fetchAndCachePapers();
        return res.json(papers.slice(0, limit));
    } catch (error) {
        console.error('Error in /api/papers:', error);
        // If fetch fails but we have stale cache, return it
        const cached = await readPapersCache();
        if (cached && cached.papers.length > 0) {
            console.log('[/api/papers] HF fetch failed, returning stale disk cache');
            return res.json(cached.papers.slice(0, limit));
        }
        return res.json([]);
    }
});

app.post('/api/analyze', async (req, res) => {
    const { papers } = req.body || {};
    if (!Array.isArray(papers) || papers.length === 0) {
        return res.status(400).json({ error: 'papers array required' });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey?.trim()) {
        return res.status(503).json({ error: '论文分析服务未配置（缺少 OPENAI_API_KEY）' });
    }

    try {
        const result = await analyzeWithOpenAI(papers, apiKey);
        return res.json(result);
    } catch (error: any) {
        console.error('[/api/analyze] Error:', error);
        return res.status(500).json({ error: error.message || '论文分析失败' });
    }
});

// Generic response used for all outcomes to prevent email enumeration
const SUBSCRIBE_PENDING_MSG = 'If this email is valid, a confirmation email has been sent. Please check your inbox.';

app.post('/api/subscribe', async (req, res) => {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Rate limit: same email only once per 5 minutes (also prevents using us as spam relay)
    const lastRequest = subscribeRateLimit.get(normalizedEmail);
    if (lastRequest && Date.now() - lastRequest < SUBSCRIBE_RATE_LIMIT_MS) {
        return res.json({ message: SUBSCRIBE_PENDING_MSG });
    }
    subscribeRateLimit.set(normalizedEmail, Date.now());

    // Check if already subscribed — return same generic response to avoid email enumeration
    const existingEmails = await listEmails();
    if (existingEmails.includes(normalizedEmail)) {
        return res.json({ message: SUBSCRIBE_PENDING_MSG });
    }

    const token = generateConfirmToken(normalizedEmail);
    const confirmUrl = `${BASE_URL}/api/confirm-subscription?token=${token}`;

    await sendEmail(
        normalizedEmail,
        'Confirm your AI Insight subscription',
        `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
            <h2>Confirm Subscription</h2>
            <p>Click the button below to confirm your subscription to daily AI paper updates:</p>
            <p><a href="${escapeHtml(confirmUrl)}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;">Confirm Subscription</a></p>
            <p style="color:#999;font-size:12px;">This link expires in 24 hours. If you didn't request this, you can safely ignore this email.</p>
        </div>`
    );

    console.log(`[subscribe] Confirmation email sent to ${normalizedEmail}`);
    res.json({ message: SUBSCRIBE_PENDING_MSG });
});

// GET: verify confirmation token and add subscriber
app.get('/api/confirm-subscription', async (req, res) => {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        return res.status(400).send('<p>Invalid confirmation link.</p>');
    }

    const email = verifyConfirmToken(token);
    if (!email) {
        return res.status(400).send(`
            <html><body style="font-family: sans-serif; max-width: 400px; margin: 60px auto; text-align: center;">
                <h2>Link Expired</h2>
                <p>This confirmation link is invalid or has expired. Please subscribe again.</p>
            </body></html>
        `);
    }

    try {
        await addSubscriber(email);
        console.log(`[confirm] New subscriber confirmed: ${email}`);
        await sendEmail(
            email,
            'Welcome to AI Insight',
            `<div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
                <h2>You're subscribed!</h2>
                <p>You will receive daily AI paper digests every morning.</p>
            </div>`
        );
        res.send(`
            <html><body style="font-family: sans-serif; max-width: 400px; margin: 60px auto; text-align: center;">
                <h2>Subscription Confirmed!</h2>
                <p>You will receive daily AI paper digests. Welcome aboard!</p>
            </body></html>
        `);
    } catch (error: any) {
        if (error instanceof EmailAlreadySubscribedError) {
            return res.send(`
                <html><body style="font-family: sans-serif; max-width: 400px; margin: 60px auto; text-align: center;">
                    <h2>Already Subscribed</h2>
                    <p>This email is already subscribed.</p>
                </body></html>
            `);
        }
        console.error('Error confirming subscription:', error);
        res.status(500).send('<p>Server error. Please try again.</p>');
    }
});

// GET: show confirmation page (prevents email security scanners from triggering unsubscribe)
app.get('/api/unsubscribe', async (req, res) => {
    const { email, token } = req.query;
    if (!email || !token || typeof email !== 'string' || typeof token !== 'string') {
        return res.status(400).send('<p>Invalid unsubscribe link.</p>');
    }

    const expected = generateUnsubscribeToken(email);
    const bufToken = Buffer.from(token);
    const bufExpected = Buffer.from(expected);
    if (bufToken.length !== bufExpected.length || !crypto.timingSafeEqual(bufToken, bufExpected)) {
        return res.status(403).send('<p>Invalid or expired unsubscribe link.</p>');
    }

    res.send(`
        <html><body style="font-family: sans-serif; max-width: 400px; margin: 60px auto; text-align: center;">
            <h2>Unsubscribe</h2>
            <p>Are you sure you want to unsubscribe <strong>${escapeHtml(email)}</strong>?</p>
            <form method="POST" action="/api/unsubscribe">
                <input type="hidden" name="email" value="${escapeHtml(email)}" />
                <input type="hidden" name="token" value="${escapeHtml(token)}" />
                <button type="submit" style="padding: 10px 24px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 15px;">
                    Confirm Unsubscribe
                </button>
            </form>
        </body></html>
    `);
});

// POST: verify token and perform unsubscribe
app.post('/api/unsubscribe', async (req, res) => {
    const { email, token } = req.body;
    if (!email || !token || typeof email !== 'string' || typeof token !== 'string') {
        return res.status(400).json({ error: 'Email and token required' });
    }

    const expected = generateUnsubscribeToken(email);
    const bufToken = Buffer.from(token);
    const bufExpected = Buffer.from(expected);
    if (bufToken.length !== bufExpected.length || !crypto.timingSafeEqual(bufToken, bufExpected)) {
        return res.status(403).json({ error: 'Invalid unsubscribe token' });
    }

    try {
        await removeSubscriberByEmail(email);
        if (req.headers.accept?.includes('text/html')) {
            return res.send('<html><body style="font-family: sans-serif; max-width: 400px; margin: 60px auto; text-align: center;"><h2>Unsubscribed</h2><p>You have been successfully unsubscribed.</p></body></html>');
        }
        res.json({ message: 'Unsubscribed successfully' });
    } catch (error) {
        console.error('Error unsubscribing user:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// --- Scheduled Tasks ---

// Cron schedule config (env var overrides, see .env.example for timing constraints)
const FETCH_CRON_SCHEDULE = process.env.FETCH_CRON_SCHEDULE || '0 6 * * *';
const EMAIL_CRON_SCHEDULE = process.env.EMAIL_CRON_SCHEDULE || '0 8 * * *';
const FETCH_RETRY_INTERVAL_MS = Number(process.env.FETCH_RETRY_INTERVAL_MINUTES || 10) * 60 * 1000;
const FETCH_RETRY_DEADLINE_HOUR = Number(process.env.FETCH_RETRY_DEADLINE_HOUR || 8);

// 6:00 AM: Fetch papers from HuggingFace and cache to disk
let fetchRetryInterval: ReturnType<typeof setInterval> | null = null;

cron.schedule(FETCH_CRON_SCHEDULE, async () => {
    console.log('[Cron fetch] Fetching papers from HuggingFace...');
    try {
        await fetchAndCachePapers();
        console.log('[Cron fetch] Papers fetched and cached successfully.');
    } catch (error) {
        console.error('[Cron fetch] Failed to fetch papers:', error);
        console.log(`[Cron fetch] Will retry every ${FETCH_RETRY_INTERVAL_MS / 60000} minutes until ${FETCH_RETRY_DEADLINE_HOUR}:00...`);

        // Retry every N minutes until deadline hour
        fetchRetryInterval = setInterval(async () => {
            const now = new Date();
            if (now.getHours() >= FETCH_RETRY_DEADLINE_HOUR) {
                console.log('[Cron fetch retry] Past deadline hour, stopping retries.');
                clearInterval(fetchRetryInterval!);
                fetchRetryInterval = null;
                return;
            }
            try {
                await fetchAndCachePapers();
                console.log('[Cron fetch retry] Papers fetched and cached successfully.');
                clearInterval(fetchRetryInterval!);
                fetchRetryInterval = null;
            } catch (retryError) {
                console.error('[Cron fetch retry] Still failing:', retryError);
            }
        }, FETCH_RETRY_INTERVAL_MS);
    }
});

// 8:00 AM: Send daily digest email using disk cache
// SMTP connection-level errors that indicate the server is unreachable
const SMTP_CONNECTION_ERRORS = ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'ESOCKET'];
const MAX_CONSECUTIVE_CONN_FAILURES = 3;
const EMAIL_CONCURRENCY = Number(process.env.EMAIL_CONCURRENCY || 5);

/**
 * Run `fn` over `items` with at most `concurrency` in-flight at once.
 * Workers respect `signal.aborted`: once set, no new items are picked up.
 * Slots that were never started are left as `undefined` in the result array.
 */
async function runWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
    signal: { aborted: boolean }
): Promise<Array<R | undefined>> {
    const results: Array<R | undefined> = new Array(items.length);
    let index = 0;

    async function worker() {
        while (index < items.length && !signal.aborted) {
            const i = index++;
            results[i] = await fn(items[i]);
        }
    }

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
}

cron.schedule(EMAIL_CRON_SCHEDULE, async () => {
    console.log('[Cron email] Running daily email task...');
    const todayKey = getTodayKey();

    const cached = await readPapersCache();
    if (!cached || cached.papers.length === 0) {
        console.error('[Cron email] 磁盘缓存为空，没有论文可发送，邮件未发送。');
        return;
    }

    if (cached.dateKey !== todayKey) {
        console.error(`[Cron email] 未获取到今天(${todayKey})的论文（缓存日期: ${cached.dateKey}），邮件未发送。`);
        return;
    }

    const emails = await listEmails();
    const startTime = Date.now();
    const signal = { aborted: false };
    let connFailCount = 0;

    const rawResults = await runWithConcurrency(emails, EMAIL_CONCURRENCY, async (email) => {
        const personalizedHtml = buildDailyEmailHtml(cached.papers, email);
        const unsubToken = generateUnsubscribeToken(email);
        const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubToken}`;
        const result = await sendEmail(email, getDailyEmailSubject(), personalizedHtml, {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        });

        if (!result.success && SMTP_CONNECTION_ERRORS.some(code => result.error?.includes(code))) {
            connFailCount++;
            if (connFailCount >= MAX_CONSECUTIVE_CONN_FAILURES) {
                console.error(`[Cron email] SMTP unreachable (${connFailCount} connection failures). Aborting batch.`);
                signal.aborted = true;
            }
        }

        return result;
    }, signal);

    // Fill slots that were never started (aborted before pick-up) with skipped entries
    const results: SendEmailResult[] = rawResults.map((r, i) =>
        r ?? { success: false, email: emails[i], error: 'Skipped: SMTP unreachable' }
    );

    const succeeded = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const durationMs = Date.now() - startTime;

    console.log(`[Cron email] Done: ${succeeded.length} sent, ${failed.length} failed, ${durationMs}ms.`);
    if (failed.length > 0) {
        console.error('[Cron email] Failed:', failed.map(r => `${r.email}: ${r.error}`).join('; '));
    }

    await appendEmailLog({
        timestamp: new Date().toISOString(),
        dateKey: todayKey,
        totalSubscribers: emails.length,
        succeeded: succeeded.length,
        failed: failed.length,
        durationMs,
        details: results.map(r => ({
            email: r.email,
            success: r.success,
            messageId: r.messageId,
            error: r.error,
        })),
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
