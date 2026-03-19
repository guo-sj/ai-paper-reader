import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export interface StoredSubscriber {
  id: number;
  email: string;
  subscribedAt: string; // ISO string
  categories?: string[]; // undefined or [] = all categories
}

interface StoreFileShape {
  version: 1;
  nextId: number;
  subscribers: StoredSubscriber[];
}

export class EmailAlreadySubscribedError extends Error {
  code = 'EMAIL_ALREADY_SUBSCRIBED' as const;
  constructor(message = 'Email already subscribed') {
    super(message);
    this.name = 'EmailAlreadySubscribedError';
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultFilePath = path.resolve(__dirname, 'subscribers.json');

function resolveStorePath(): string {
  const p = process.env.SUBSCRIBERS_FILE;
  return p && p.trim() ? path.resolve(p) : defaultFilePath;
}

// Helpful startup log (non-sensitive): where subscriber file lives
// eslint-disable-next-line no-console
console.log(`[SubscriberStore] Using file: ${resolveStorePath()}`);

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readStoreUnlocked(filePath: string): Promise<StoreFileShape> {
  if (!(await fileExists(filePath))) {
    return { version: 1, nextId: 1, subscribers: [] };
  }

  const raw = await fs.readFile(filePath, 'utf8');
  if (!raw.trim()) return { version: 1, nextId: 1, subscribers: [] };

  const parsed = JSON.parse(raw) as Partial<StoreFileShape>;
  const subscribers = Array.isArray(parsed.subscribers) ? (parsed.subscribers as StoredSubscriber[]) : [];
  const nextId = typeof parsed.nextId === 'number' && Number.isFinite(parsed.nextId) ? parsed.nextId : 1;

  // Basic sanitization
  const cleanSubscribers = subscribers
    .filter((s) => s && typeof s.email === 'string')
    .map((s) => ({
      id: Number(s.id) || 0,
      email: String(s.email),
      subscribedAt: typeof s.subscribedAt === 'string' && s.subscribedAt ? s.subscribedAt : nowIso(),
      categories: Array.isArray(s.categories) ? (s.categories as string[]) : undefined,
    }))
    .filter((s) => s.id > 0 && s.email.includes('@'));

  const maxId = cleanSubscribers.reduce((m, s) => Math.max(m, s.id), 0);
  return {
    version: 1,
    nextId: Math.max(nextId, maxId + 1),
    subscribers: cleanSubscribers,
  };
}

async function atomicWriteJson(filePath: string, data: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp`;
  const json = JSON.stringify(data, null, 2);
  await fs.writeFile(tmpPath, json, 'utf8');

  // Windows-safe replace: remove dest if exists, then rename tmp -> dest
  try {
    await fs.rm(filePath, { force: true });
  } catch {
    // ignore
  }
  await fs.rename(tmpPath, filePath);
}

// Serialize all operations to avoid concurrent writes.
let opQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = opQueue.then(fn, fn);
  opQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function listSubscribers(): Promise<StoredSubscriber[]> {
  return enqueue(async () => {
    const filePath = resolveStorePath();
    const store = await readStoreUnlocked(filePath);
    return [...store.subscribers].sort((a, b) => b.subscribedAt.localeCompare(a.subscribedAt));
  });
}

export async function listEmails(): Promise<string[]> {
  const subs = await listSubscribers();
  return subs.map((s) => s.email);
}

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

export async function removeSubscriberByEmail(email: string): Promise<void> {
  return enqueue(async () => {
    const filePath = resolveStorePath();
    const store = await readStoreUnlocked(filePath);
    const norm = normalizeEmail(email);

    store.subscribers = store.subscribers.filter((s) => normalizeEmail(s.email) !== norm);
    await atomicWriteJson(filePath, store);
  });
}

export async function removeSubscriberById(id: number): Promise<boolean> {
  return enqueue(async () => {
    const filePath = resolveStorePath();
    const store = await readStoreUnlocked(filePath);
    const before = store.subscribers.length;
    store.subscribers = store.subscribers.filter((s) => s.id !== id);
    const changed = store.subscribers.length !== before;
    if (changed) {
      await atomicWriteJson(filePath, store);
    }
    return changed;
  });
}

