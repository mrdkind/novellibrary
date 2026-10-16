import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ePub from 'epubjs';
import { EpubCFI } from 'epubjs';
import type { Book, Contents, Location, Rendition, TocItem } from 'epubjs';
import {
  ArrowRight,
  BookOpen,
  Bookmark as BookmarkIcon,
  BookmarkPlus,
  Check,
  ChevronLeft,
  CornerDownRight,
  List,
  LocateFixed,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  Search,
  Settings2,
  X,
  XCircle,
} from 'lucide-react';
import type { Bookmark, CustomFont, Novel, ReaderSettings, Volume } from '@/types';
import { loadEpub, formatBytes } from '@/services/epubLoader';
import { faDigits } from '@/services/persian';
import { faIncludes } from '@/services/normalize';
import {
  CHAPTER_NAV_CSS,
  customFontFaceCss,
  effectiveDirection,
  effectivePalette,
  FONT_BASE_CSS,
  settingsOverrideCss,
  themeCss,
} from './readerSettings';
import ReaderSettingsPanel from './ReaderSettingsPanel';
import { InlineSpinner } from '@/components/StateBoxes';

interface EpubReaderProps {
  novel: Novel;
  volume: Volume;
  settings: ReaderSettings;
  onSettingsChange: (s: ReaderSettings) => void;
  initialCfi: string | null;
  initialHref: string | null;
  savedPercentage: number | null;
  bookmarks: Bookmark[];
  customFonts: CustomFont[];
  onAddCustomFont: (f: Omit<CustomFont, 'id' | 'createdAt'>) => Promise<CustomFont>;
  onDeleteCustomFont: (id: string) => Promise<void>;
  onAddBookmark: (label: string, cfi: string, href: string) => void;
  onDeleteBookmark: (id: string) => void;
  onProgress: (p: { cfi: string; href: string; chapterTitle: string; percentage: number }) => void;
  onChapterRead: (href: string) => void;
  onNextVolume: () => void;
  nextVolumeTitle: string | null;
  hasNextVolume: boolean;
  onExit: () => void;
}

type Status = 'loading' | 'rendering' | 'ready' | 'error';

interface FlatTocItem {
  title: string;
  href: string;
  depth: number;
}

function flattenToc(items: TocItem[], depth = 0): FlatTocItem[] {
  const out: FlatTocItem[] = [];
  for (const it of items ?? []) {
    const href = (it.href ?? '').split('#')[0];
    const title = it.label?.trim() || it.title?.trim() || href;
    if (href) out.push({ title, href, depth });
    if (it.subitems?.length) out.push(...flattenToc(it.subitems, depth + 1));
  }
  return out;
}

/**
 * تطبیق href فصل با فرم داخلی spine.
 * epub.js مسیرها را نسبت به پوشه OPF نگه می‌دارد (مثل text/ch1.xhtml) در حالی که
 * کاتالوگ مسیر کامل نسبت به ریشه EPUB دارد (مثل OEBPS/text/ch1.xhtml).
 */
function resolveSectionHref(book: Book, href: string): string {
  const items = book.spine?.items ?? [];
  const hit = items.find(
    (i) => i.href === href || i.href.endsWith(`/${href}`) || href.endsWith(`/${i.href}`) || href.endsWith(i.href),
  );
  return hit?.href ?? href;
}

/** تطبیق نرم دو href فصل (فرم spine ممکن است با فرم TOC تفاوت مسیر داشته باشد) */
function sameHref(a: string | null | undefined, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

/**
 * حل مسیر نسبی داخل بسته EPUB نسبت به مسیر فصل جاری (READER-002).
 * خروجی، مسیر نسبت به ریشه بسته است (مثل «OEBPS/images/ornament-a.svg»)
 * که می‌توان آن را به book.resources.createUrl داد.
 * ورودی باید همان‌طور که در XHTML نوشته شده حفظ شود (٪-انکودینگ باقی بماند). */
function resolveBookPath(sectionHref: string, rel: string): string {
  if (/^(data:|blob:|https?:|\/)/i.test(rel)) return '';
  const dir = sectionHref.includes('/') ? sectionHref.slice(0, sectionHref.lastIndexOf('/') + 1) : '';
  const stack: string[] = [];
  for (const seg of (dir + rel).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') stack.pop();
    else stack.push(seg);
  }
  return stack.join('/');
}

/**
 * استخراج گام اسپاین از CFI مکان‌های epub.js.
 * مکان‌ها به‌صورت epubcfi(/6/{step}[id]!/...) هستند که step = 2*(شماره بخش + 1).
 */
function spineStepFromLocationCfi(cfi: string): number | null {
  const m = /\/(\d+)(?:\[[^\]]*\])?!/.exec(cfi);
  return m ? Number(m[1]) : null;
}

/**
 * بازه [اولین، آخرین] اندیس مکان‌های یک بخش در فضای locations کتاب.
 * برای پرش دقیق درون‌فصلی در حالت صفحه‌بندی‌شده (نوار پایین مختص هر فصل).
 */
function sectionLocationRange(book: Book, sectionIndex: number): [number, number] | null {
  const locs = (book.locations as unknown as { _locations?: string[] })._locations;
  if (!locs || locs.length === 0) return null;
  const step = 2 * (sectionIndex + 1);
  let first = -1;
  let last = -1;
  for (let i = 0; i < locs.length; i++) {
    if (spineStepFromLocationCfi(locs[i]) === step) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return first < 0 ? null : [first, last];
}

/** اندیس spine یک href فصل (تطبیق نرم مسیر) */
function spineIndexOfHref(book: Book, href: string): number {
  const items = book.spine?.items ?? [];
  for (let i = 0; i < items.length; i++) {
    const h = items[i].href;
    if (h === href || h.endsWith(`/${href}`) || href.endsWith(`/${h}`)) return i;
  }
  return -1;
}

export default function EpubReader(props: EpubReaderProps) {
  const {
    novel,
    volume,
    settings,
    onSettingsChange,
    savedPercentage,
    bookmarks,
    customFonts,
    onAddCustomFont,
    onDeleteCustomFont,
    onAddBookmark,
    onDeleteBookmark,
    onProgress,
    onChapterRead,
    onNextVolume,
    nextVolumeTitle,
    hasNextVolume,
    onExit,
  } = props;

  const shellRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<Book | null>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const lastCfiRef = useRef<string | null>(null);
  const lastHrefRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationsStartedRef = useRef(false);
  /** نقطه شروع برای بازسازی‌های بعدی (مثل تغییر جهت/حالت نمایش) — با هر جابه‌جایی به‌روز می‌شود */
  const resumeCfiRef = useRef<string | null>(props.initialCfi);
  const resumeHrefRef = useRef<string | null>(props.initialHref);

  const [status, setStatus] = useState<Status>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [download, setDownload] = useState<{ loaded: number; total: number | null } | null>(null);
  const [percentage, setPercentage] = useState(savedPercentage ?? 0);
  const [currentChapter, setCurrentChapter] = useState('');
  const [toc, setToc] = useState<FlatTocItem[]>([]);
  const [panel, setPanel] = useState<'none' | 'chapters' | 'settings' | 'bookmarks'>('none');
  /* کنترل‌ها به‌صورت پیش‌فرض مخفی‌اند تا روی متن نیفتند؛
   * لمس/کلیک روی وسط صفحه نمایش/مخفی‌کردن می‌کند (طبق درخواست کاربر).
   * ترجیح «showToolbar» فقط تعیین می‌کند هنگام ورود چه وضعیتی باشد. */
  const [chromeVisible, setChromeVisible] = useState(settings.showToolbar);
  /* راهنمای یک‌باره «لمس وسط صفحه» — پس از بار اول دیگر نمایش داده نمی‌شود */
  const [tapHint, setTapHint] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [isBookmarked, setIsBookmarked] = useState(false);
  /** درصد پیشرفت «درون فصل جاری» — نوار پایین مختص هر فصل است (نه کل جلد) */
  const [chapterPct, setChapterPct] = useState(0);
  /** href فصل جاری — برای هایلایت دقیق در پاپ‌آپ فهرست فصل‌ها */
  const [currentHref, setCurrentHref] = useState('');
  /** مقدار لحظه‌ای اسلایدر هنگام کشیدن (قبل از کامیت پرش) */
  const [scrubPct, setScrubPct] = useState<number | null>(null);
  /** فیلتر جست‌وجوی عنوان فصل در پاپ‌آپ */
  const [chFilter, setChFilter] = useState('');
  const [autoPaused, setAutoPaused] = useState(false);
  /** UX-004 — وضعیت «خروج دو مرحله‌ای» با Escape */
  const [exitArmed, setExitArmed] = useState(false);

  const direction = useMemo(
    // UX-001 — متادیتای direction کاتالوگ هم به‌عنوان فالبک «خودکار» شرکت می‌کند
    () => effectiveDirection(settings, volume.language ?? novel.language, novel.direction),
    [settings.direction, volume.language, novel.language, novel.direction],
  );
  /** ترجیح نمایش کنترل‌ها هنگام ورود — برای تشخیص تغییر واقعی تنظیم */
  const showToolbarPrefRef = useRef(settings.showToolbar);
  /** جهت مؤثر برای استفاده در callbackها بدون وابستگی بازسازی */
  const directionRef = useRef(direction);
  directionRef.current = direction;

  const isScrolled = settings.readingMode === 'scrolled';

  /* ---------- رفرنس‌های وضعیت فصل جاری برای ناوبری درون‌صفحه ---------- */
  const spineIndexRef = useRef(-1);
  const isLastSectionRef = useRef(false);
  const currentChapterRef = useRef('');
  const percentageRef = useRef(percentage);
  percentageRef.current = percentage;
  const nextVolumeRef = useRef({ hasNextVolume, nextVolumeTitle });
  nextVolumeRef.current = { hasNextVolume, nextVolumeTitle };
  /** هندلر کلیک دکمه‌های نوار ناوبری داخل iframe (بدون وابستگی به بازسازی rendition) */
  const navClickRef = useRef<(action: string) => void>(() => {});
  const scrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentTocRef = useRef<HTMLDivElement | null>(null);
  /** آینه panel برای استفاده در callbackهای بدون وابستگی */
  const panelRef = useRef(panel);
  panelRef.current = panel;
  /** UX-002 — ردیابی لمس/کلیک روی تصاویر برای تشخیص دوبارلمس */
  const lastImgTapRef = useRef<{ t: number; src: string } | null>(null);
  const imgTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ---------- نمایش/مخفی‌کردن کنترل‌ها با لمس وسط صفحه ---------- */
  const toggleChrome = useCallback(() => {
    setChromeVisible((v) => !v);
  }, []);
  /** آینه toggleChrome برای استفاده در listener سند iframe (بدون وابستگی) */
  const chromeToggleRef = useRef(toggleChrome);
  chromeToggleRef.current = toggleChrome;

  /** تشخیص لمس/کلیک متنی روی سند کتاب (وسط صفحه) — نمایش/مخفی‌کردن کنترل‌ها.
   * دابل‌کلیک (انتخاب کلمه) و کشیدن برای انتخاب متن توگل نمی‌کنند. */
  const handleDocTap = useCallback((ev: MouseEvent, doc: Document) => {
    try {
      if (ev.detail > 1) return; // دابل‌کلیک دسکتاپ
      const sel = doc.getSelection?.();
      if (sel && !sel.isCollapsed && String(sel).trim().length > 0) return; // انتخاب متن در جریان است
      chromeToggleRef.current();
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------- اعمال تنظیمات ظاهری روی rendition ----------
   * epub.js هوک inject خودش تم‌های سریال‌شده (رشته CSS) را نادیده می‌گیرد؛
   * بنابراین CSS را مستقیماً در سند هر بخش تزریق می‌کنیم. */
  const cssRef = useRef('');
  const contentsRef = useRef<Set<Contents>>(new Set());

  const injectStyleIntoDoc = useCallback((doc: Document, css: string) => {
    try {
      let style = doc.getElementById('ns-reader-style') as HTMLStyleElement | null;
      if (!style) {
        style = doc.createElement('style');
        style.id = 'ns-reader-style';
        doc.head.appendChild(style);
      }
      style.textContent = css;
    } catch {
      /* ignore */
    }
  }, []);

  const applyVisuals = useCallback(
    (s: ReaderSettings) => {
      cssRef.current =
        FONT_BASE_CSS +
        customFontFaceCss(customFonts) +
        themeCss(s) +
        settingsOverrideCss(s, customFonts, directionRef.current) +
        CHAPTER_NAV_CSS;
      cssRef.current += `\nhtml { font-size: ${s.fontSize}%; }`;
      contentsRef.current.forEach((c) => injectStyleIntoDoc(c.document, cssRef.current));
    },
    [customFonts, injectStyleIntoDoc],
  );

  /* ---------- نوار ناوبری فصل (فصل قبلی / فهرست فصل‌ها / فصل بعدی) ----------
   * در ابتدا و انتهای هر فصل، داخل جریان محتوا تزریق می‌شود (نه شناور روی متن)
   * تا فضای خودش را داشته باشد و متن زیرش نرود. */
  const injectChapterNavs = useCallback((contents: Contents) => {
    try {
      const doc = contents.document;
      const body = doc.body;
      if (!body || doc.getElementById('ns-ch-nav-start')) return;
      const build = (pos: 'start' | 'end') => {
        const nav = doc.createElement('div');
        nav.className = `ns-ch-nav ns-${pos}`;
        nav.setAttribute('dir', directionRef.current);
        const mk = (action: string, label: string, cls: string) => {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = cls;
          btn.setAttribute('data-ns-nav', action);
          const lbl = doc.createElement('span');
          lbl.className = 'lbl';
          lbl.textContent = label;
          btn.appendChild(lbl);
          return btn;
        };
        nav.appendChild(mk('prev', 'فصل قبلی', ''));
        nav.appendChild(mk('toc', 'فهرست فصل‌ها', 'ns-toc-btn'));
        nav.appendChild(mk('next', 'فصل بعدی', ''));
        return nav;
      };
      const startNav = build('start');
      startNav.id = 'ns-ch-nav-start';
      body.insertBefore(startNav, body.firstChild);
      const endNav = build('end');
      endNav.id = 'ns-ch-nav-end';
      body.appendChild(endNav);
    } catch {
      /* ignore */
    }
  }, []);

  /** به‌روزرسانی وضعیت دکمه‌های نوار ناوبری (غیرفعال‌بودن قبلی در اولین فصل،
   * برچسب بعدی در آخرین فصل: جلد بعدی / پایان جلد) */
  const updateChapterNavs = useCallback(() => {
    const idx = spineIndexRef.current;
    const last = isLastSectionRef.current;
    const { hasNextVolume: hv, nextVolumeTitle: nvt } = nextVolumeRef.current;
    contentsRef.current.forEach((c) => {
      try {
        const doc = c.document;
        const prevBtn = doc.querySelector('[data-ns-nav="prev"]') as HTMLButtonElement | null;
        if (prevBtn) prevBtn.disabled = idx <= 0;
        const nextLbl = doc.querySelector('[data-ns-nav="next"] .lbl') as HTMLElement | null;
        if (nextLbl) {
          nextLbl.textContent = last
            ? hv
              ? `جلد بعدی: ${nvt ?? ''}`
              : 'پایان این جلد؛ بازگشت به کتاب'
            : 'فصل بعدی';
        }
      } catch {
        /* ignore */
      }
    });
  }, []);

  /* ---------- ساخت و نمایش کتاب (با تغییر حالت نمایش یا جهت از نو ساخته می‌شود) ---------- */
  useEffect(() => {
    let destroyed = false;
    let abort: AbortController | null = new AbortController();

    (async () => {
      try {
        setStatus('loading');
        setErrorMsg('');
        // آماده‌سازی CSS پیش از رندر تا content hook اولین بخش را تمیز ببیند
        applyVisuals(settings);
        const buffer = await loadEpub(volume.file, setDownload, abort.signal);
        if (destroyed) return;

        setStatus('rendering');
        // توجه: برای ArrayBuffer نباید openAs تعیین شود؛ epub.js نوع ورودی را خود تشخیص می‌دهد
        const book = ePub(buffer);
        bookRef.current = book;

        const host = hostRef.current;
        if (!host) return;
        host.innerHTML = '';

        const rendition = book.renderTo(host, {
          width: '100%',
          height: isScrolled ? 'auto' : '100%',
          flow: isScrolled ? 'scrolled-doc' : 'paginated',
          manager: 'default',
          /* نکته مهم epub.js: کانستراکتور جهت را با metadata کتاب بازنویسی می‌کند و
           * نام گزینه «defaultDirection» است؛ هر دو را پاس می‌دهیم و بعد از ساخت
           * نیز rendition.direction() را صریحاً فراخوانی می‌کنیم تا انتخاب کاربر
           * همیشه بر جهت metadata کتاب برتری داشته باشد (رفع باگ «RTL کار نمی‌کند»). */
          direction,
          defaultDirection: direction,
          allowScriptedContent: false,
          spread: 'auto',
          minSpreadWidth: 780,
          /* READER-005 — CFIها هرگز به نوار ناوبری تزریقی گره نخورند؛
           * epub.js این کلاس را هنگام تولید CFI نادیده می‌گیرد */
          ignoreClass: 'ns-ch-nav',
        });
        rendition.direction(direction);
        renditionRef.current = rendition;

        /* --- امنیت، رفتار لینک‌ها/تصاویر و تزریق تم در محتوای کتاب --- */
        rendition.hooks.content.register((contents: Contents) => {
          const doc = contents.document;
          contentsRef.current.add(contents);
          contents.window.addEventListener('unload', () => contentsRef.current.delete(contents));
          // تزریق CSS تم (epub.js تم‌های سریال‌شده را در هوک خودش پشتیبانی نمی‌کند)
          injectStyleIntoDoc(doc, cssRef.current);
          // نوار ناوبری فصل در ابتدا و انتهای فصل — درون جریان محتوا
          injectChapterNavs(contents);
          // دفاع در عمق: حذف هر اسکریپت جاسازی‌شده (allowScriptedContent=false هم فعال است)
          doc.querySelectorAll('script').forEach((n) => n.remove());

          /* A11Y-003 — عنوان دسترس‌پذیری برای iframe کتاب‌خوان */
          try {
            const frame = contents.window.frameElement as HTMLIFrameElement | null;
            if (frame && !frame.getAttribute('title')) frame.setAttribute('title', 'محتوای کتاب');
          } catch {
            /* ignore */
          }

          /* READER-002 — بازنویسی src تصاویر با مسیر نسبی «../» :
           * در حالت بازکردن از بافر (archived)، epub.js مسیرهای نسبی والد را درست حل
           * نمی‌کند و مرورگر آن‌ها را نسبت به ریشه سایت درخواست می‌کند (۴۰۴).
           * راه‌حل: مسیر نسبی را نسبت به فصل جاری به مسیر داخل بسته تبدیل و با
           * book.resources.createUrl به یک blob: URL سالم بازنویسی می‌کنیم. */
          try {
            const book0 = bookRef.current;
            const sec = book0?.spine?.items?.[contents.sectionIndex as unknown as number] ?? null;
            const secHref = sec?.href ?? '';
            if (book0 && secHref && typeof book0.resources?.createUrl === 'function') {
              /* hrefهای spine نسبت به پوشه OPF هستند؛ مسیر نهایی باید نسبت به
               * ریشه بسته ZIP ساخته شود (مثلاً «OEBPS/text/…» → «OEBPS/images/…») */
              const opfDir = book0.path?.directory ?? '';
              const base = opfDir && !opfDir.endsWith('/') ? `${opfDir}/` : opfDir;
              const fullSecHref = `${base}${secHref}`;
              const createUrl = book0.resources.createUrl.bind(book0.resources);
              doc.querySelectorAll('img').forEach((el) => {
                const imgEl = el as HTMLImageElement;
                const raw = imgEl.getAttribute('src');
                if (!raw) return;
                if (/^(data:|blob:|https?:)/i.test(raw)) return;
                const zipPath = resolveBookPath(fullSecHref, raw);
                if (!zipPath) return;
                /* توجه: archive.getBlob مسیر را با substr(1) می‌خواند — اسلش ابتدایی لازم است */
                void createUrl(`/${zipPath}`)
                  .then((url) => {
                    if (url && imgEl.isConnected) imgEl.src = url;
                  })
                  .catch(() => {
                    /* تصویر در بسته نبود — به حالت قبل رها می‌شود */
                  });
              });
            }
          } catch {
            /* ignore */
          }

          // جلوگیری از ارسال فرم‌های کتاب
          doc.addEventListener(
            'submit',
            (e) => {
              e.preventDefault();
              e.stopPropagation();
            },
            true,
          );

          /* میان‌برهای صفحه‌کلید پس از کلیک داخل کتاب از کار نمی‌افتند:
           * با کلیک روی سند کتاب، فوکوس به iframe می‌رود و keydownهای آن هرگز
           * به شنونده پنجره اصلی نمی‌رسند؛ رویداد را به پنجره اصلی بازپخش می‌کنیم. */
          doc.addEventListener('keydown', (ev) => {
            try {
              const e = ev as KeyboardEvent;
              const t = e.target as HTMLElement | null;
              if (t && (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || t.isContentEditable)) return;
              window.dispatchEvent(
                new KeyboardEvent('keydown', {
                  key: e.key,
                  code: e.code,
                  shiftKey: e.shiftKey,
                  ctrlKey: e.ctrlKey,
                  altKey: e.altKey,
                  metaKey: e.metaKey,
                  bubbles: true,
                }),
              );
            } catch {
              /* ignore */
            }
          });

          // مدیریت لینک‌ها: داخلی → پرش، خارجی → تب جدید ایمن
          doc.addEventListener(
            'click',
            (ev) => {
              const target = ev.target as HTMLElement | null;
              if (!target) return;

              // دکمه‌های نوار ناوبری فصل (قبلی/فهرست/بعدی) — اولویت بالاتر از لینک/تصویر
              const navBtn = target.closest('[data-ns-nav]') as HTMLButtonElement | null;
              if (navBtn) {
                ev.preventDefault();
                ev.stopPropagation();
                if (!navBtn.disabled) navClickRef.current(navBtn.getAttribute('data-ns-nav') ?? '');
                return;
              }

              // UX-002 — بزرگ‌نمایی تصویر فقط با «دوبار لمس/کلیک»؛ تک‌لمس تصویر،
              // مثل متن ساده، کنترل‌ها را نشان/مخفی می‌کند تا در صفحات تصویری
              // راهنمای «لمس وسط صفحه» گمراه‌کننده نباشد.
              const img = target.closest('img') as HTMLImageElement | null;
              if (img) {
                ev.preventDefault();
                ev.stopPropagation();
                const src = img.currentSrc || img.src;
                if (!src) return;
                const now = performance.now();
                const last = lastImgTapRef.current;
                if (last && now - last.t < 380 && last.src === src) {
                  // لمس دوم → بزرگ‌نمایی
                  lastImgTapRef.current = null;
                  if (imgTapTimerRef.current) {
                    clearTimeout(imgTapTimerRef.current);
                    imgTapTimerRef.current = null;
                  }
                  setLightbox(src);
                } else {
                  lastImgTapRef.current = { t: now, src };
                  if (imgTapTimerRef.current) clearTimeout(imgTapTimerRef.current);
                  imgTapTimerRef.current = setTimeout(() => {
                    imgTapTimerRef.current = null;
                    chromeToggleRef.current();
                  }, 360);
                }
                return;
              }

              // لمس/کلیک روی خودِ نوار ناوبری تزریق‌شده (فضای خالی اطراف دکمه‌ها) توگل نکند
              if (target.closest('.ns-ch-nav')) return;

              const anchor = target.closest('a') as HTMLAnchorElement | null;
              if (!anchor || !anchor.getAttribute('href')) {
                // کلیک روی متن ساده کتاب (وسط صفحه) → نمایش/مخفی‌کردن کنترل‌ها
                handleDocTap(ev, doc);
                return;
              }
              ev.preventDefault();
              ev.stopPropagation();
              const raw = anchor.getAttribute('href') ?? '';
              if (/^https?:\/\//i.test(raw)) {
                window.open(raw, '_blank', 'noopener,noreferrer');
                return;
              }
              if (raw.startsWith('#')) {
                // لینک داخلی همان فصل
                const currentHref = lastHrefRef.current;
                if (currentHref) void rendition.display(`${currentHref}${raw}`).catch(() => {});
                return;
              }
              if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return; // schemeهای دیگر نادیده
              void rendition.display(resolveSectionHref(bookRef.current as Book, raw)).catch(() => {});
            },
            true,
          );
        });

        /* --- ردیابی پیشرفت و تشخیص انتهای فصل --- */
        rendition.on('relocated', (locationArg: unknown) => {
          const loc = locationArg as {
            start?: {
              href?: string;
              index?: number;
              percentage?: number;
              cfi?: string;
              displayed?: { page?: number; total?: number };
            };
            end?: { displayed?: { page?: number; total?: number }; index?: number };
            at?: string;
            cfi?: string;
            atEnd?: boolean;
          };
          const cfi: string | undefined = loc?.start?.cfi ?? loc?.at ?? loc?.cfi ?? lastCfiRef.current ?? undefined;
          const href = loc?.start?.href ?? null;
          const total = Math.max(1, volume.spineCount);

          /** READER-005 — جدا‌سازی CFI از گره تزریقی ناوبری:
           * CFIهایی که به ns-ch-nav-start/end گره می‌خورند با حذف/تغییر تزریق
           * نامعتبر می‌شوند؛ به نخستین گره واقعی محتوا اسنپ می‌کنیم. */
          const snapCfiOffInjectedNav = (candidate?: string | null, fallback?: string | null): string | undefined => {
            if (!candidate) return fallback ?? undefined;
            if (!/ns-ch-nav/.test(candidate)) return candidate;
            return fallback && !/ns-ch-nav/.test(fallback) ? fallback : candidate;
          };

          // درصد: مکان‌های تولیدشده (دقیق) > جایگاه فصل در spine > مقدار خود رویداد
          let pct: number | undefined;
          if (bookRef.current && cfi && bookRef.current.locations.total > 0) {
            const viaLocations = bookRef.current.locations.percentageFromCfi(cfi);
            if (typeof viaLocations === 'number' && !Number.isNaN(viaLocations)) pct = viaLocations;
          }
          if ((pct === undefined || Number.isNaN(pct)) && bookRef.current && href) {
            const items = bookRef.current.spine.items ?? [];
            const idx = items.findIndex((i) => i.href === href || href.endsWith(i.href));
            pct = idx >= 0 ? Math.min(0.999, Math.max(0, (idx + 0.5) / Math.max(1, items.length || total))) : undefined;
          }
          if (pct === undefined || Number.isNaN(pct)) {
            const fromEvent = loc?.start?.percentage;
            pct = typeof fromEvent === 'number' && !Number.isNaN(fromEvent) ? fromEvent : 0;
          }

          const startCfi = snapCfiOffInjectedNav(cfi, (loc as unknown as { end?: { cfi?: string } })?.end?.cfi ?? null);
          const endCfi = snapCfiOffInjectedNav((loc as unknown as { end?: { cfi?: string } })?.end?.cfi ?? null, cfi);
          if (startCfi) lastCfiRef.current = startCfi;
          if (href) lastHrefRef.current = href;
          if (startCfi) resumeCfiRef.current = startCfi;
          if (href) resumeHrefRef.current = href;
          void endCfi;

          setPercentage(pct);

          /* --- جایگاه درون فصل (نوار پایین مختص هر فصل) ---
           * حالت صفحه‌بندی‌شده: displayed.page/total = صفحه فعلی از صفحات همین فصل.
           * حالت پیمایشی: توسط listener اسکرول محاسبه می‌شود. */
          const disp = loc?.end?.displayed ?? loc?.start?.displayed;
          const page = disp?.page ?? 0;
          const pageTotal = disp?.total ?? 0;
          const spineItems = bookRef.current?.spine.items ?? [];
          const startIndex = loc?.start?.index ?? -1;
          const last = spineItems.length > 0 && startIndex >= spineItems.length - 1;
          spineIndexRef.current = startIndex;
          isLastSectionRef.current = last;

          if (!isScrolled) {
            setChapterPct(pageTotal > 0 ? Math.min(1, Math.max(0, page / pageTotal)) : 0);
          }
          if (href) setCurrentHref(href);
          // برچسب/وضعیت دکمه‌های نوار ناوبری درون‌صفحه (فصل قبلی/بعدی)
          updateChapterNavs();

          // عنوان فصل جاری از TOC خود کتاب یا کاتالوگ
          if (href) {
            const match =
              tocRef.current.find((t) => href.endsWith(t.href) || t.href.endsWith(href)) ??
              volumeRef.current.chapters.find((c) => href.endsWith(c.href));
            const chapterTitle = match?.title ?? '';
            currentChapterRef.current = chapterTitle;
            setCurrentChapter(chapterTitle);
            if (startCfi && href && lastReadHrefRef.current !== href) {
              lastReadHrefRef.current = href;
              onChapterRead(href);
            }
            if (startCfi && href) {
              scheduleSave(startCfi, href, chapterTitle, pct);
            }
          }
          setIsBookmarked(Boolean(startCfi && bookmarksRef.current.some((b) => b.cfi === startCfi)));
        });

        setToc([]);
        try {
          const nav = (await book.loaded.navigation) as { toc: TocItem[] };
          const flat = flattenToc(nav?.toc ?? []);
          /* اگر nav کتاب قابل استخراج نبود/خالی بود، از فصل‌های کاتالوگ (استخراج‌شده در Build) استفاده کن */
          if (!destroyed) {
            setToc(flat.length > 0 ? flat : volumeRef.current.chapters.map((c) => ({ title: c.title, href: c.href, depth: 0 })));
          }
        } catch {
          if (!destroyed) {
            setToc(volumeRef.current.chapters.map((c) => ({ title: c.title, href: c.href, depth: 0 })));
          }
        }

        /* --- نقطه شروع: آخرین CFI (پس از بازسازی) > CFI ذخیره‌شده > فصل درخواستی > ابتدای جلد --- */
        const startTarget = resumeCfiRef.current
          ? resumeCfiRef.current
          : resumeHrefRef.current
            ? resolveSectionHref(book, resumeHrefRef.current)
            : undefined;
        const withTimeout = <T,>(p: Promise<T>, ms: number, msg: string): Promise<T> =>
          Promise.race([
            p,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error(msg)), ms)),
          ]);
        await withTimeout(rendition.display(startTarget), 45_000, 'آماده‌سازی کتاب بیش از حد طول کشید.')
          .catch(() => rendition.display())
          .catch(() => {
            throw new Error('نمایش کتاب ناموفق بود؛ فایل EPUB ممکن است ناسازگار باشد.');
          });

        if (destroyed) return;
        setStatus('ready');

        /* READER-004 — بازکالیبراسیون پس از بازسازی (تغییر حالت/جهت):
         * بلافاصله بعد از سوییچ، رویداد relocated ممکن است با displayed.total=1
         * (پیش از آماده‌شدن ستون‌ها) صد درصد نشان دهد؛ پس از سکون، موقعیت واقعی
         * یک بار بازخوانی و نوار درون‌فصلی اصلاح می‌شود. */
        if (!isScrolled) {
          setTimeout(() => {
            if (destroyed || renditionRef.current !== rendition) return;
            try {
              const cur = rendition.currentLocation() as Location | null;
              const disp =
                (cur as unknown as { end?: { displayed?: { page?: number; total?: number } } })?.end?.displayed ??
                (cur as unknown as { start?: { displayed?: { page?: number; total?: number } } })?.start?.displayed;
              const pg = disp?.page ?? 0;
              const tt = disp?.total ?? 0;
              if (tt > 0) setChapterPct(Math.min(1, Math.max(0, pg / tt)));
            } catch {
              /* ignore */
            }
          }, 550);
        }

        /* READER-001 — بیمهٔ فرود اسکرول روی CFI در حالت پیمایشی:
         * epub.js معمولاً خودش هنگام display(CFI) به موقعیت اسکرول می‌برد؛
         * اگر پس از سکون اسکرول ظرف صفر مانده بود و CFI نقطه‌ای غیر از ابتدای
         * فصل بود، دستی به عنصر هدف اسکرول می‌کنیم تا «ادامه از همان‌جا» تضمین شود. */
        if (isScrolled && startTarget && startTarget.startsWith('epubcfi') && !/ns-ch-nav/.test(startTarget)) {
          setTimeout(() => {
            if (destroyed || renditionRef.current !== rendition) return;
            try {
              const el = scrollContainerRef.current;
              if (!el || el.scrollTop > 8) return;
              const cfiObj = new EpubCFI(startTarget);
              const view = (rendition as unknown as { views?: () => { all: () => Array<Record<string, unknown>> } }).views?.().all?.()[0];
              const doc = (view?.doc ?? view?.document ?? (view?.contents as { document?: Document } | undefined)?.document) as Document | undefined;
              if (!doc) return;
              const range = cfiObj.toRange(doc, 'ns-ch-nav');
              const node = range.startContainer;
              const targetEl = (node.nodeType === 1 ? (node as Element) : node.parentElement)?.closest?.('p, h1, h2, h3, h4, h5, h6, li, blockquote, img, div, body') ?? (node.nodeType === 1 ? (node as Element) : node.parentElement);
              if (targetEl && targetEl !== doc.body) {
                const top = targetEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
                el.scrollTo({ top: Math.max(0, top - 24), behavior: 'auto' });
              }
            } catch {
              /* ignore */
            }
          }, 400);
        }

        /* --- تولید مکان‌ها در پس‌زمینه برای درصد دقیق (فقط کتاب‌های متوسط) --- */
        if (!locationsStartedRef.current && volume.spineCount <= 220) {
          locationsStartedRef.current = true;
          setTimeout(() => {
            bookRef.current?.locations
              .generate(1100)
              .then(() => {})
              .catch(() => {});
          }, 1400);
        }
      } catch (e) {
        if (destroyed) return;
        console.error('خطای بازکردن EPUB:', e);
        setErrorMsg(e instanceof Error ? e.message : 'خطای نامشخص');
        setStatus('error');
      }
    })();

    return () => {
      destroyed = true;
      abort?.abort();
      abort = null;
      flushSave();
      contentsRef.current.clear();
      const rendition = renditionRef.current;
      renditionRef.current = null;
      try {
        rendition?.destroy();
      } catch {
        /* ignore */
      }
      const book = bookRef.current;
      bookRef.current = null;
      try {
        book?.destroy();
      } catch {
        /* ignore */
      }
    };
    // توجه: تغییر readingMode و direction باعث بازسازی کامل می‌شود (سازگاری بر ظاهر ترجیح داده شده)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume.file, settings.readingMode, direction]);

  /* ---------- باز اعمال تنظیمات ظاهری بدون بازسازی ---------- */
  useEffect(() => {
    applyVisuals(settings);
  }, [settings, applyVisuals]);

  useEffect(() => {
    /* فقط وقتی کاربر خودش ترجیح را تغییر داده sync شود — نه در بارگذاری اولیه؛
     * وگرنه هر تغییر دیگر تنظیمات، وضعیت دستی کنترل‌ها را بازنویسی می‌کند */
    if (settings.showToolbar !== showToolbarPrefRef.current) {
      showToolbarPrefRef.current = settings.showToolbar;
      setChromeVisible(settings.showToolbar);
    }
  }, [settings.showToolbar]);

  /* ---------- ذخیره پیشرفت (debounce + flush) ---------- */
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const tocRef = useRef<FlatTocItem[]>([]);
  tocRef.current = toc;
  const bookmarksRef = useRef<Bookmark[]>([]);
  bookmarksRef.current = bookmarks;
  const lastReadHrefRef = useRef<string | null>(null);
  const pendingRef = useRef<{ cfi: string; href: string; chapterTitle: string; percentage: number } | null>(null);

  const scheduleSave = useCallback(
    (cfi: string, href: string, chapterTitle: string, pct: number) => {
      pendingRef.current = { cfi, href, chapterTitle, percentage: pct };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => flushSave(), 800);
    },
    [],
  );

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const p = pendingRef.current;
    if (p) {
      onProgress(p);
      pendingRef.current = null;
    }
  }, [onProgress]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flushSave();
    };
    const onBeforeUnload = () => flushSave();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushSave]);

  /* ---------- ناوبری ---------- */
  const goNext = useCallback(() => {
    void renditionRef.current?.next().catch(() => {});
  }, []);
  const goPrev = useCallback(() => {
    void renditionRef.current?.prev().catch(() => {});
  }, []);

  const jumpTo = useCallback(async (target: string) => {
    const r = renditionRef.current;
    const book = bookRef.current;
    if (!r) return;
    setPanel('none');
    const resolved = target.startsWith('epubcfi') || !book ? target : resolveSectionHref(book, target);
    await r.display(resolved).catch(() => {});
  }, []);

  /* ---------- درصد درون‌فصلی + ثبت CFI در حالت پیمایشی (اسکرول ظرف) ----------
   * READER-001 — قبلاً اسکرول فقط درصد بصری را به‌روز می‌کرد و CFI هرگز ذخیره
   * نمی‌شد؛ نتیجه: هر خروج/ورود = برگشت به بالای فصل. اکنون پس از ۲۶۰ms سکون
   * اسکرول، CFI جاری از rendition.currentLocation() خوانده و در همان صف ذخیره
   * (scheduleSave) می‌رود؛ پیشرفت کل جلد و «ادامه مطالعه» هم واقعی می‌شود. */
  useEffect(() => {
    if (!isScrolled || status !== 'ready') return;
    const el = scrollContainerRef.current;
    if (!el) return;

    let captureTimer: ReturnType<typeof setTimeout> | null = null;

    const capture = () => {
      const r = renditionRef.current;
      const book = bookRef.current;
      if (!r || !book) return;
      try {
        const loc = r.currentLocation() as Location | null;
        const rawStart = (loc as unknown as { start?: { cfi?: string; href?: string } })?.start;
        let cfi = rawStart?.cfi;
        const endCfi = (loc as unknown as { end?: { cfi?: string } })?.end?.cfi;
        // READER-005 — اگر هنوز به گره تزریقی چسبید، به گره واقعی اسنپ کن
        if (cfi && /ns-ch-nav/.test(cfi)) {
          cfi = endCfi && !/ns-ch-nav/.test(endCfi) ? endCfi : cfi;
        }
        const href = rawStart?.href ?? lastHrefRef.current;
        if (!cfi || !href) return;

        lastCfiRef.current = cfi;
        resumeCfiRef.current = cfi;
        resumeHrefRef.current = href;

        // درصد کل جلد: مکان‌های تولیدشده > تقریب جایگاه فصل + کسر درون‌فصلی
        let pct: number | undefined;
        if (book.locations.total > 0) {
          const viaLocations = book.locations.percentageFromCfi(cfi);
          if (typeof viaLocations === 'number' && !Number.isNaN(viaLocations)) pct = viaLocations;
        }
        if (pct === undefined || Number.isNaN(pct)) {
          const items = book.spine.items ?? [];
          const idx = spineIndexOfHref(book, href);
          const inChapter = el.scrollHeight - el.clientHeight > 0 ? el.scrollTop / (el.scrollHeight - el.clientHeight) : 0;
          pct =
            idx >= 0
              ? Math.min(0.999, Math.max(0, (idx + Math.min(0.9, inChapter)) / Math.max(1, items.length)))
              : percentageRef.current;
        }
        setPercentage(pct);
        scheduleSave(cfi, href, currentChapterRef.current, pct);
      } catch {
        /* ignore */
      }
    };

    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setChapterPct(max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0);
      if (captureTimer) clearTimeout(captureTimer);
      captureTimer = setTimeout(capture, 260);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (captureTimer) clearTimeout(captureTimer);
    };
  }, [isScrolled, status, scheduleSave]);

  /* ---------- پاک‌سازی تایمر کشیدن اسلایدر ---------- */
  useEffect(
    () => () => {
      if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
    },
    [],
  );

  /** باز کردن پاپ‌آپ فهرست فصل‌ها — همیشه با فیلتر خالی */
  const openChapters = useCallback(() => {
    setChFilter('');
    setPanel('chapters');
  }, []);

  /* ---------- دکمه‌های نوار ناوبری فصل داخل iframe ---------- */
  const handleNavAction = useCallback(
    (action: string) => {
      if (action === 'toc') {
        openChapters();
        return;
      }
      const book = bookRef.current;
      const r = renditionRef.current;
      if (!book || !r) return;
      const idx = spineIndexRef.current;
      if (action === 'prev') {
        // پرش به ابتدای فصل قبلی (در اولین فصل، دکمه غیرفعال است)
        if (idx > 0) {
          const target = book.spine.items[idx - 1];
          if (target) void r.display(target.href).catch(() => {});
        }
        return;
      }
      if (action === 'next') {
        // در آخرین فصل: جلد بعدی / بازگشت به کتاب
        if (isLastSectionRef.current) {
          flushSave();
          onNextVolume();
          return;
        }
        const target = book.spine.items[idx + 1];
        if (target) void r.display(target.href).catch(() => {});
      }
    },
    [flushSave, onNextVolume, openChapters],
  );
  navClickRef.current = handleNavAction;

  /* ---------- پرش درون فصل (نوار پایین مختص هر فصل) ---------- */
  const commitChapterSeek = useCallback(
    (frac: number) => {
      const book = bookRef.current;
      const r = renditionRef.current;
      if (!book || !r) return;
      const f = Math.min(1, Math.max(0, frac));
      if (isScrolled) {
        const el = scrollContainerRef.current;
        if (!el) return;
        const max = el.scrollHeight - el.clientHeight;
        el.scrollTop = max > 0 ? f * max : 0;
        // به‌روزرسانی CFI ذخیره‌شده بر اساس موقعیت جدید اسکرول
        window.setTimeout(() => {
          try {
            const loc = r.currentLocation() as Location | null;
            const cfi = loc?.start?.cfi;
            const href = loc?.start?.href ?? lastHrefRef.current;
            if (cfi) {
              lastCfiRef.current = cfi;
              resumeCfiRef.current = cfi;
            }
            if (href) resumeHrefRef.current = href;
            const bookPct =
              book.locations.total > 0 && cfi ? book.locations.percentageFromCfi(cfi) : null;
            if (cfi && href) {
              scheduleSave(
                cfi,
                href,
                currentChapterRef.current,
                typeof bookPct === 'number' && !Number.isNaN(bookPct) ? bookPct : percentageRef.current,
              );
            }
          } catch {
            /* ignore */
          }
        }, 80);
      } else {
        // حالت صفحه‌بندی‌شده: پرش دقیق با نگاشت فصل → بازه مکان‌ها
        const idx = spineIndexRef.current;
        if (idx < 0) return;
        const range = sectionLocationRange(book, idx);
        if (range && book.locations.total > 0) {
          const [first, last] = range;
          const locIdx = Math.min(book.locations.total, Math.max(0, Math.round(first + (last - first) * f)));
          const cfi = book.locations.cfiFromLocation(locIdx);
          if (cfi) {
            void r.display(cfi).catch(() => {});
            return;
          }
        }
        // فالبک (بدون locations): پرش به ابتدای فصل
        const item = book.spine.items[idx];
        if (item) void r.display(item.href).catch(() => {});
      }
    },
    [isScrolled, scheduleSave],
  );

  /** کشیدن اسلایدر: بازخورد فوری + کامیت پرش با تاخیر کوتاه (جلوگیری از تراکم display) */
  const onChapterSliderInput = useCallback(
    (raw: number) => {
      const frac = raw / 1000;
      setScrubPct(frac);
      if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current);
      scrubTimerRef.current = setTimeout(() => {
        scrubTimerRef.current = null;
        commitChapterSeek(frac);
        setScrubPct(null);
      }, 280);
    },
    [commitChapterSeek],
  );

  /* ---------- اسکرول خودکار ---------- */
  const autoPausedRef = useRef(false);
  autoPausedRef.current = autoPaused;
  const lastInteractionRef = useRef(0);

  useEffect(() => {
    if (!settings.autoScroll || status !== 'ready') return;

    // حالت پیمایشی: پیمایش نرم پیکسلی
    if (isScrolled) {
      let raf = 0;
      let last = performance.now();
      const tick = (now: number) => {
        raf = requestAnimationFrame(tick);
        const el = scrollContainerRef.current;
        if (!el) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        // توقف موقت هنگام تعامل کاربر یا باز بودن پنل یا توقف دستی
        const idle = now - lastInteractionRef.current > 3500;
        if (autoPausedRef.current || panel !== 'none' || !idle) return;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
        if (atBottom) return;
        el.scrollTop += settings.autoScrollSpeed * dt;
      };
      raf = requestAnimationFrame(tick);

      const markInteraction = () => {
        lastInteractionRef.current = performance.now();
      };
      const el = scrollContainerRef.current;
      el?.addEventListener('touchstart', markInteraction, { passive: true });
      el?.addEventListener('wheel', markInteraction, { passive: true });
      el?.addEventListener('pointerdown', markInteraction);
      return () => {
        cancelAnimationFrame(raf);
        el?.removeEventListener('touchstart', markInteraction);
        el?.removeEventListener('wheel', markInteraction);
        el?.removeEventListener('pointerdown', markInteraction);
      };
    }

    // حالت صفحه‌بندی‌شده: ورق‌زدن خودکار
    const intervalMs = Math.max(4000, 150_000 / Math.max(1, settings.autoScrollSpeed));
    const timer = setInterval(() => {
      if (autoPausedRef.current || panel !== 'none') return;
      const now = performance.now();
      if (now - lastInteractionRef.current < 6000) return;
      goNext();
    }, intervalMs);
    const markInteraction = () => {
      lastInteractionRef.current = performance.now();
    };
    window.addEventListener('touchstart', markInteraction, { passive: true });
    window.addEventListener('wheel', markInteraction, { passive: true });
    return () => {
      clearInterval(timer);
      window.removeEventListener('touchstart', markInteraction);
      window.removeEventListener('wheel', markInteraction);
    };
  }, [settings.autoScroll, settings.autoScrollSpeed, isScrolled, status, panel, goNext]);

  /* ---------- کلیدهای میان‌بر ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          direction === 'rtl' ? goNext() : goPrev();
          break;
        case 'ArrowRight':
          e.preventDefault();
          direction === 'rtl' ? goPrev() : goNext();
          break;
        case ' ':
          if (settings.readingMode === 'paginated') {
            e.preventDefault();
            goNext();
          }
          break;
        case 't':
        case 'T':
          // بستن/بازکردن پاپ‌آپ فهرست فصل‌ها (بازشدن همیشه با فیلتر خالی)
          if (panelRef.current === 'chapters') setPanel('none');
          else openChapters();
          break;
        case 's':
        case 'S':
          setPanel((p) => (p === 'settings' ? 'none' : 'settings'));
          break;
        case 'm':
        case 'M':
          setPanel((p) => (p === 'bookmarks' ? 'none' : 'bookmarks'));
          break;
        case 'b':
        case 'B':
          void handleAddBookmark();
          break;
        case 'f':
        case 'F':
          void toggleFullscreen();
          break;
        case 'h':
        case 'H':
          setChromeVisible((v) => !v);
          break;
        case 'Escape':
          if (lightbox) setLightbox(null);
          else if (panel !== 'none') {
            setPanel('none');
            setExitArmed(false);
          } else if (exitArmedRef.current) {
            // UX-004 — دومین Escape در بازه مجاز: خروج واقعی
            if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
            exitArmTimerRef.current = null;
            exitArmedRef.current = false;
            onExit();
          } else {
            // UX-004 — خروج دو مرحله‌ای: کاربر در حال مطالعه نباید با یک کلید کل
            // برنامه را ببیند؛ نخستین Escape فقط هشدار می‌دهد.
            setExitArmed(true);
            exitArmedRef.current = true;
            if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
            exitArmTimerRef.current = setTimeout(() => {
              exitArmedRef.current = false;
              setExitArmed(false);
            }, 2800);
          }
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direction, settings.readingMode, panel, lightbox, goNext, goPrev, openChapters]);

  /* پاک‌سازی وضعیت خروج دو مرحله‌ای */
  const exitArmedRef = useRef(false);
  const exitArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  exitArmedRef.current = exitArmed;
  useEffect(
    () => () => {
      if (exitArmTimerRef.current) clearTimeout(exitArmTimerRef.current);
      if (imgTapTimerRef.current) clearTimeout(imgTapTimerRef.current);
    },
    [],
  );

  /* ---------- تمام‌صفحه ---------- */
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await shellRef.current?.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      /* پشتیبانی نمی‌شود */
    }
  }, []);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  /* ---------- نشانک ---------- */
  const handleAddBookmark = useCallback(async () => {
    const cfi = lastCfiRef.current;
    if (!cfi) return;
    // VIS-002 — برچسب نشانک با ارقام فارسی (هماهنگ با کل رابط)
    const label = currentChapter || `نشانک در ${faDigits(Math.round(percentage * 100))}٪`;
    onAddBookmark(label, cfi, lastHrefRef.current ?? '');
  }, [currentChapter, percentage, onAddBookmark]);

  /* ---------- لمس و کشیدن (فقط حالت صفحه‌بندی‌شده) ---------- */
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || settings.readingMode !== 'paginated') return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
    const movedLeft = dx < 0;
    if (movedLeft) direction === 'rtl' ? goPrev() : goNext();
    else direction === 'rtl' ? goNext() : goPrev();
  };

  /* ---------- رندر ---------- */
  const pal = useMemo(
    () => effectivePalette(settings),
    [settings.theme, settings.textColor, settings.bgColor, settings.bgImageOpacity],
  );

  /** کلیک روی فضای خالی ظرف کتاب (بیرون iframe — مثل حاشیه‌ها) توگل کنترل‌ها */
  const onContainerTap = useCallback(
    (e: React.MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('button, a, input, [role="button"]')) return;
      toggleChrome();
    },
    [toggleChrome],
  );

  /* راهنمای یک‌باره لمس وسط صفحه — فقط بار اول (localStorage) */
  useEffect(() => {
    if (status !== 'ready') return;
    let seen = false;
    try {
      seen = localStorage.getItem('ns-taphint-seen') === '1';
    } catch {
      seen = false;
    }
    if (seen) return;
    setTapHint(true);
    const t = setTimeout(() => {
      setTapHint(false);
      try {
        localStorage.setItem('ns-taphint-seen', '1');
      } catch {
        /* ignore */
      }
    }, 5200);
    return () => clearTimeout(t);
  }, [status]);

  /** اندیس فصل جاری در فهرست مطالب.
   * فالبک: در صفحات خارج از فهرست (جلد/عنوان)، نزدیک‌ترین فصلِ بعدی نشان داده می‌شود
   * تا «فصلی که در جریانش هستیم» دقیقاً هایلایت شود. */
  const currentTocIndex = useMemo(() => {
    if (!currentHref || toc.length === 0) return -1;
    const direct = toc.findIndex((t) => sameHref(currentHref, t.href));
    if (direct >= 0) return direct;
    const book = bookRef.current;
    if (!book) return -1;
    const cur = spineIndexOfHref(book, currentHref);
    if (cur < 0) return -1;
    let best = -1;
    let bestSpine = Infinity;
    for (let i = 0; i < toc.length; i++) {
      const si = spineIndexOfHref(book, toc[i].href);
      if (si >= cur && si < bestSpine) {
        bestSpine = si;
        best = i;
      }
    }
    return best;
    // bookRef رفرنس است؛ status برای محاسبه پس از بارگذاری کتاب
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toc, currentHref, status]);

  /** نشان «فصل X از Y» در نوار پایین — بر اساس جایگاه فصل جاری در فهرست مطالب */
  const chapterChip = useMemo(() => {
    if (currentTocIndex < 0 || toc.length < 2) return null;
    return `فصل ${faDigits(currentTocIndex + 1)} از ${faDigits(toc.length)}`;
  }, [currentTocIndex, toc.length]);

  /** فهرست فصل‌ها با شماره اصلی + فیلتر جست‌وجوی فارسی */
  const tocIndexed = useMemo(() => toc.map((t, i) => ({ ...t, num: i + 1 })), [toc]);
  const filteredToc = useMemo(() => {
    const q = chFilter.trim();
    if (!q) return tocIndexed;
    return tocIndexed.filter((t) => faIncludes(t.title, q));
  }, [tocIndexed, chFilter]);

  /** اسکرول خودکار پاپ‌آپ فهرست فصل‌ها به فصل جاری */
  useEffect(() => {
    if (panel !== 'chapters') return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const raf = requestAnimationFrame(() => {
      currentTocRef.current?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    });
    return () => cancelAnimationFrame(raf);
    // فقط هنگام باز شدن پاپ‌آپ؛ تغییر فیلتر باعث پرش ناخواسته نمی‌شود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel]);

  const shellVars = {
    '--reader-bg': pal.bg,
    '--reader-chrome': pal.chrome,
    '--reader-fg': pal.fg,
    '--reader-muted': pal.muted,
    '--reader-border': pal.border,
    ...(settings.bgImageUrl
      ? {
          backgroundImage: `url(${settings.bgImageUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }
      : {}),
  } as React.CSSProperties;

  return (
    <div className={`reader-shell theme-${settings.theme}`} style={shellVars} ref={shellRef} dir="rtl">
      {/* نوار بالایی */}
      {chromeVisible && (
        <div className="reader-toolbar">
          <button type="button" className="tbtn" onClick={onExit} aria-label="بازگشت به صفحه کتاب" title="بازگشت">
            <ArrowRight size={19} />
          </button>
          <span className="title" title={novel.titleFa ?? novel.titleOriginal ?? novel.id}>
            {novel.titleFa ?? novel.titleOriginal ?? novel.id}
          </span>
          <span className="chapter">{currentChapter || volume.title}</span>
          <div className="spacer" />
          <button type="button" className="tbtn" onClick={openChapters} aria-label="فهرست فصل‌ها" title="فهرست فصل‌ها (T)">
            <List size={19} />
          </button>
          <button
            type="button"
            className={`tbtn ${isBookmarked ? 'active-bookmark' : ''}`}
            onClick={() => void handleAddBookmark()}
            aria-label="افزودن نشانک"
            title="افزودن نشانک (B)"
          >
            {isBookmarked ? <Check size={19} /> : <BookmarkPlus size={19} />}
          </button>
          <button type="button" className="tbtn" onClick={() => setPanel((p) => (p === 'bookmarks' ? 'none' : 'bookmarks'))} aria-label="نشانک‌ها" title="نشانک‌ها (M)">
            <BookmarkIcon size={19} />
          </button>
          <button type="button" className="tbtn" onClick={() => setPanel((p) => (p === 'settings' ? 'none' : 'settings'))} aria-label="تنظیمات نمایش" title="تنظیمات (S)">
            <Settings2 size={19} />
          </button>
          <button type="button" className="tbtn btn-fs" onClick={() => void toggleFullscreen()} aria-label="تمام‌صفحه" title="تمام‌صفحه (F)">
            {isFullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>
        </div>
      )}

      {/* نوار پیشرفت */}
      {chromeVisible && (
        <div className="reader-progressbar" aria-hidden="true">
          <div className="fill" style={{ width: `${percentage * 100}%` }} />
        </div>
      )}

      {/* بدنه کتاب */}
      <div className="reader-body" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div
          ref={scrollContainerRef}
          className={`reader-container ${isScrolled ? 'scrolled' : ''}`}
          style={isScrolled ? { paddingBlock: '1rem' } : undefined}
          onClick={onContainerTap}
          /* A11Y-004 — ناحیه اسکرول باید با صفحه‌کلید قابل فوکوس باشد (axe: scrollable-region-focusable) */
          tabIndex={isScrolled ? 0 : undefined}
          role={isScrolled ? 'region' : undefined}
          aria-label={isScrolled ? 'محتوای کتاب' : undefined}
        >
          <div
            ref={hostRef}
            className="rendition-host"
            style={isScrolled ? { width: '100%' } : { height: '100%', width: '100%' }}
          />
        </div>

        {/* نواحی لمسی — فقط حالت صفحه‌بندی‌شده */}
        {/* منطق فیزیکی کتاب: جهت خواندن به سمت inline-end است؛
            بنابراین لبه inline-end = بعدی، لبه inline-start = قبلی */}
        {settings.readingMode === 'paginated' && status === 'ready' && (
          <>
            <button
              type="button"
              className="tap-zone start"
              aria-label="قبلی"
              onClick={goPrev}
            />
            <button
              type="button"
              className="tap-zone end"
              aria-label="بعدی"
              onClick={goNext}
            />
          </>
        )}

        {/* حالت‌های بارگذاری/خطا */}
        {(status === 'loading' || status === 'rendering') && (
          <div className="reader-load">
            <div className="inner">
              <InlineSpinner size={30} />
              <strong>{status === 'loading' ? 'در حال دریافت کتاب…' : 'در حال آماده‌سازی صفحه…'}</strong>
              {status === 'loading' && download && (
                <span style={{ color: 'var(--reader-muted)', fontSize: '0.85rem' }}>
                  {formatBytes(download.loaded)}
                  {download.total ? ` از ${formatBytes(download.total)}` : ''}
                </span>
              )}
              <span style={{ color: 'var(--reader-muted)', fontSize: '0.8rem' }}>{volume.title}</span>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="reader-load">
            <div className="inner">
              <BookOpen size={34} aria-hidden="true" style={{ color: 'var(--reader-muted)' }} />
              <strong>بازکردن کتاب ناموفق بود</strong>
              <p style={{ color: 'var(--reader-muted)', fontSize: '0.9rem', margin: 0 }}>
                {errorMsg || 'فایل EPUB قابل خواندن نیست.'}
                <br />
                اگر فایل دارای DRM یا رمزگذاری ناسازگار است، در مرورگر پشتیبانی نمی‌شود. اتصال اینترنت را بررسی کنید و
                دوباره تلاش کنید.
              </p>
              <div className="reader-error-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => window.location.reload()}
                >
                  <RotateCcw size={15} /> تلاش مجدد
                </button>
                <button type="button" className="btn" onClick={onExit}>
                  بازگشت به کتاب
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* نشانگر اسکرول خودکار */}
      {status === 'ready' && settings.autoScroll && isScrolled && (
        <div className={`autoscroll-pill ${chromeVisible ? 'with-chrome' : ''}`}>
          <button
            type="button"
            className="pill-btn"
            onClick={() => setAutoPaused((p) => !p)}
            aria-label={autoPaused ? 'ادامه اسکرول خودکار' : 'توقف موقت اسکرول خودکار'}
          >
            {autoPaused ? <Play size={14} /> : <Pause size={14} />}
            <span>{autoPaused ? 'ادامه' : 'توقف'}</span>
          </button>
          <button
            type="button"
            className="pill-btn stop"
            onClick={() => onSettingsChange({ ...settings, autoScroll: false })}
            aria-label="خاموش‌کردن اسکرول خودکار"
          >
            <XCircle size={14} />
          </button>
        </div>
      )}

      {/* نوار وضعیت و پرش — مختص فصل جاری (نه کل جلد)، طبق درخواست کاربر */}
      {chromeVisible && (
        <div className="reader-statusbar">
          {/* بر اساس درخواست کاربر: فلش راست‌نما = بعدی، فلش چپ‌نما = قبلی */}
          <button type="button" className="tbtn" onClick={goNext} aria-label="صفحه بعدی" title="صفحه بعدی">
            <ChevronLeft size={20} style={{ transform: 'scaleX(-1)' }} />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((scrubPct ?? chapterPct) * 1000)}
            aria-label="پرش درون فصل جاری"
            title="پرش درون فصل جاری"
            onChange={(e) => onChapterSliderInput(Number(e.target.value))}
          />
          {chapterChip && <span className="chap-chip">{chapterChip}</span>}
          <span className="pct" title="پیشرفت فصل جاری">
            {faDigits(Math.round((scrubPct ?? chapterPct) * 100)) + '٪'}
          </span>
          <button type="button" className="tbtn" onClick={goPrev} aria-label="صفحه قبلی" title="صفحه قبلی">
            <ChevronLeft size={20} />
          </button>
        </div>
      )}

      {/* راهنمای یک‌باره لمس وسط صفحه — غیرتعاملی و بدون مزاحمت برای لمس‌ها */}
      {status === 'ready' && tapHint && !chromeVisible && (
        <div className="tap-hint" role="status">
          برای نمایش یا مخفی‌کردن کنترل‌ها، وسط صفحه را لمس کنید؛ برای بزرگ‌نمایی تصویر، روی آن دوبار بزنید
        </div>
      )}

      {/* UX-004 — هشدار خروج دو مرحله‌ای با Escape */}
      {exitArmed && (
        <div className="exit-arm-hint" role="status">
          <CornerDownRight size={14} aria-hidden="true" />
          برای خروج از کتاب، دوباره Escape بزنید
        </div>
      )}

      {/* ---------- پاپ‌آپ فهرست فصل‌ها (پنجره وسط صفحه، مناسب موبایل و دسکتاپ) ---------- */}
      {panel === 'chapters' && (
        <div
          className="chapter-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPanel('none');
          }}
        >
          <div className="chapter-popup" role="dialog" aria-modal="true" aria-label="فهرست فصل‌ها">
            <header>
              <List size={17} />
              <div className="cp-titles">
                <strong>فهرست فصل‌ها</strong>
                <span>{volume.title}</span>
              </div>
              <button type="button" className="tbtn panel-close" onClick={() => setPanel('none')} aria-label="بستن">
                <X size={18} />
              </button>
            </header>
            {toc.length > 0 && (
              <div className="cp-search">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  placeholder="جست‌وجوی عنوان فصل…"
                  aria-label="جست‌وجوی فصل"
                  value={chFilter}
                  onChange={(e) => setChFilter(e.target.value)}
                />
              </div>
            )}
            <div className="cp-list">
              {toc.length === 0 && (
                <p className="cp-empty">فهرست فصلی برای این جلد در دسترس نیست.</p>
              )}
              {toc.length > 0 && filteredToc.length === 0 && (
                <p className="cp-empty">فصلی با این عنوان پیدا نشد.</p>
              )}
              {/* UX-003 — در فهرست‌های بلند (۲۱۲ فصلی)، دکمه چسبان «پرش به فصل جاری» */}
              {toc.length >= 15 && filteredToc.length > 0 && currentTocIndex >= 0 && (
                <button
                  type="button"
                  className="cp-jump"
                  onClick={() => {
                    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    currentTocRef.current?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
                  }}
                >
                  <LocateFixed size={15} aria-hidden="true" />
                  پرش به فصل جاری
                  <CornerDownRight size={13} aria-hidden="true" style={{ opacity: 0.7 }} />
                </button>
              )}
              {filteredToc.map((item, listIdx) => {
                const current = item.num - 1 === currentTocIndex;
                /* UX-003 — سرگروه‌های ده‌تایی برای فهرست‌های بلند (وقتی فیلتر فعال نیست) */
                const showDecade = toc.length > 30 && !chFilter.trim() && listIdx > 0 && (item.num - 1) % 10 === 0;
                return (
                  <Fragment key={`${item.href}-${item.num}`}>
                    {showDecade && (
                      <div className="cp-decade" aria-hidden="true">
                        {faDigits(item.num - 1)} تا {faDigits(Math.min(item.num + 8, toc.length))}
                      </div>
                    )}
                    <div
                      ref={current ? currentTocRef : undefined}
                      className={`toc-item ${current ? 'current' : ''}`}
                      style={{ paddingInlineStart: `${0.7 + item.depth * 0.9}rem` }}
                      onClick={() => void jumpTo(item.href)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && void jumpTo(item.href)}
                    >
                      <span className="idx">{faDigits(item.num)}</span>
                      <span className="t">{item.title}</span>
                      {current && <span className="now">در حال مطالعه</span>}
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ---------- پنل نشانک‌ها ---------- */}
      {panel === 'bookmarks' && (
        <aside className="reader-panel" aria-label="نشانک‌ها">
          <h3>
            <BookmarkIcon size={17} /> نشانک‌های این جلد
            <button type="button" className="tbtn panel-close" onClick={() => setPanel('none')} aria-label="بستن">
              <X size={18} />
            </button>
          </h3>
          <div className="panel-content">
            <button
              type="button"
              className="btn primary block"
              style={{ marginBottom: '0.8rem' }}
              onClick={() => void handleAddBookmark()}
            >
              <BookmarkPlus size={15} /> نشانک در محل فعلی
            </button>
            {bookmarks.length === 0 && (
              <p style={{ color: 'var(--reader-muted)', fontSize: '0.85rem', padding: '0 0.5rem' }}>
                هنوز نشانکی ندارید. با کلید B یا دکمه بالا، محل فعلی را ذخیره کنید.
              </p>
            )}
            {bookmarks.map((b) => (
              <div key={b.id} className="bookmark-item">
                <div className="bi-label" onClick={() => void jumpTo(b.cfi)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && void jumpTo(b.cfi)}>
                  <div className="l">{b.label}</div>
                  <div className="d">{new Date(b.createdAt).toLocaleDateString('fa-IR')} · {new Date(b.createdAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <button type="button" className="del" aria-label="حذف نشانک" onClick={() => onDeleteBookmark(b.id)}>
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* ---------- پنل تنظیمات (بازطراحی کامل) ---------- */}
      {panel === 'settings' && (
        <aside className="reader-panel wide" aria-label="تنظیمات نمایش">
          <h3>
            <Settings2 size={17} /> تنظیمات نمایش
            <button type="button" className="tbtn panel-close" onClick={() => setPanel('none')} aria-label="بستن">
              <X size={18} />
            </button>
          </h3>
          <div className="panel-content">
            <ReaderSettingsPanel
              settings={settings}
              onSettingsChange={onSettingsChange}
              customFonts={customFonts}
              onAddCustomFont={onAddCustomFont}
              onDeleteCustomFont={onDeleteCustomFont}
              isScrolled={isScrolled}
              onReset={() => {
                onSettingsChange({
                  ...settings,
                  theme: 'dark',
                  fontSize: 100,
                  lineHeight: 1.8,
                  paragraphSpacing: 0.8,
                  wordSpacing: 0,
                  fontFamily: 'vazirmatn',
                  customFontId: null,
                  maxWidth: 42,
                  pageMargin: 24,
                  textAlign: 'justify',
                  direction: 'auto', // UX-001 — هم‌تراز با پیش‌فرض جدید
                  readingMode: 'scrolled',
                  textColor: null,
                  bgColor: null,
                  bgImageUrl: null,
                  bgImageOpacity: 0.35,
                  autoScroll: false,
                  autoScrollSpeed: 40,
                });
                setPanel('none');
              }}
            />
          </div>
        </aside>
      )}

      {/* ---------- بزرگ‌نمایی تصویر ---------- */}
      {lightbox && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 6, 8, 0.92)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 90,
            padding: '1.5rem',
            cursor: 'zoom-out',
          }}
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label="نمایش تصویر در اندازه کامل"
        >
          <img
            src={lightbox}
            alt=""
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
          />
          <button
            type="button"
            className="tbtn"
            style={{ position: 'fixed', top: 12, insetInlineEnd: 12, color: '#fff' }}
            aria-label="بستن تصویر"
            onClick={() => setLightbox(null)}
          >
            <X size={22} />
          </button>
        </div>
      )}
    </div>
  );
}
