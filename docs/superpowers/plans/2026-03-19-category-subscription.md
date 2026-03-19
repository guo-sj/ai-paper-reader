# Category-Based Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow subscribers to choose which paper categories they receive, so they only get emails about topics they care about.

**Architecture:** Add `categories?: string[]` to the subscriber store; encode categories into the confirmation token; filter papers per subscriber in `sendDailyEmails`; add category checkboxes to the subscribe form.

**Tech Stack:** TypeScript, Express, React, node-cron, nodemailer. No test framework — verification is manual via `tsx` and curl.

**Spec:** `docs/superpowers/specs/2026-03-19-category-subscription-design.md`

---

## File Map

| File | What changes |
|------|-------------|
| `server/subscriberStoreFile.ts` | Add `categories` to `StoredSubscriber`; update `readStoreUnlocked` sanitization; update `addSubscriber` signature |
| `server/server.ts` | Update `generateConfirmToken` / `verifyConfirmToken`; update `POST /api/subscribe`; update `GET /api/confirm-subscription`; update `sendDailyEmails` |
| `components/SubscriptionForm.tsx` | Fetch categories on mount; render checkboxes; include selected IDs in submit body |

---

## Task 1: Update `StoredSubscriber` and `addSubscriber`

**Files:**
- Modify: `server/subscriberStoreFile.ts`

- [ ] **Step 1: Add `categories` to `StoredSubscriber` interface**

In `server/subscriberStoreFile.ts`, change the interface (line 5):

```ts
export interface StoredSubscriber {
  id: number;
  email: string;
  subscribedAt: string;
  categories?: string[]; // undefined or [] = all categories
}
```

- [ ] **Step 2: Fix `readStoreUnlocked` sanitization to preserve `categories`**

In `readStoreUnlocked`, the `.map()` at lines 70–74 currently produces only `{ id, email, subscribedAt }`. Replace it:

```ts
const cleanSubscribers = subscribers
  .filter((s) => s && typeof s.email === 'string')
  .map((s) => ({
    id: Number(s.id) || 0,
    email: String(s.email),
    subscribedAt: typeof s.subscribedAt === 'string' && s.subscribedAt ? s.subscribedAt : nowIso(),
    categories: Array.isArray(s.categories) ? (s.categories as string[]) : undefined,
  }))
  .filter((s) => s.id > 0 && s.email.includes('@'));
```

- [ ] **Step 3: Update `addSubscriber` to accept and store `categories`**

Change the function signature and the push line:

```ts
export async function addSubscriber(email: string, categories?: string[]): Promise<void> {
  return enqueue(async () => {
    const filePath = resolveStorePath();
    const store = await readStoreUnlocked(filePath);
    const norm = normalizeEmail(email);

    const exists = store.subscribers.some((s) => normalizeEmail(s.email) === norm);
    if (exists) throw new EmailAlreadySubscribedError();

    const id = store.nextId;
    store.nextId += 1;
    store.subscribers.push({ id, email: norm, subscribedAt: nowIso(), categories });

    await atomicWriteJson(filePath, store);
  });
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/guosj/Documents/github_repos/ai-paper-reader
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/subscriberStoreFile.ts
git commit -m "feat: add categories field to StoredSubscriber and addSubscriber"
```

---

## Task 2: Update confirmation token to carry categories

**Files:**
- Modify: `server/server.ts` (lines 173–198)

- [ ] **Step 1: Update `generateConfirmToken` to include categories**

Replace the function at line 173:

```ts
function generateConfirmToken(email: string, categories: string[] = []): string {
    const ts = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({ email, ts, categories });
    const sig = crypto.createHmac('sha256', CONFIRM_SECRET).update(payload).digest('hex');
    return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}
```

- [ ] **Step 2: Update `verifyConfirmToken` to return categories**

Replace the function at line 180. Change return type from `string | null` to `{ email: string; categories: string[] } | null`:

```ts
function verifyConfirmToken(token: string): { email: string; categories: string[] } | null {
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

        const { email, ts, categories } = JSON.parse(payload);
        if (Date.now() / 1000 - ts > CONFIRM_TOKEN_MAX_AGE_S) return null;
        return { email: email as string, categories: Array.isArray(categories) ? categories : [] };
    } catch {
        return null;
    }
}
```

- [ ] **Step 3: Fix the call site in `GET /api/confirm-subscription`**

`verifyConfirmToken` now returns `{ email, categories } | null` instead of `string | null`. Update the handler (around line 835):

```ts
app.get('/api/confirm-subscription', async (req, res) => {
    const { token } = req.query;
    if (!token || typeof token !== 'string') {
        return res.status(400).send('<p>Invalid confirmation link.</p>');
    }

    const verified = verifyConfirmToken(token);
    if (!verified) {
        return res.status(400).send(`
            <html><body style="font-family: sans-serif; max-width: 400px; margin: 60px auto; text-align: center;">
                <h2>Link Expired</h2>
                <p>This confirmation link is invalid or has expired. Please subscribe again.</p>
            </body></html>
        `);
    }

    const { email, categories } = verified;

    try {
        await addSubscriber(email, categories);
        // ... rest of handler unchanged
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/server.ts
git commit -m "feat: encode categories in confirmation token"
```

---

## Task 3: Update `POST /api/subscribe` to accept categories

**Files:**
- Modify: `server/server.ts` (around line 796)

- [ ] **Step 1: Load known category IDs for validation**

At the top of the `POST /api/subscribe` handler, load valid category IDs from the config. The `readCategoriesConfig()` helper already exists in the file (line 328). Add category validation:

```ts
app.post('/api/subscribe', async (req, res) => {
    const { email, categories } = req.body;
    if (!email || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Validate and filter categories
    let validatedCategories: string[] = [];
    if (Array.isArray(categories) && categories.length > 0) {
        try {
            const config = await readCategoriesConfig();
            const knownIds = new Set(config.categories.map((c) => c.id));
            validatedCategories = (categories as unknown[])
                .filter((c): c is string => typeof c === 'string' && knownIds.has(c));
        } catch {
            // If categories.json fails to load, treat as all categories
            validatedCategories = [];
        }
    }

    // ... rest of handler: rate limit, existing email check, token generation
```

- [ ] **Step 2: Pass `validatedCategories` to `generateConfirmToken`**

Find the line that calls `generateConfirmToken(normalizedEmail)` and update it:

```ts
const token = generateConfirmToken(normalizedEmail, validatedCategories);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual smoke test — subscribe with categories**

Start the server: `npm run server`

```bash
curl -s -X POST http://localhost:3001/api/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","categories":["attention","llm"]}' | jq .
```

Expected: `{"message": "..."}` (the pending message). No error.

- [ ] **Step 5: Commit**

```bash
git add server/server.ts
git commit -m "feat: accept and validate categories in POST /api/subscribe"
```

---

## Task 4: Update `sendDailyEmails` to filter per subscriber

**Files:**
- Modify: `server/server.ts` (function `sendDailyEmails`, around line 976)

- [ ] **Step 1: Replace `listEmails()` with `listSubscribers()`**

In `sendDailyEmails`, replace:

```ts
const emails = await listEmails();
```

with:

```ts
const subscribers = await listSubscribers();
```

- [ ] **Step 2: Update `runWithConcurrency` call to iterate over subscribers**

Replace the `runWithConcurrency` block. Note: use `papersWithAnalysis` (already computed at line 991) instead of `analyzed.papers` so category-filtered subscribers only see papers that have AI analysis:

```ts
const rawResults = await runWithConcurrency(subscribers, EMAIL_CONCURRENCY, async (subscriber) => {
    const papersForSubscriber = (!subscriber.categories || subscriber.categories.length === 0)
        ? papersWithAnalysis
        : papersWithAnalysis.filter((p) =>
            p.analysis?.categories?.some((cat) => subscriber.categories!.includes(cat))
          );

    if (papersForSubscriber.length === 0) {
        // No matching papers — skip this subscriber silently
        return { success: true, email: subscriber.email };
    }

    const personalizedHtml = buildDailyEmailHtml(papersForSubscriber, subscriber.email);
    const unsubToken = generateUnsubscribeToken(subscriber.email);
    const unsubUrl = `${BASE_URL}/api/unsubscribe?email=${encodeURIComponent(subscriber.email)}&token=${unsubToken}`;
    const result = await sendEmail(subscriber.email, getDailyEmailSubject(), personalizedHtml, {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });

    if (!result.success && SMTP_CONNECTION_ERRORS.some(code => result.error?.includes(code))) {
        connFailCount++;
        if (connFailCount >= MAX_CONSECUTIVE_CONN_FAILURES) {
            console.error(`[sendDailyEmails] SMTP unreachable (${connFailCount} connection failures). Aborting batch.`);
            signal.aborted = true;
        }
    }

    return result;
}, signal);
```

- [ ] **Step 3: Fix the back-fill line and log field**

Replace:

```ts
const results: SendEmailResult[] = rawResults.map((r, i) =>
    r ?? { success: false, email: emails[i], error: 'Skipped: SMTP unreachable' }
);
```

with:

```ts
const results: SendEmailResult[] = rawResults.map((r, i) =>
    r ?? { success: false, email: subscribers[i].email, error: 'Skipped: SMTP unreachable' }
);
```

And replace `emails.length` with `subscribers.length` in the `appendEmailLog` call:

```ts
totalSubscribers: subscribers.length,
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/server.ts
git commit -m "feat: filter papers per subscriber categories in sendDailyEmails"
```

---

## Task 5: Add category checkboxes to `SubscriptionForm`

**Files:**
- Modify: `components/SubscriptionForm.tsx`

- [ ] **Step 1: Add state for categories and fetch on mount**

Replace the component with the updated version:

```tsx
import React, { useState, useEffect } from 'react';

interface CategoryInfo {
    id: string;
    label: string;
}

const SubscriptionForm: React.FC = () => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');
    const [categories, setCategories] = useState<CategoryInfo[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<string[]>([]);

    useEffect(() => {
        fetch('/api/categories')
            .then((r) => r.json())
            .then((data) => {
                if (Array.isArray(data.categories)) setCategories(data.categories);
            })
            .catch(() => {
                // fetch failed — hide checkboxes, submit with no categories (all papers)
            });
    }, []);

    const toggleCategory = (id: string) => {
        setSelectedCategories((prev) =>
            prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
        );
    };

    const handleSubscribe = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setStatus('loading');
        try {
            const res = await fetch('/api/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, categories: selectedCategories }),
            });
            const data = await res.json();

            if (res.ok) {
                setStatus('success');
                setMessage(data.message || 'Check your inbox for a confirmation email.');
                setEmail('');
                setSelectedCategories([]);
            } else {
                setStatus('error');
                setMessage(data.error || 'Subscription failed.');
            }
        } catch {
            setStatus('error');
            setMessage('Network error. Please try again.');
        }
    };

    return (
        <div className="mt-4 sm:mt-0">
            <form onSubmit={handleSubscribe} className="flex flex-col sm:flex-row gap-2">
                <input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[200px]"
                    disabled={status === 'loading' || status === 'success'}
                />
                <button
                    type="submit"
                    disabled={status === 'loading' || status === 'success'}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                        status === 'success'
                            ? 'bg-green-600 hover:bg-green-700'
                            : 'bg-blue-600 hover:bg-blue-700'
                    } disabled:opacity-50`}
                >
                    {status === 'loading' ? '...' : status === 'success' ? 'Subscribed!' : 'Subscribe'}
                </button>
                {status === 'error' && (
                    <p className="text-red-500 text-xs mt-1 sm:mt-0 sm:ml-2 self-center">{message}</p>
                )}
            </form>
            {categories.length > 0 && status !== 'success' && (
                <div className="mt-3">
                    <p className="text-xs text-slate-500 mb-2">
                        Subscribe to specific categories (leave all unchecked to receive everything):
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {categories.map((cat) => (
                            <label key={cat.id} className="flex items-center gap-1 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={selectedCategories.includes(cat.id)}
                                    onChange={() => toggleCategory(cat.id)}
                                    className="rounded"
                                    disabled={status === 'loading'}
                                />
                                <span className="text-xs text-slate-700">{cat.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default SubscriptionForm;
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual smoke test — open the UI**

Run `npm run dev` and open the subscribe form. Verify:
- Category checkboxes appear below the email input
- Checking/unchecking works
- Submitting with no checkboxes sends `categories: []`
- Submitting with some checked sends the selected IDs

- [ ] **Step 4: Commit**

```bash
git add components/SubscriptionForm.tsx
git commit -m "feat: add category checkboxes to subscription form"
```

---

## Task 6: End-to-end verification

- [ ] **Step 1: Full subscribe flow with categories**

With server running:

```bash
# Subscribe with categories
curl -s -X POST http://localhost:3001/api/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"verify@example.com","categories":["attention","llm"]}' | jq .
```

Check the confirmation email arrives. Click the link. Verify `server/subscribers.json` contains the new subscriber with `"categories": ["attention", "llm"]`.

- [ ] **Step 2: Verify backward compatibility**

Check that existing subscribers in `server/subscribers.json` (without `categories` field) still load correctly — `listSubscribers()` should return them with `categories: undefined`.

- [ ] **Step 3: Verify paper filtering logic manually**

Add a test subscriber with `categories: ["attention"]` directly to `subscribers.json`. Trigger `sendDailyEmails` via the admin endpoint or cron. Confirm that subscriber only receives papers whose `analysis.categories` includes `"attention"`.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix: <describe any fixes>"
```
