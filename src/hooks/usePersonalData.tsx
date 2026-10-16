import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Bookmark, CustomFont, HistoryEntry, ReadingProgress } from '@/types';
import { DEFAULT_READER_SETTINGS, normalizeReaderSettings } from '@/types';
import type { ReaderSettings } from '@/types';
import * as repo from '@/storage/repositories';
import { registerCustomFontsInDocument } from '@/reader/readerSettings';

/**
 * کانتکست داده‌های شخصی کاربر (ذخیره‌شده در مرورگر خود کاربر).
 * هیچ داده‌ای به سرور ارسال نمی‌شود.
 */
interface PersonalDataCtx {
  ready: boolean;
  progress: Map<string, ReadingProgress>;
  bookmarks: Bookmark[];
  favorites: Set<string>;
  history: HistoryEntry[];
  readerSettings: ReaderSettings;
  setReaderSettings: (s: ReaderSettings) => void;
  /** فونت‌های آپلودشده کاربر */
  customFonts: CustomFont[];
  addCustomFont: (f: Omit<CustomFont, 'id' | 'createdAt'>) => Promise<CustomFont>;
  deleteCustomFont: (id: string) => Promise<void>;
  saveProgress: (p: ReadingProgress) => Promise<void>;
  toggleFavorite: (bookId: string) => Promise<void>;
  addBookmark: (b: Omit<Bookmark, 'id' | 'createdAt'>) => Promise<Bookmark>;
  deleteBookmark: (id: string) => Promise<void>;
  touchHistory: (bookId: string, volumeId: string) => Promise<void>;
  removeHistory: (bookId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<PersonalDataCtx | null>(null);

/** نام کانال همگام‌سازی بین-تبی داده‌های شخصی */
const SYNC_CHANNEL = 'ns-personal-sync';
/** کلید مهاجرت یک‌باره جهت پیش‌فرض (UX-001) */
const DIR_MIGRATION_KEY = 'direction-auto-migrated';

export function PersonalDataProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [progressMap, setProgressMap] = useState<Map<string, ReadingProgress>>(new Map());
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [readerSettings, setReaderSettingsState] = useState<ReaderSettings>(DEFAULT_READER_SETTINGS);
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);

  const refresh = useCallback(async () => {
    try {
      const [progress, bms, favs, hist, settings, fonts] = await Promise.all([
        repo.getAllProgress(),
        repo.getAllBookmarks(),
        repo.getAllFavorites(),
        repo.getHistory(),
        repo.getSetting<ReaderSettings>('reader', DEFAULT_READER_SETTINGS),
        repo.getSetting<CustomFont[]>('customFonts', []),
      ]);
      setProgressMap(new Map(progress.map((p) => [`${p.bookId}::${p.volumeId}`, p])));
      setBookmarks(bms.sort((a, b) => b.createdAt - a.createdAt));
      setFavorites(new Set(favs.map((f) => f.bookId)));
      setHistory(hist);

      /* UX-001 — مهاجرت یک‌باره: نسخه‌های قبلی پیش‌فرض RTL داشتند که با کتاب‌های
       * انگلیسی ناسازگار بود؛ پیشرفت قدیمیِ ذخیره‌شده فقط یک بار به «خودکار» تبدیل می‌شود.
       * پس از مهاجرت، انتخاب دستی کاربر همیشه محترم شمرده می‌شود. */
      let effSettings = normalizeReaderSettings(settings);
      try {
        const migrated = await repo.getSetting<boolean>(DIR_MIGRATION_KEY, false);
        if (!migrated) {
          await repo.setSetting(DIR_MIGRATION_KEY, true);
          if (effSettings.direction === 'rtl') {
            effSettings = { ...effSettings, direction: 'auto' };
            await repo.setSetting('reader', effSettings);
          }
        }
      } catch {
        /* مهاجرت حیاتی نیست */
      }
      setReaderSettingsState(effSettings);

      const fontList = Array.isArray(fonts) ? fonts : [];
      setCustomFonts(fontList);
      registerCustomFontsInDocument(fontList);
    } catch (e) {
      console.warn('خواندن داده‌های محلی ناموفق بود:', e);
    } finally {
      setReady(true);
    }
  }, []);

  /* ---------- LOGIC-001 — همگام‌سازی بین تب‌ها ----------
   * هر نوشتن، یک پیام کوتاه در BroadcastChannel پخش می‌کند و بقیه تب‌ها داده را
   * دوباره می‌خوانند؛ دیگر «آخرین نوشنده» رابط تب دیگر را کهنه نمی‌گذارد.
   * refresh خودش پیامی پخش نمی‌کند، پس حلقه بی‌نهایت شکل نمی‌گیرد. */
  const syncRef = useRef<BroadcastChannel | null>(null);
  useEffect(() => {
    try {
      if (typeof BroadcastChannel === 'undefined') return;
      const ch = new BroadcastChannel(SYNC_CHANNEL);
      ch.onmessage = () => {
        void refresh();
      };
      syncRef.current = ch;
      return () => {
        ch.close();
        syncRef.current = null;
      };
    } catch {
      /* پشتیبانی نمی‌شود — تک‌کاری */
    }
  }, [refresh]);

  const notifySync = useCallback(() => {
    try {
      syncRef.current?.postMessage('changed');
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addCustomFont = useCallback(async (f: Omit<CustomFont, 'id' | 'createdAt'>) => {
    const font: CustomFont = {
      ...f,
      id: `cf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    const next = [...customFonts, font].slice(-10); // سقف ۱۰ فونت
    setCustomFonts(next);
    await repo.setSetting('customFonts', next);
    registerCustomFontsInDocument([font]);
    notifySync();
    return font;
  }, [customFonts, notifySync]);

  const deleteCustomFont = useCallback(async (id: string) => {
    const next = customFonts.filter((f) => f.id !== id);
    setCustomFonts(next);
    await repo.setSetting('customFonts', next);
    // اگر فونت حذف‌شده انتخاب فعال بود، به وزیرمتن برگرد
    setReaderSettingsState((s) => {
      if (s.customFontId === id || s.fontFamily === 'custom') {
        const ns = { ...s, fontFamily: 'vazirmatn' as const, customFontId: null };
        void repo.setSetting('reader', ns);
        return ns;
      }
      return s;
    });
    notifySync();
  }, [customFonts, notifySync]);

  const saveProgress = useCallback(async (p: ReadingProgress) => {
    await repo.saveProgress(p);
    setProgressMap((m) => {
      const next = new Map(m);
      next.set(`${p.bookId}::${p.volumeId}`, p);
      return next;
    });
    notifySync();
  }, [notifySync]);

  const toggleFavorite = useCallback(async (bookId: string) => {
    await repo.toggleFavorite(bookId);
    setFavorites((s) => {
      const next = new Set(s);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
    notifySync();
  }, [notifySync]);

  const addBookmark = useCallback(async (b: Omit<Bookmark, 'id' | 'createdAt'>) => {
    const bm = repo.newBookmark(b);
    await repo.addBookmark(bm);
    setBookmarks((list) => [bm, ...list]);
    notifySync();
    return bm;
  }, [notifySync]);

  const deleteBookmark = useCallback(async (id: string) => {
    await repo.removeBookmark(id);
    setBookmarks((list) => list.filter((b) => b.id !== id));
    notifySync();
  }, [notifySync]);

  const touchHistory = useCallback(async (bookId: string, volumeId: string) => {
    await repo.touchHistory(bookId, volumeId);
    setHistory(await repo.getHistory());
    notifySync();
  }, [notifySync]);

  const removeHistory = useCallback(async (bookId: string) => {
    await repo.removeHistoryEntry(bookId);
    setHistory(await repo.getHistory());
    notifySync();
  }, [notifySync]);

  const setReaderSettings = useCallback((s: ReaderSettings) => {
    setReaderSettingsState(s);
    void repo.setSetting('reader', s);
    notifySync();
  }, [notifySync]);

  const value = useMemo<PersonalDataCtx>(
    () => ({
      ready,
      progress: progressMap,
      bookmarks,
      favorites,
      history,
      readerSettings,
      setReaderSettings,
      customFonts,
      addCustomFont,
      deleteCustomFont,
      saveProgress,
      toggleFavorite,
      addBookmark,
      deleteBookmark,
      touchHistory,
      removeHistory,
      refresh,
    }),
    [
      ready,
      progressMap,
      bookmarks,
      favorites,
      history,
      readerSettings,
      setReaderSettings,
      customFonts,
      addCustomFont,
      deleteCustomFont,
      saveProgress,
      toggleFavorite,
      addBookmark,
      deleteBookmark,
      touchHistory,
      removeHistory,
      refresh,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePersonalData(): PersonalDataCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePersonalData باید داخل PersonalDataProvider استفاده شود');
  return ctx;
}
