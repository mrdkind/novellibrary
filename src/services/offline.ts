/**
 * مطالعه آفلاین اختیاری (۱٫۶٫۰ — طبق نقشه راه گزارش ممیزی v1.5.1)
 *
 * فایل EPUB کتاب‌های دلخواه کاربر در IndexedDB (استور epubCache) کش می‌شود
 * تا بازخوانی بدون شبکه ممکن باشد. عمداً از Service Worker استفاده نشده —
 * دقیقاً به همان دلیلی که PWA در ممیزی کنار گذاشته شد: کتاب‌خوان با
 * «بافر بازشده» کار می‌کند و کش EPUB در همان لایه داده محلی، ساده‌تر و
 * قابل کنترل‌تر است.
 *
 * انتخاب Blob به‌جای ArrayBuffer: مرورگر Blob را به‌صورت فایل‌بندی‌شده
 * نگه می‌دارد (بار حافظه هنگام فهرست‌کردن ناچیز است) و فقط هنگام بازکردن
 * کتاب به ArrayBuffer تبدیل می‌شود.
 */

import { STORES, get, put, remove, getAll } from '@/storage/db';

/** رکورد متادیتای یک جلد آفلاین‌شده */
export interface OfflineRecord {
  key: string;
  bookId: string;
  volumeId: string;
  /** عنوان جلد (نمایش در تنظیمات) */
  title: string;
  /** عنوان کتاب (نمایش در تنظیمات) */
  bookTitle: string;
  /** حجم فایل به بایت */
  size: number;
  savedAt: number;
}

interface OfflineCacheRow extends OfflineRecord {
  /** محتوای فایل — Blob برای نگه‌داری فایل‌بندی‌شده در مرورگر */
  blob: Blob;
}

export function volumeKey(bookId: string, volumeId: string): string {
  return `${bookId}::${volumeId}`;
}

/* ---------- رویداد همگام‌سازی بین‌صفحه‌ای ----------
 * صفحه جزئیات و تنظیمات باید وضعیت آفلاین را همزمان ببینند؛
 * یک رویداد سبک ماژولی کافی است (بدون کانتکست سنگین). */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

/* ---------- پشتیبانی مرورگر ---------- */

export function isSupported(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

/** درخواست ذخیره‌سازی پایدار؛ در موفقیت، مرورگر خودبه‌خود کش را پاک نمی‌کند */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export interface StorageEstimateInfo {
  usage: number | null;
  quota: number | null;
}

export async function storageEstimate(): Promise<StorageEstimateInfo> {
  try {
    const est = await navigator.storage?.estimate?.();
    return { usage: est?.usage ?? null, quota: est?.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

/* ---------- عملیات اصلی ---------- */

export async function isOffline(bookId: string, volumeId: string): Promise<boolean> {
  if (!isSupported()) return false;
  try {
    return (await get<{ key: string }>(STORES.epubCache, volumeKey(bookId, volumeId))) !== undefined;
  } catch {
    return false;
  }
}

export async function getRecord(bookId: string, volumeId: string): Promise<OfflineRecord | null> {
  if (!isSupported()) return null;
  try {
    const row = await get<OfflineCacheRow>(STORES.epubCache, volumeKey(bookId, volumeId));
    if (!row) return null;
    const { blob: _blob, ...meta } = row;
    return meta;
  } catch {
    return null;
  }
}

/** ذخیره فایل EPUB برای مطالعه بدون اینترنت */
export async function saveOffline(
  bookId: string,
  volumeId: string,
  buffer: ArrayBuffer,
  meta: { title: string; bookTitle: string },
): Promise<OfflineRecord> {
  const blob = new Blob([buffer], { type: 'application/epub+zip' });
  const rec: OfflineCacheRow = {
    key: volumeKey(bookId, volumeId),
    bookId,
    volumeId,
    title: meta.title,
    bookTitle: meta.bookTitle,
    size: blob.size,
    savedAt: Date.now(),
    blob,
  };
  await put(STORES.epubCache, rec);
  emit();
  const { blob: _b, ...out } = rec;
  return out;
}

/** خواندن محتوای فایل آفلاین — null یعنی در کش نیست */
export async function getBuffer(bookId: string, volumeId: string): Promise<ArrayBuffer | null> {
  if (!isSupported()) return null;
  try {
    const row = await get<OfflineCacheRow>(STORES.epubCache, volumeKey(bookId, volumeId));
    if (!row) return null;
    return await row.blob.arrayBuffer();
  } catch {
    return null;
  }
}

export async function removeOffline(bookId: string, volumeId: string): Promise<void> {
  await remove(STORES.epubCache, volumeKey(bookId, volumeId));
  emit();
}

/** فهرست کتاب‌های آفلاین (فقط متادیتا؛ Blob خوانده نمی‌شود) */
export async function listOffline(): Promise<OfflineRecord[]> {
  if (!isSupported()) return [];
  try {
    const rows = await getAll<OfflineCacheRow>(STORES.epubCache);
    return rows
      .map(({ blob: _blob, ...meta }) => meta)
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** حذف همه کتاب‌های آفلاین (بخش «مطالعه آفلاین» تنظیمات) */
export async function clearOffline(): Promise<void> {
  const all = await listOffline();
  for (const rec of all) {
    await remove(STORES.epubCache, rec.key);
  }
  emit();
}
