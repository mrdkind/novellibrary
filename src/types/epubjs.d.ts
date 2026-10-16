/** تعاریف نوع برای epub.js (حداقل سطح API مورد استفاده در پروژه) */
declare module 'epubjs' {
  export interface EpubOptions {
    openAs?: 'epub' | 'pdf';
    encoding?: string;
    replacements?: 'none' | 'base64' | 'blobUrl';
    canonical?: string | ((path: string) => string);
  }

  export interface TocItem {
    id?: string;
    href: string;
    label?: string;
    title?: string;
    subitems?: TocItem[];
    parent?: TocItem;
  }

  export interface Location {
    start: { index?: number; href?: string; cfi?: string; page?: number; percentage?: number; displayed?: { page: number; total: number } };
    end: Record<string, unknown>;
    at?: unknown;
  }

  export interface RenderOptions {
    width?: number | string;
    height?: number | string;
    flow?: 'paginated' | 'scrolled' | 'scrolled-doc' | 'scrolled-continuous';
    manager?: 'default' | 'continuous';
    spread?: string | number;
    direction?: 'ltr' | 'rtl';
    /** جهت پیش‌فرض — epub.js در کانستراکتور از این گزینه استفاده می‌کند (نه direction) */
    defaultDirection?: 'ltr' | 'rtl';
    allowScriptedContent?: boolean;
    snap?: boolean | Record<string, unknown>;
    minSpreadWidth?: number;
    stylesheet?: string;
    /** READER-005 — کلاسی که هنگام تولید/حل CFI نادیده گرفته می‌شود */
    ignoreClass?: string;
  }

  export interface Themes {
    register(name: string, css: string): void;
    registerCss(name: string, css: string): void;
    select(name: string): void;
    fontSize(size: string): void;
    override(selector: string, css: string | Record<string, string>, priority?: boolean): void;
  }

  export interface Contents {
    document: Document;
    window: Window;
    /** اندیس spine فصل جاری (برای حل مسیر منابع داخل بسته) */
    sectionIndex: number;
    on(type: string, handler: (event: unknown) => void): void;
  }

  /** READER-002 — دسترسی به تولید blob URL منابع داخل بسته EPUB */
  export interface BookResources {
    createUrl(url: string): Promise<string>;
    replacements(): Promise<string[]>;
  }

  /** ۱٫۶٫۰ — فصل اسپاین برای جست‌وجوی درون‌کتابی (باز/بستن سند و ساخت CFI) */
  export interface SpineSection {
    href: string;
    index: number;
    cfiBase?: string;
    document?: Document;
    load(request?: unknown): Promise<unknown>;
    unload(): void;
    cfiFromRange(range: Range): string;
    cfiFromElement(el: Element): string;
  }

  /** ابزار CFI epub.js — برای حل دقیق CFI به عنصر DOM (بیمهٔ فرود اسکرول) */
  export class EpubCFI {
    constructor(cfiFrom?: string | Range | Node, base?: string | Record<string, unknown>, ignoreClass?: string);
    toRange(doc?: Document, ignoreClass?: string): Range;
    toString(): string;
  }

  export class Book {
    loaded: Record<string, Promise<unknown>>;
    spine: {
      get(target?: string | number): SpineSection | undefined;
      items: Array<{ href: string }>;
      /** ۱٫۶٫۰ — اشیاء کامل Section (برای جست‌وجوی درون‌کتابی) */
      spineItems?: SpineSection[];
    };
    locations: {
      generate(chars?: number): Promise<number>;
      cfiFromPercentage(percentage: number): string | null;
      cfiFromLocation(loc: number): string | null;
      percentageFromCfi(cfi: string): number | null;
      total: number;
    };
    metadata: Record<string, string>;
    /** منابع بسته (برای بازنویسی مسیر تصاویر) */
    resources: BookResources;
    /** ۱٫۶٫۰ — خواندن یک منبع داخلی (برای بارگذاری فصل‌ها در جست‌وجوی درون‌کتابی) */
    load(path: string): Promise<unknown>;
    /** مسیر فایل OPF داخل بسته — پوشه‌اش مبنای مسیرهای manifest است */
    path?: { directory?: string; path?: string };
    canRender?: boolean;
    constructor(urlOrData?: string | ArrayBuffer, options?: EpubOptions);
    open(input: string | ArrayBuffer, what?: string): Promise<void>;
    renderTo(element: string | HTMLElement, options: RenderOptions): Rendition;
    ready: Promise<void>;
    destroy(): void;
  }

  export class Rendition {
    themes: Themes;
    /** ۱٫۶٫۰ — یادداشت‌ها برای هایلایت نتیجه جست‌وجو */
    annotations: {
      add(
        type: string,
        cfiRange: string,
        data?: unknown,
        cb?: unknown,
        className?: string,
        styles?: Record<string, string>,
      ): unknown;
      highlight(
        cfiRange: string,
        data?: unknown,
        cb?: unknown,
        className?: string,
        styles?: Record<string, string>,
      ): unknown;
      remove(cfiRange: string, type: string): void;
    };
    constructor(book: Book, options: RenderOptions);
    display(target?: string): Promise<unknown>;
    prev(): Promise<unknown>;
    next(): Promise<unknown>;
    currentLocation(): Location | null;
    direction(dir: 'ltr' | 'rtl'): void;
    on(type: string, handler: (...args: unknown[]) => void): void;
    off(type: string, handler?: (...args: unknown[]) => void): void;
    clear(): void;
    destroy(): void;
    hooks: {
      content: { register(fn: (contents: Contents, view: unknown) => void): void };
    };
  }

  export function ePub(urlOrData?: string | ArrayBuffer, options?: EpubOptions): Book;
  export default ePub;
}
