# Category-Based Subscription Design

**Issue:** #14
**Date:** 2026-03-19
**Status:** Approved

## Problem

Currently all subscribers receive all papers. Some subscribers only care about specific categories (e.g., only "attention" related papers). This feature allows subscribers to choose which categories they want to receive.

## Approach

Token-based: encode `categories` into the confirmation token so no intermediate state is needed. On confirmation, categories are persisted alongside the subscriber record.

## Data Layer

### `StoredSubscriber` (server/subscriberStoreFile.ts)

Add optional field:

```ts
export interface StoredSubscriber {
  id: number;
  email: string;
  subscribedAt: string;
  categories?: string[]; // undefined or [] = all categories
}
```

- Backward compatible: existing records without `categories` are treated as "all categories"
- Category IDs match those defined in `server/categories.json`

## Subscription Flow

### Token format change

Current: `base64url(JSON({ payload: JSON({email, ts}), sig }))`
New: `base64url(JSON({ payload: JSON({email, ts, categories}), sig }))`

- `categories` = string array (e.g. `["attention","llm"]` or `[]`)
- Signature is HMAC-SHA256 over the `payload` string (same as current)
- `generateConfirmToken` and `verifyConfirmToken` in `server/server.ts` both need updating

### `POST /api/subscribe`

- Accepts `{ email: string, categories?: string[] }`
- Validates category IDs against known categories; unknown IDs are silently filtered out
- If all submitted IDs are unknown, the result is `[]` which is stored and treated as "all categories" — the user ends up receiving all papers (acceptable tradeoff; no error returned)
- Encodes email + timestamp + categories into token
- Sends confirmation email (unchanged)
- Note: if email is already subscribed and user re-subscribes after the rate-limit window, a new token is generated and sent, but `addSubscriber` will throw `EmailAlreadySubscribedError` on confirmation — the new categories in the token are silently discarded. This is intentional; updating categories via re-subscribe is out of scope.

### `GET /api/confirm-subscription`

- Decodes token to extract email + categories
- Calls `addSubscriber(email, categories)` — categories written to store

### `addSubscriber` signature change

```ts
addSubscriber(email: string, categories?: string[]): Promise<void>
```

- Store `categories` as-is (empty array `[]` is stored as `[]`, not normalized to `undefined`)
- Both `undefined` and `[]` are treated as "all categories" at read time
- `readStoreUnlocked` sanitization must be updated to preserve the `categories` field: accept `undefined` (pass through) or a valid `string[]`; treat any non-array value as `undefined` (all categories)
- `POST /api/admin/subscribers` calls `addSubscriber(email)` without categories — admin-added subscribers will always have `categories: undefined` (all categories), which is correct

## Email Sending

`sendDailyEmails` must switch from `listEmails()` to `listSubscribers()` to access per-subscriber categories, then filter papers per subscriber:

```
for each subscriber:
  if subscriber.categories is undefined or empty:
    papers = all analyzed papers
  else:
    papers = analyzed papers where paper.analysis.categories ∩ subscriber.categories ≠ ∅

  if papers is empty: skip (no email sent)
  else: send personalized email with filtered papers
```

Intersection check: `paper.analysis.categories` (array of category IDs assigned by AI, field confirmed in `PaperAnalysis` type in `types.ts`) must share at least one element with `subscriber.categories`.

After the refactor, the SMTP-abort fallback that back-fills skipped results must use `subscribers[i].email` (not `emails[i]`). The `totalSubscribers` log field should use `subscribers.length`.

## Frontend

### Subscribe form (index.tsx)

1. Fetch category list from existing `GET /api/categories` on mount
2. If fetch fails, hide the checkbox section and submit with no categories (all papers)
3. Render checkbox list below the email input
4. Default: all unchecked (submits as empty array = all categories)
5. On submit: include selected category IDs in request body

```ts
POST /api/subscribe
{ email: "user@example.com", categories: ["attention", "llm"] }
```

## Files to Change

| File | Change |
|------|--------|
| `server/subscriberStoreFile.ts` | Add `categories` to `StoredSubscriber`; update `addSubscriber` signature; fix `readStoreUnlocked` sanitization to preserve `categories` field |
| `server/server.ts` | Update `generateConfirmToken`/`verifyConfirmToken` to include categories in payload; update `/api/subscribe` to accept and validate categories; update `sendDailyEmails` to use `listSubscribers()` and filter per subscriber |
| `index.tsx` | Add category checkboxes to subscribe form |

## Out of Scope

- Modifying subscribed categories after initial signup
- Admin UI for managing subscriber categories (note: `GET /api/admin/subscribers` currently omits `categories` from response — low-priority follow-up)
- Re-subscribe with different categories: if email is already subscribed, the existing flow returns a generic message and does nothing (intentional)
