/**
 * جست‌وجوی متن داخل کتاب (۱٫۶٫۰ — طبق نقشه راه گزارش ممیزی v1.5.1)
 *
 * رویکرد: جست‌وجوی زمان‌اجرا روی اسپاین کتاب بازشده (نه فهرست واژه معکوس Build).
 * چرا؟
 *  - پرش دقیق به محل یافته با CFI (از Range سند فصل) و هایلایت آن ممکن می‌شود؛
 *  - هیچ وزنی به کاتالوگ/سایت اضافه نمی‌شود و کتاب‌های تازه‌افزوده بدون بازسازی
 *    Build بلافاصله قابل جست‌وجو هستند؛
 *  - برای کتاب‌های بزرگ، پیمایش فصل‌به‌فصل با گزارش پیشرفت و امکان لغو همراه است.
 *
 * تطبیق متن با همان نرمال‌سازی جست‌وجوی کاتالوگ انجام می‌شود (services/normalize)
 * اما با نگاشت آفست: هر نویسه نرمال‌شده به بازه‌ای از متن خام اشاره می‌کند تا
 * هایلایت دقیقاً روی نویسه‌های اصلی کتاب قرار گیرد (ي/ی، ك/ک، اعراب، نیم‌فاصله، ارقام).
 *
 * محدودیت (عمدی و استاندارد در کتاب‌خوان‌ها): تطبیق درون هر گره متن است و از مرز
 * تگ‌های درون‌خطی (مثل <b>وا</b>ژه) عبور نمی‌کند.
 */

import type { Book } from 'epubjs';

export interface BookSearchHit {
  /** href فصل در فرم spine */
  href: string;
  spineIndex: number;
  /** متن پیرامون یافته (شامل خود یافته) */
  excerpt: string;
  /** محل شروع یافته در excerpt */
  matchStart: number;
  matchLen: number;
  /** CFI دقیق یافته برای پرش و هایلایت (در صورت شکست ساخت CFI، null) */
  cfi: string | null;
}

export interface SearchProgress {
  done: number;
  total: number;
}

export interface SearchOptions {
  signal?: AbortSignal;
  onProgress?: (p: SearchProgress) => void;
  /** سقف کل نتایج (پیش‌فرض ۲۰۰) */
  maxResults?: number;
  /** سقف نتایج هر فصل (پیش‌فرض ۴۰) */
  maxPerSection?: number;
  /** تعداد نویسه پیرامون در گزیده (پیش‌فرض ۶۰) */
  contextChars?: number;
}

/* ---------------- نرمال‌سازی با نگاشت آفست ---------------- */

const TASHKEEL_RE = /[\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/;
const MARKS_RE = /[\u200c-\u200f\u202a-\u202e\u2066-\u2069]/;
const PUNCT_RE = /[-_/\\.,:;()[\]{}«»"'`!?*+~=|@#$%^&]/;
/** همان نگهدیدگی‌های normalizeFa — بدون «آ» (در normalizeFa هم «آ» دست‌نخورده می‌ماند) */
const AR_CHAR_MAP: Record<string, string> = {
  '\u0623': 'ا',
  '\u0625': 'ا',
  '\u0671': 'ا',
  '\u064a': 'ی',
  '\u0643': 'ک',
  '\u0649': 'ی',
  '\u0629': 'ه',
  '\u0624': 'و',
  '\u0626': 'ی',
};

export interface NormedText {
  norm: string;
  /** map[i] = اندیس شروع در متن خام */
  map: number[];
  /** len[i] = طول نویسه خام مصرف‌شده (جفت‌های UTF-16) */
  len: number[];
}

/**
 * نسخه هم‌رفتار با normalizeFa اما با حفظ آفست.
 * ورودی را نویسه‌به‌نویسه (با احترام به جفت‌های جایگزین) تبدیل می‌کند.
 */
export function normWithMap(input: string): NormedText {
  const src = input ?? '';
  const out: string[] = [];
  const map: number[] = [];
  const len: number[] = [];

  const push = (ch: string, idx: number, rawLen: number) => {
    out.push(ch);
    map.push(idx);
    len.push(rawLen);
  };

  for (let i = 0; i < src.length; ) {
    const code = src.codePointAt(i) as number;
    const size = code > 0xffff ? 2 : 1;
    const ch = String.fromCodePoint(code);
    const li = i;
    i += size;

    if (TASHKEEL_RE.test(ch)) continue; // اعراب/کشیده → حذف
    if (MARKS_RE.test(ch)) {
      push(' ', li, size); // نیم‌فاصله و علامت‌های جهت → فاصله
      continue;
    }
    if (code >= 0x0660 && code <= 0x0669) {
      push(String(code - 0x0660), li, size); // ارقام عربی
      continue;
    }
    if (code >= 0x06f0 && code <= 0x06f9) {
      push(String(code - 0x06f0), li, size); // ارقام فارسی
      continue;
    }
    if (AR_CHAR_MAP[ch] !== undefined) {
      push(AR_CHAR_MAP[ch], li, size);
      continue;
    }
    if (PUNCT_RE.test(ch)) {
      push(' ', li, size);
      continue;
    }
    const lower = ch.toLowerCase();
    // toLowerCase می‌تواند طول را تغییر دهد (مثل «İ»)؛ نخستین نویسه مبنای آفست است
    push(lower.length === 1 ? lower : lower.slice(0, 1), li, size);
  }

  /* فشردن فاصله‌های متوالی → یک فاصله (نگاشت به نخستین نویسه خام) */
  const n2: string[] = [];
  const m2: number[] = [];
  const l2: number[] = [];
  for (let i = 0; i < out.length; i++) {
    const isSpace = out[i] === ' ';
    if (isSpace && n2.length > 0 && n2[n2.length - 1] === ' ') continue;
    n2.push(out[i]);
    m2.push(map[i]);
    l2.push(len[i]);
  }

  /* حذف فاصله ابتدا/انتها (هم‌رفتار با trim در normalizeFa) */
  let start = 0;
  let end = n2.length;
  while (start < end && n2[start] === ' ') start++;
  while (end > start && n2[end - 1] === ' ') end--;

  return { norm: n2.slice(start, end).join(''), map: m2.slice(start, end), len: l2.slice(start, end) };
}

/* ---------------- پیمایش اسپاین ---------------- */

interface SectionLike {
  href: string;
  index: number;
  load(request?: unknown): Promise<unknown>;
  unload(): void;
  document?: Document;
  cfiFromRange?(range: Range): string;
}

/** ثابت‌های NodeFilter به‌صورت عددی — تا ماژول به global مرورگر وابسته نباشد (DOM Spec) */
const SHOW_TEXT = 4; // NodeFilter.SHOW_TEXT
const FILTER_REJECT = 2; // NodeFilter.FILTER_REJECT
const FILTER_ACCEPT = 1; // NodeFilter.FILTER_ACCEPT

/** جمع‌کردن گره‌های متن یک سند (بدون گره‌های خالی/فقط فاصله) */
function collectTextNodes(doc: Document): Text[] {
  const nodes: Text[] = [];
  try {
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, SHOW_TEXT, {
      acceptNode(node) {
        const t = node.nodeValue ?? '';
        if (t.trim().length === 0) return FILTER_REJECT;
        const p = node.parentElement;
        if (p && (p.tagName === 'SCRIPT' || p.tagName === 'STYLE')) return FILTER_REJECT;
        return FILTER_ACCEPT;
      },
    });
    let cur = walker.nextNode();
    while (cur) {
      nodes.push(cur as Text);
      cur = walker.nextNode();
    }
  } catch {
    /* سند ناسازگار — فصل بدون نتیجه رد می‌شود */
  }
  return nodes;
}

/** ساخت گزیده با نویسه‌های پیرامون؛ خروجی شامل خود یافته است */
function buildExcerpt(text: string, start: number, end: number, context: number) {
  const from = Math.max(0, start - context);
  const to = Math.min(text.length, end + context);
  return {
    excerpt: text.slice(from, to),
    matchStart: start - from,
    matchLen: end - start,
    clipped: from > 0 || to < text.length,
  };
}

/**
 * جست‌وجوی یک عبارت در کل کتاب.
 * کوئری با همان قواعد نرمال‌سازی (ي/ی، ك/ک، اعراب، نیم‌فاصله، ارقام، حروف بزرگ) تطبیق می‌یابد.
 * در هر لحظه فقط یک فصل در حافظه است و پس از پیمایش آزاد می‌شود.
 */
export async function searchInBook(
  book: Book,
  query: string,
  opts: SearchOptions = {},
): Promise<BookSearchHit[]> {
  const { signal, onProgress, maxResults = 200, maxPerSection = 40, contextChars = 60 } = opts;
  const q = normWithMap(query);
  if (q.norm.length < 2) return []; // کمینه ۲ نویسه نرمال‌شده

  const sections = (book.spine as unknown as { spineItems?: SectionLike[] }).spineItems ?? [];
  const total = sections.length;
  const hits: BookSearchHit[] = [];

  for (let si = 0; si < sections.length; si++) {
    if (signal?.aborted) return [];
    onProgress?.({ done: si, total });

    const section = sections[si];
    try {
      await section.load(book.load.bind(book));
    } catch {
      continue; // فصلی که بارگذاری نمی‌شود مانع بقیه نیست
    }
    if (signal?.aborted) return [];

    const doc = section.document;
    let sectionHits = 0;
    if (doc && doc.body) {
      const nodes = collectTextNodes(doc);
      for (const node of nodes) {
        if (signal?.aborted) return [];
        if (sectionHits >= maxPerSection || hits.length >= maxResults) break;

        const text = node.nodeValue ?? '';
        if (text.length === 0) continue;
        const nt = normWithMap(text);

        let pos = 0;
        for (;;) {
          const at = nt.norm.indexOf(q.norm, pos);
          if (at < 0) break;
          const last = at + q.norm.length - 1;
          const srcStart = nt.map[at];
          const srcEnd = nt.map[last] + nt.len[last];
          if (srcEnd <= srcStart) {
            pos = at + 1;
            continue;
          }

          let cfi: string | null = null;
          if (typeof section.cfiFromRange === 'function') {
            try {
              const range = doc.createRange();
              range.setStart(node, srcStart);
              range.setEnd(node, srcEnd);
              cfi = section.cfiFromRange(range);
            } catch {
              cfi = null; // ساخت CFI ممکن نشد — پرش با href انجام می‌شود
            }
          }

          const ex = buildExcerpt(text, srcStart, srcEnd, contextChars);
          hits.push({
            href: section.href,
            spineIndex: si,
            excerpt: ex.excerpt,
            matchStart: ex.matchStart,
            matchLen: ex.matchLen,
            cfi,
          });
          sectionHits++;
          pos = at + q.norm.length;
          if (sectionHits >= maxPerSection || hits.length >= maxResults) break;
        }
      }
    }

    try {
      section.unload(); // آزادسازی سند فصل — فقط یک فصل در حافظه می‌ماند
    } catch {
      /* ignore */
    }
  }

  onProgress?.({ done: total, total });
  return hits;
}
