import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  ChevronLeft,
  Clock3,
  Compass,
  Heart,
  LibraryBig,
  Play,
  Sparkles,
  Tags,
  Trophy,
  X,
} from 'lucide-react';
import { useCatalog } from '@/hooks/useCatalog';
import { usePersonalData } from '@/hooks/usePersonalData';
import { collectGenres, displayTitle } from '@/services/catalog';
import { faPercent } from '@/services/persian';
import { BookCard } from '@/components/BookCard';
import { BookGridSkeleton, EmptyBox, ErrorBox } from '@/components/StateBoxes';
import { CoverImage } from '@/components/CoverImage';
import { useDocumentTitle } from '@/hooks/misc';
import { SITE_NAME, SITE_TAGLINE } from '@/config';
import type { Novel } from '@/types';

/** سقف آیتم‌های هر ردیف صفحه اصلی — بیشتر از این، دکمه «بیشتر» نمایش داده می‌شود */
const ROW_LIMIT = 10;

/**
 * ردیف افقی قابل کشیدن — فقط همین بخش اسکرول می‌شود، نه کل صفحه.
 * موبایل: اسکرول لمسی بومی + snap | دسکتاپ: درگ با موس.
 * با کلید جهت‌نما هم قابل حرکت است (دسترس‌پذیری).
 */
function HRow({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let down: { x: number; left: number } | null = null;
    let moved = false;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = { x: e.clientX, left: el.scrollLeft };
      moved = false;
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        el.classList.add('dragging');
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (moved) {
        el.scrollLeft = down.left - dx;
        e.preventDefault();
      }
    };
    const onUp = () => {
      down = null;
      el.classList.remove('dragging');
    };
    // پس از درگ، کلیکِ رها‌شدن روی کارت‌ها نباید لینک را باز کند
    const onClickCapture = (e: MouseEvent) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        moved = false;
      }
    };
    // دراگ بومی لینک/تصویر کارت‌ها رقابت دراگ اسکرول را خراب می‌کند (pointercancel) → خنثی
    const onDragStart = (e: Event) => {
      e.preventDefault();
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('pointerleave', onUp);
    el.addEventListener('click', onClickCapture, true);
    el.addEventListener('dragstart', onDragStart);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('pointerleave', onUp);
      el.removeEventListener('click', onClickCapture, true);
      el.removeEventListener('dragstart', onDragStart);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="hscroll"
      role="region"
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        const el = ref.current;
        if (!el) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          /* F-03 — جهت بصری: فلش باید نوار را به همان سمتی ببرد که فلش نشان می‌دهد
           * (توصیه WAI-ARIA). در RTL مقدار scrollLeft منفی است؛ فلش راست یعنی حرکت
           * به سمت ابتدای ردیف (سمت راست بصری) → علامت مثبت. قبلاً علامت‌ها
           * وارونه بود و فلش راست، ردیف را به انتهای محتوا می‌برد. */
          const amount = Math.round(el.clientWidth * 0.85);
          el.scrollBy({ left: e.key === 'ArrowRight' ? amount : -amount, behavior: 'smooth' });
        }
      }}
    >
      {children}
    </div>
  );
}

/** یک سکشن صفحه اصلی با عنوان و لینک «بیشتر» (وقتی آیتم‌ها از سقف بیشتر باشند) */
function Section({
  title,
  icon,
  moreTo,
  more,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  moreTo?: string;
  more?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="section" aria-label={title}>
      <div className="section-head">
        <h2>
          {icon}
          {title}
        </h2>
        {moreTo && more && (
          <Link className="more" to={moreTo}>
            بیشتر
            <ChevronLeft size={15} aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** سلول ردیف افقی برای کارت کتاب */
function BookCell({ novel, favorite }: { novel: Novel; favorite?: boolean }) {
  return (
    <div className="hcell hcell-book">
      <BookCard novel={novel} favorite={favorite} />
    </div>
  );
}

function ContinueReading() {
  const { novels, status } = useCatalog();
  const { progress, ready } = usePersonalData();

  const { items, hasMore } = useMemo(() => {
    const entries = [...progress.values()]
      .filter((p) => p.percentage < 0.999)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const mapped = entries
      .map((p) => {
        const novel = novels.find((n) => n.id === p.bookId);
        const volume = novel?.volumes.find((v) => v.id === p.volumeId);
        if (!novel || !volume) return null;
        return { p, novel, volume };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { items: mapped.slice(0, ROW_LIMIT), hasMore: mapped.length > ROW_LIMIT };
  }, [progress, novels]);

  if (!ready || status === 'loading') return null;
  if (items.length === 0) return null;

  return (
    <Section title="ادامه مطالعه" icon={<Clock3 size={19} />} moreTo="/history" more={hasMore}>
      <HRow label="ادامه مطالعه">
        {items.map(({ p, novel, volume }) => (
          <div className="hcell hcell-resume" key={`${p.bookId}::${p.volumeId}`}>
            <Link className="resume-card" to={`/read/${novel.id}/${volume.id}`}>
              <div className="cover-thumb">
                <CoverImage src={novel.cover} alt={displayTitle(novel)} />
              </div>
              <div className="info">
                <span className="t">{displayTitle(novel)}</span>
                <span className="s">
                  {volume.title}؛ {p.chapterTitle || 'فصل جاری'}
                </span>
                <span className="p card-progress">
                  <span className="progress-track">
                    <span className="progress-fill" style={{ width: `${Math.round(p.percentage * 100)}%` }} />
                  </span>
                  <span className="progress-label">{faPercent(p.percentage)} خوانده‌شده</span>
                </span>
              </div>
            </Link>
          </div>
        ))}
      </HRow>
    </Section>
  );
}

export default function HomePage() {
  useDocumentTitle();
  const { novels, status, error, reload } = useCatalog();
  const { favorites, ready } = usePersonalData();

  /* بخش خوش‌آمد/راهنمای اول سایت فقط برای بار اول دیده می‌شود
   * (به‌ازای هر کاربر/مرورگر — ذخیره در localStorage) */
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return localStorage.getItem('ns-welcome-seen') !== '1';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (!showWelcome) return;
    try {
      localStorage.setItem('ns-welcome-seen', '1');
    } catch {
      /* حافظه در دسترس نیست — بخش در همین نشست نمایش داده می‌شود */
    }
  }, [showWelcome]);

  /* فهرست کامل هر سکشن — ردیف افقی تا سقف ROW_LIMIT نشان می‌دهد و مابقی با «بیشتر» */
  const recent = useMemo(() => [...novels].sort((a, b) => (b.addedAt ?? '').localeCompare(a.addedAt ?? '')), [novels]);
  const completed = useMemo(() => novels.filter((n) => n.status === 'completed'), [novels]);
  const ongoing = useMemo(() => novels.filter((n) => n.status === 'ongoing'), [novels]);
  const genres = useMemo(() => collectGenres(novels).slice(0, 12), [novels]);
  const favoriteNovels = useMemo(() => novels.filter((n) => favorites.has(n.id)), [novels, favorites]);

  if (status === 'loading') {
    return (
      <div>
        <div className="skeleton" style={{ height: 150, borderRadius: 22, marginBottom: '2rem' }} />
        <BookGridSkeleton />
      </div>
    );
  }

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

  const isEmpty = novels.length === 0;

  return (
    <div>
      {/* F-06 — پس از بستن بنر خوش‌آمد، صفحه اصلی نباید بدون h1 بماند
       * (axe: page-has-heading-one)؛ عنوان فقط‌خواندنی، همیشه و بدون تغییر ظاهر */}
      {!showWelcome && (
        <h1 className="sr-only">
          {SITE_NAME}؛ {SITE_TAGLINE}
        </h1>
      )}

      {/* هیرو — فقط بار اول (با بستن دستی هم حذف می‌شود) */}
      {showWelcome && (
        <div className="hero">
          <button
            type="button"
            className="hero-close"
            aria-label="بستن بخش خوش‌آمدگویی"
            title="بستن"
            onClick={() => setShowWelcome(false)}
          >
            <X size={16} />
          </button>
          <h1>
            به {SITE_NAME} خوش آمدید
            <Sparkles size={22} style={{ color: 'var(--accent)', verticalAlign: 'middle', marginInlineStart: '0.4rem' }} />
          </h1>
          <p>
            کتابخانه آنلاین مطالعه ناول و کتاب‌های EPUB، بدون ثبت‌نام و مستقیم در مرورگر. نشانک‌ها، پیشرفت مطالعه و
            تنظیمات شما به‌صورت امن در همین مرورگر ذخیره می‌شوند.
          </p>
          <div className="actions">
            <Link to="/library" className="btn primary">
              <LibraryBig size={17} />
              ورود به کتابخانه
            </Link>
            <Link to="/guide" className="btn">
              <Compass size={17} />
              راهنمای استفاده
            </Link>
          </div>
        </div>
      )}

      {isEmpty && (
        <div className="section">
          <EmptyBox
            title="کتابخانه هنوز خالی است"
            message="هیچ کتابی در پوشه novels/ مخزن پیدا نشد. با اضافه‌کردن اولین EPUB و فایل info.json، کتابخانه به‌صورت خودکار ساخته می‌شود. راهنمای کامل در صفحه راهنما و README پروژه موجود است."
            action={
              <Link to="/guide" className="btn primary">
                مشاهده راهنمای افزودن کتاب
              </Link>
            }
          />
        </div>
      )}

      {!isEmpty && (
        <>
          <ContinueReading />

          <Section title="تازه‌ترین کتاب‌ها" icon={<BookOpen size={19} />} moreTo="/library" more={recent.length > ROW_LIMIT}>
            <HRow label="تازه‌ترین کتاب‌ها">
              {recent.slice(0, ROW_LIMIT).map((n) => (
                <BookCell key={n.id} novel={n} favorite={ready ? favorites.has(n.id) : undefined} />
              ))}
            </HRow>
          </Section>

          {ongoing.length > 0 && (
            <Section
              title="در حال انتشار"
              icon={<Play size={19} />}
              moreTo="/library?status=ongoing"
              more={ongoing.length > ROW_LIMIT}
            >
              <HRow label="در حال انتشار">
                {ongoing.slice(0, ROW_LIMIT).map((n) => (
                  <BookCell key={n.id} novel={n} favorite={ready ? favorites.has(n.id) : undefined} />
                ))}
              </HRow>
            </Section>
          )}

          {completed.length > 0 && (
            <Section
              title="کتاب‌های کامل‌شده"
              icon={<Trophy size={19} />}
              moreTo="/library?status=completed"
              more={completed.length > ROW_LIMIT}
            >
              <HRow label="کتاب‌های کامل‌شده">
                {completed.slice(0, ROW_LIMIT).map((n) => (
                  <BookCell key={n.id} novel={n} favorite={ready ? favorites.has(n.id) : undefined} />
                ))}
              </HRow>
            </Section>
          )}

          {favoriteNovels.length > 0 && (
            <Section
              title="علاقه‌مندی‌های شما"
              icon={<Heart size={19} />}
              moreTo="/favorites"
              more={favoriteNovels.length > ROW_LIMIT}
            >
              <HRow label="علاقه‌مندی‌های شما">
                {favoriteNovels.slice(0, ROW_LIMIT).map((n) => (
                  <BookCell key={n.id} novel={n} favorite />
                ))}
              </HRow>
            </Section>
          )}

          {genres.length > 0 && (
            <Section title="ژانرها" icon={<Tags size={19} />}>
              <div className="chip-row nowrap" role="region" aria-label="ژانرها">
                {genres.map((g) => (
                  <Link key={g.name} to={`/library?genre=${encodeURIComponent(g.name)}`} className="chip clickable" style={{ textDecoration: 'none' }}>
                    {g.name}
                    <span className="genre-count">{g.count}</span>
                  </Link>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
