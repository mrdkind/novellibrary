import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpenText,
  LayoutGrid,
  LibraryBig,
  List,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useCatalog } from '@/hooks/useCatalog';
import { usePersonalData } from '@/hooks/usePersonalData';
import { collectGenres, totalChapters } from '@/services/catalog';
import { searchNovels } from '@/services/search';
import type { SearchFilters, SortOption, StatusFilter } from '@/services/search';
import { faDigits } from '@/services/persian';
import { BookGrid } from '@/components/BookCard';
import { BookGridSkeleton, EmptyBox, ErrorBox } from '@/components/StateBoxes';
import { useDocumentTitle } from '@/hooks/misc';

const SORT_LABELS: Record<SortOption, string> = {
  added: 'جدیدترین اضافه‌شده',
  titleAsc: 'عنوان (الفبایی)',
  title: 'عنوان (معکوس)',
};

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'همه',
  ongoing: 'در حال انتشار',
  completed: 'کامل‌شده',
  hiatus: 'متوقف‌شده',
};

const VIEW_STORAGE_KEY = 'ns-lib-view';

export default function LibraryPage() {
  useDocumentTitle('کتابخانه');
  const { novels, status, error, reload } = useCatalog();
  const { progress, favorites } = usePersonalData();
  const [params, setParams] = useSearchParams();

  const [filters, setFilters] = useState<SearchFilters>({
    query: params.get('q') ?? '',
    genre: params.get('genre'),
    status: (params.get('status') as StatusFilter) ?? 'all',
    sort: (params.get('sort') as SortOption) ?? 'added',
  });
  const [view, setView] = useState<'grid' | 'list'>(
    () => (localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'),
  );

  // همگام‌سازی از URL (مثلاً جست‌وجوی سریع سربرگ)
  useEffect(() => {
    setFilters((f) => ({
      ...f,
      query: params.get('q') ?? '',
      genre: params.get('genre') ?? null,
      status: (params.get('status') as StatusFilter) ?? 'all',
      sort: (params.get('sort') as SortOption) ?? f.sort,
    }));
  }, [params]);

  const update = (patch: Partial<SearchFilters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    const sp = new URLSearchParams();
    if (next.query.trim()) sp.set('q', next.query.trim());
    if (next.genre) sp.set('genre', next.genre);
    if (next.status !== 'all') sp.set('status', next.status);
    if (next.sort !== 'added') sp.set('sort', next.sort);
    setParams(sp, { replace: true });
  };

  const switchView = (v: 'grid' | 'list') => {
    setView(v);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* حافظه در دسترس نیست — بی‌اهمیت */
    }
  };

  const results = useMemo(() => searchNovels(novels, filters), [novels, filters]);
  const genres = useMemo(() => collectGenres(novels), [novels]);
  const hasActiveFilters = Boolean(filters.query.trim() || filters.genre || filters.status !== 'all');

  // شمارنده وضعیت‌ها برای سگمنت‌ها
  const statusCounts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: novels.length, ongoing: 0, completed: 0, hiatus: 0 };
    for (const n of novels) c[n.status] += 1;
    return c;
  }, [novels]);

  const totals = useMemo(
    () => ({
      volumes: novels.reduce((s, n) => s + n.volumes.length, 0),
      chapters: novels.reduce((s, n) => s + totalChapters(n), 0),
    }),
    [novels],
  );

  // لبه‌های نوار ژانر برای محوشدگی
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripEdges, setStripEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setStripEdges({ start: el.scrollLeft < -4, end: el.scrollLeft > -max - 4 && max > 4 });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [genres.length]);

  if (status === 'loading') return <BookGridSkeleton count={10} view={view} />;
  if (status === 'error') {
    return (
      <ErrorBox
        kind="network"
        title="کتابخانه در دسترس نیست"
        message={error ?? 'خطای نامشخص در دریافت فهرست کتاب‌ها.'}
        onRetry={reload}
      />
    );
  }

  return (
    <div>
      {/* مست‌هد کتابخانه: عنوان + آمار زنده */}
      <section className="lib-mast" aria-label="کتابخانه">
        <h1>
          <LibraryBig size={24} aria-hidden="true" />
          کتابخانه
        </h1>
        <p className="lib-sub">
          آرشیو ناول‌های ترجمه‌شده؛ جست‌وجو کنید، فیلتر بزنید و کتاب بعدی‌تان را انتخاب کنید.
        </p>
        <div className="lib-stats">
          <div className="lib-stat">
            <b>{faDigits(novels.length)}</b>
            <span>ناول</span>
          </div>
          <div className="lib-stat">
            <b>{faDigits(totals.volumes)}</b>
            <span>جلد</span>
          </div>
          <div className="lib-stat">
            <b>{faDigits(totals.chapters)}</b>
            <span>فصل</span>
          </div>
        </div>
      </section>

      {/* جست‌وجوی بزرگ */}
      <div className="lib-toolbar" role="search">
        <div className="lib-search">
          <span className="lib-search-ico" aria-hidden="true">
            <Search size={18} />
          </span>
          <input
            className="input"
            type="search"
            placeholder="جست‌وجو در عنوان، نویسنده و مترجم…"
            aria-label="جست‌وجوی کتاب‌ها"
            value={filters.query}
            onChange={(e) => update({ query: e.target.value })}
          />
          {filters.query && (
            <button
              type="button"
              className="icon-btn clear-btn"
              style={{ width: 34, height: 34 }}
              aria-label="پاک‌کردن جست‌وجو"
              onClick={() => update({ query: '' })}
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="lib-controls">
          <div className="seg-bar" role="group" aria-label="فیلتر وضعیت انتشار">
            {(Object.keys(STATUS_FILTER_LABELS) as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`seg-item ${filters.status === s ? 'on' : ''}`}
                aria-pressed={filters.status === s}
                onClick={() => update({ status: s })}
              >
                {STATUS_FILTER_LABELS[s]}
                <span className="seg-n">{faDigits(statusCounts[s])}</span>
              </button>
            ))}
          </div>

          <div className="lib-sort">
            <select
              className="select"
              value={filters.sort}
              aria-label="مرتب‌سازی"
              onChange={(e) => update({ sort: e.target.value as SortOption })}
            >
              {(Object.keys(SORT_LABELS) as SortOption[]).map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="lib-view" role="group" aria-label="نمایش نتایج">
            <button
              type="button"
              className={view === 'grid' ? 'on' : ''}
              aria-pressed={view === 'grid'}
              aria-label="نمایش شبکه‌ای"
              title="نمایش شبکه‌ای"
              onClick={() => switchView('grid')}
            >
              <LayoutGrid size={17} />
            </button>
            <button
              type="button"
              className={view === 'list' ? 'on' : ''}
              aria-pressed={view === 'list'}
              aria-label="نمایش فهرستی"
              title="نمایش فهرستی"
              onClick={() => switchView('list')}
            >
              <List size={17} />
            </button>
          </div>

          <span className="lib-count">
            <SlidersHorizontal size={14} aria-hidden="true" />
            {faDigits(results.length)} نتیجه
          </span>
        </div>
      </div>

      {/* نوار ژانرها — افقی، فقط خودش اسکرول می‌شود */}
      {genres.length > 0 && (
        <div className={`genre-strip ${stripEdges.start ? 'has-start' : ''} ${stripEdges.end ? 'has-end' : ''}`}>
          <div className="chip-row strip" ref={stripRef} aria-label="فیلتر ژانر">
            <button type="button" className={`chip clickable ${!filters.genre ? 'active' : ''}`} onClick={() => update({ genre: null })}>
              همه ژانرها
            </button>
            {genres.map((g) => (
              <button
                key={g.name}
                type="button"
                className={`chip clickable ${filters.genre === g.name ? 'active' : ''}`}
                onClick={() => update({ genre: filters.genre === g.name ? null : g.name })}
              >
                {g.name}
                <span className="genre-count">{faDigits(g.count)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {results.length === 0 ? (
        novels.length === 0 ? (
          <EmptyBox
            icon={<BookOpenText size={30} />}
            title="کتابخانه خالی است"
            message="هنوز کتابی به مخزن اضافه نشده است. با افزودن یک پوشه کتاب در novels/ و ثبت تغییرات، کتاب به‌صورت خودکار منتشر می‌شود."
          />
        ) : hasActiveFilters ? (
          <EmptyBox
            title="نتیجه‌ای پیدا نشد"
            message="هیچ کتابی با این جست‌وجو یا فیلترها وجود ندارد. عبارت دیگری را امتحان کنید یا فیلترها را پاک کنید."
            action={
              <button
                type="button"
                className="btn"
                onClick={() => update({ query: '', genre: null, status: 'all' })}
              >
                پاک‌کردن فیلترها
              </button>
            }
          />
        ) : null
      ) : (
        <BookGrid novels={results} progressMap={progress} favorites={favorites} view={view} />
      )}
    </div>
  );
}
