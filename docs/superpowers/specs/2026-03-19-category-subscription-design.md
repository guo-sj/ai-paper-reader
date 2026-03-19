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

Current: `email|timestamp|sig`
New: `base64(email|timestamp|categoriesJson)|sig`

- `categoriesJson` = JSON.stringify of the categories array (e.g. `["attention","llm"]` or `[]`)
- Signature still uses HMAC-SHA256 over the base64 payload

### `POST /api/subscribe`

- Accepts `{ email: string, categories?: string[] }`
- Validates category IDs against known categories (ignores unknown IDs)
- Encodes email + timestamp + categories into token
- Sends confirmation email (unchanged)

### `GET /api/confirm-subscription`

- Decodes token to extract email + categories
- Calls `addSubscriber(email, categories)` — categories written to store

### `addSubscriber` signature change

```ts
addSubscriber(email: string, categories?: string[]): Promise<void>
```

## Email Sending

`sendDailyEmails` filters papers per subscriber:

```
for each subscriber:
  if subscriber.categories is undefined or empty:
    papers = all analyzed papers
  else:
    papers = analyzed papers where paper.analysis.categories ∩ subscriber.categories ≠ ∅

  if papers is empty: skip (no email sent)
  else: send personalized email with filtered papers
```

Intersection check: `paper.analysis.categories` (array of category IDs assigned by AI) must share at least one element with `subscriber.categories`.

## Frontend

### Subscribe form (index.tsx)

1. Fetch category list from existing `GET /api/categories` on mount
2. Render checkbox list below the email input
3. Default: all unchecked (submits as empty array = all categories)
4. On submit: include selected category IDs in request body

```ts
POST /api/subscribe
{ email: "user@example.com", categories: ["attention", "llm"] }
```

## Files to Change

| File | Change |
|------|--------|
| `server/subscriberStoreFile.ts` | Add `categories` to `StoredSubscriber`, update `addSubscriber` signature |
| `server/server.ts` | Update token encode/decode, `/api/subscribe`, `/api/confirm-subscription`, `sendDailyEmails` |
| `index.tsx` | Add category checkboxes to subscribe form |

## Out of Scope

- Modifying subscribed categories after initial signup
- Admin UI for managing subscriber categories
