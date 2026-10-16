import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

let offline: typeof import('../src/services/offline');
let db: typeof import('../src/storage/db');
let repo: typeof import('../src/storage/repositories');

beforeAll(async () => {
  offline = await import('../src/services/offline');
  db = await import('../src/storage/db');
  repo = await import('../src/storage/repositories');
});

beforeEach(async () => {
  // بین آزمون‌ها کل پایه (شامل کش EPUB) خالی می‌شود
  await db.clearAll();
});

function sampleBuffer(n = 8): ArrayBuffer {
  const u = new Uint8Array(n);
  for (let i = 0; i < n; i++) u[i] = i + 1;
  return u.buffer;
}

describe('مطالعه آفلاین (استور epubCache — نسخه ۲ دیتابیس)', () => {
  it('ذخیره، خواندن و فهرست‌کردن جلد آفلاین', async () => {
    const buf = sampleBuffer(16);
    const rec = await offline.saveOffline('alice', 'vol-1', buf, {
      title: 'جلد اول',
      bookTitle: 'آلیس',
    });
    expect(rec.key).toBe('alice::vol-1');
    expect(rec.size).toBe(16);
    expect(rec.bookTitle).toBe('آلیس');

    expect(await offline.isOffline('alice', 'vol-1')).toBe(true);
    expect(await offline.isOffline('alice', 'vol-2')).toBe(false);

    const meta = await offline.getRecord('alice', 'vol-1');
    expect(meta?.title).toBe('جلد اول');
    expect(meta?.size).toBe(16);
    expect((meta as unknown as { blob?: Blob }).blob).toBeUndefined(); // متادیتا بدون Blob

    const list = await offline.listOffline();
    expect(list).toHaveLength(1);
    expect(list[0].volumeId).toBe('vol-1');
  });

  it('محتوای ذخیره‌شده سالم بازگردانده می‌شود', async () => {
    const buf = sampleBuffer(8);
    await offline.saveOffline('golestan', 'vol-2', buf, { title: 'گلستان', bookTitle: 'گلستان سعدی' });
    const back = await offline.getBuffer('golestan', 'vol-2');
    expect(back).not.toBeNull();
    expect(new Uint8Array(back as ArrayBuffer)).toEqual(new Uint8Array(buf));

    // جلدی که ذخیره نشده → null
    expect(await offline.getBuffer('golestan', 'vol-9')).toBeNull();
  });

  it('حذف تک‌جلد و پاک‌کردن همه', async () => {
    await offline.saveOffline('b1', 'v1', sampleBuffer(), { title: '۱', bookTitle: 'کتاب' });
    await offline.saveOffline('b1', 'v2', sampleBuffer(), { title: '۲', bookTitle: 'کتاب' });

    await offline.removeOffline('b1', 'v1');
    expect(await offline.isOffline('b1', 'v1')).toBe(false);
    expect(await offline.isOffline('b1', 'v2')).toBe(true);

    await offline.clearOffline();
    expect(await offline.listOffline()).toHaveLength(0);
  });

  it('واردکردن پشتیبان با «جایگزینی» کتاب‌های آفلاین را حذف نمی‌کند', async () => {
    await offline.saveOffline('alice', 'vol-1', sampleBuffer(), { title: 'جلد اول', bookTitle: 'آلیس' });
    await repo.saveProgress({
      bookId: 'alice',
      volumeId: 'vol-1',
      cfi: 'c1',
      href: 'h1',
      chapterTitle: 'فصل',
      percentage: 0.1,
      updatedAt: 1,
    });

    const backup = await repo.exportBackup();
    // شبیه‌سازی وضعیت دستگاه دیگر: جایگزینی کامل داده‌ها
    await db.clearDataStores();
    const result = await repo.importBackup(backup, 'replace');
    expect(result.counts.progress).toBe(1);

    // کتاب آفلاین باید باقی مانده باشد
    expect(await offline.isOffline('alice', 'vol-1')).toBe(true);
    expect((await offline.getBuffer('alice', 'vol-1'))?.byteLength).toBe(8);
  });

  it('clearAll همه چیز از جمله کش EPUB را پاک می‌کند', async () => {
    await offline.saveOffline('b', 'v', sampleBuffer(), { title: 't', bookTitle: 'bt' });
    await db.clearAll();
    expect(await offline.listOffline()).toHaveLength(0);
  });
});
