import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import type { Book } from 'epubjs';
import { normWithMap, searchInBook } from '../src/reader/bookSearch';
import { normalizeFa } from '../src/services/normalize';

/* ---------- نرمال‌سازی با نگاشت آفست ---------- */

describe('normWithMap — نرمال‌سازی هم‌رفتار با normalizeFa', () => {
  const samples = [
    'علي در خانه بود',
    'مي\u200cرود به بازار',
    'كتابِ ۱۲۳',
    'Hello, World!',
    '  فاصله‌های   اضافه  ',
    'عبارت (پرانتزی) «گفت»',
  ];

  it('خروجی نرمال با normalizeFa یکسان است', () => {
    for (const s of samples) {
      expect(normWithMap(s).norm).toBe(normalizeFa(s));
    }
  });

  it('نگاشت آفست به متن خام برمی‌گردد', () => {
    const src = 'مي\u200cرود';
    const nt = normWithMap(src);
    // «ي» عربی → «ی»، نیم‌فاصله → فاصله
    expect(nt.norm).toBe('می رود');
    // بازسازی متن خام از روی نقشه باید همان بازه اصلی را بدهد
    const slice = (from: number, to: number) => {
      let start = nt.map[from];
      let end = nt.map[to] + nt.len[to];
      return src.slice(start, end);
    };
    // نویسه نرمال اول «م» = نویسه خام اول
    expect(slice(0, 0)).toBe('م');
    // ی نرمال‌شده (اندیس ۱) به «ي» عربی خام اشاره می‌کند
    expect(slice(1, 1)).toBe('ي');
    // فاصله نرمال (اندیس ۲) به نیم‌فاصله خام اشاره می‌کند
    expect(slice(2, 2)).toBe('\u200c');
  });

  it('اعراب حذف و آفست‌ها حفظ می‌شوند', () => {
    const src = 'خُانِه'; // با اعراب
    const nt = normWithMap(src);
    expect(nt.norm).toBe('خانه');
    expect(src.slice(nt.map[0], nt.map[3] + nt.len[3])).toBe(src); // کل بازه
  });
});

/* ---------- جست‌وجوی درون‌کتابی با کتاب ساختگی ---------- */

interface FakeSection {
  href: string;
  index: number;
  html: string;
}

/** کتاب ساختگی با API مورد استفاده searchInBook: spineItems + load/unload/cfiFromRange */
function makeBook(sections: FakeSection[]): Book {
  const doms = sections.map((s) => new JSDOM(s.html).window.document);
  const items = sections.map((s, i) => {
    // هم‌رفتار با epub.js: بارگذاری، سند را روی خودِ Section می‌گذارد
    const item = {
      href: s.href,
      index: i,
      unload: () => {
        item.document = undefined;
      },
      document: undefined as Document | undefined,
      cfiFromRange: (range: Range) => `epubcfi(fake/${i}!,${range.startOffset},${range.endOffset})`,
      load: async () => {
        item.document = doms[i];
        return doms[i];
      },
    };
    return item;
  });
  return {
    spine: {
      spineItems: items,
      items: sections.map((s) => ({ href: s.href })),
    },
    load: async () => undefined,
  } as unknown as Book;
}

describe('searchInBook — جست‌وجوی متن داخل کتاب', () => {
  const book = makeBook([
    {
      href: 'text/ch1.xhtml',
      html: '<html><body><p>علي در خانه بود و کتاب مي\u200cخواند.</p><p>سپس به بازار رفت.</p></body></html>',
    },
    {
      href: 'text/ch2.xhtml',
      html: '<html><body><p>بازار شلوغ بود؛ علي چيزي خريد.</p></body></html>',
    },
  ]);

  it('تطبیق با نرمال‌سازی فارسی (ي/ی عربی، نیم‌فاصله)', async () => {
    const hits = await searchInBook(book, 'می\u200cخواند');
    expect(hits).toHaveLength(1);
    expect(hits[0].href).toBe('text/ch1.xhtml');
    // گزیده شامل متن خام یافته است
    const shown = hits[0].excerpt.slice(hits[0].matchStart, hits[0].matchStart + hits[0].matchLen);
    expect(shown).toBe('مي\u200cخواند');
  });

  it('همه وقوع‌ها در همه فصل‌ها با CFI', async () => {
    const hits = await searchInBook(book, 'علی');
    expect(hits).toHaveLength(2);
    expect(hits[0].spineIndex).toBe(0);
    expect(hits[1].spineIndex).toBe(1);
    for (const h of hits) {
      expect(h.cfi).toMatch(/^epubcfi\(fake\//);
    }
    // پیدای خام برای «علي» با ي عربی
    const shown = hits[0].excerpt.slice(hits[0].matchStart, hits[0].matchStart + hits[0].matchLen);
    expect(shown).toBe('علي');
  });

  it('عبارت کوتاه (کمتر از دو نویسه نرمال‌شده) نتیجه نمی‌دهد', async () => {
    expect(await searchInBook(book, 'ا')).toEqual([]);
    expect(await searchInBook(book, ' ')).toEqual([]);
  });

  it('سقف نتایج و سقف هر فصل رعایت می‌شود', async () => {
    const html = `<html><body>${'<p>واژه تکرار تکرار</p>'.repeat(30)}</body></html>`;
    const repBook = makeBook([{ href: 'a.xhtml', html }]);
    // «تکرار» در هر پاراگراف یک بار؟ دو بار؛ با سقف ۱۰ برای فصل باید بایستد
    const hits = await searchInBook(repBook, 'تکرار', { maxPerSection: 10 });
    expect(hits.length).toBe(10);
  });

  it('لغو جست‌وجو با AbortSignal', async () => {
    const ac = new AbortController();
    ac.abort();
    const hits = await searchInBook(book, 'علی', { signal: ac.signal });
    expect(hits).toEqual([]);
  });

  it('فصل بدون بدنه یا خطای بارگذاری مانع بقیه نمی‌شود', async () => {
    const broken = {
      href: 'x.xhtml',
      index: 0,
      load: async () => {
        throw new Error('boom');
      },
      unload: () => {},
      document: undefined,
      cfiFromRange: () => '',
    };
    const mixed = makeBook([]) as unknown as { spine: { spineItems: unknown[] } };
    mixed.spine.spineItems = [broken, ...(book as unknown as { spine: { spineItems: unknown[] } }).spine.spineItems];
    const hits = await searchInBook(mixed as unknown as Book, 'بازار');
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});
