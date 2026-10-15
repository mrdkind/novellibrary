import { memo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Heart, Library } from 'lucide-react';
import type { Novel, ReadingProgress } from '@/types';
import { STATUS_LABELS, totalChapters } from '@/services/catalog';
import { faDigits, faPercent } from '@/services/persian';
import { CoverImage } from './CoverImage';

export const STATUS_LABEL = STATUS_LABELS;

/** نشان وضعیت روی جلد — تنها جای نمایش وضعیت در کارت (بدون تکرار) */
function CoverStatusBadge({ status }: { status: Novel['status'] }) {
  return <span className={`cover-badge ${status}`}>{STATUS_LABELS[status]}</span>;
}

interface BookCardProps {
  novel: Novel;
  progress?: ReadingProgress;
  favorite?: boolean;
}

/** کارت قفسه‌ای — بدنه فشرده: عنوان، نویسنده، ژانر یک‌خطی، شمار جلد/فصل */
export const BookCard = memo(function BookCard({ novel, progress, favorite }: BookCardProps) {
  const title = novel.titleFa ?? novel.titleOriginal ?? novel.id;
  const genreLine = (novel.genres ?? []).slice(0, 3).join('، ');

  return (
    <article className="book-card">
      <div className="cover-wrap">
        <CoverImage src={novel.cover} alt={title} />
        <CoverStatusBadge status={novel.status} />
        {favorite && (
          <span className="fav-badge" title="در علاقه‌مندی‌ها">
            <Heart size={15} fill="currentColor" />
          </span>
        )}
      </div>
      <div className="card-body">
        <div className="card-title">{title}</div>
        <div className="card-meta">
          <Library size={12} aria-hidden="true" />
          {faDigits(novel.volumes.length)} جلد · {faDigits(totalChapters(novel))} فصل
        </div>
        {genreLine && <div className="card-genres">{genreLine}</div>}
        {progress && (
          <div className="card-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(progress.percentage * 100)}%` }} />
            </div>
            <div className="progress-label">ادامه مطالعه — {faPercent(progress.percentage)}</div>
          </div>
        )}
      </div>
      <Link className="card-link" to={`/novel/${novel.id}`} aria-label={`جزئیات ${title}`} />
    </article>
  );
});

/** ردیف فهرستی — برای نمای «فهرست» کتابخانه و مرور سریع */
export const BookRow = memo(function BookRow({ novel, progress, favorite }: BookCardProps) {
  const title = novel.titleFa ?? novel.titleOriginal ?? novel.id;
  const author = novel.author;
  const genreLine = (novel.genres ?? []).slice(0, 3).join('، ');
  return (
    <article className="book-row">
      <div className="row-cover">
        <CoverImage src={novel.cover} alt={title} />
      </div>
      <div className="row-main">
        <div className="row-title">{title}</div>
        <div className="row-sub">
          {author}
          {genreLine ? ` · ${genreLine}` : ''}
        </div>
        <div className="row-sub">
          <span className={`status-badge ${novel.status}`} style={{ marginInlineEnd: '0.35rem' }}>
            {STATUS_LABELS[novel.status]}
          </span>
          {faDigits(novel.volumes.length)} جلد · {faDigits(totalChapters(novel))} فصل
        </div>
      </div>
      <div className="row-side">
        {favorite && <Heart size={14} color="#ff8f8f" fill="currentColor" aria-label="در علاقه‌مندی‌ها" />}
        {progress && (
          <div className="row-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${Math.round(progress.percentage * 100)}%` }} />
            </div>
          </div>
        )}
        <span className="row-chev" aria-hidden="true">
          <ChevronLeft size={16} />
        </span>
      </div>
      <Link className="card-link" to={`/novel/${novel.id}`} aria-label={`جزئیات ${title}`} />
    </article>
  );
});

export function BookGrid({
  novels,
  progressMap,
  favorites,
  view = 'grid',
}: {
  novels: Novel[];
  /** نقشه پیشرفت با کلید bookId::volumeId (مستقیم از مخزن) */
  progressMap?: Map<string, ReadingProgress>;
  favorites?: Set<string>;
  /** نمای نمایش: شبکه قفسه‌ای یا ردیف‌های فهرستی */
  view?: 'grid' | 'list';
}) {
  // آخرین پیشرفت هر کتاب (بر اساس آخرین زمان مطالعه)
  const byBook = new Map<string, ReadingProgress>();
  if (progressMap) {
    for (const p of progressMap.values()) {
      const prev = byBook.get(p.bookId);
      if (!prev || prev.updatedAt < p.updatedAt) byBook.set(p.bookId, p);
    }
  }
  if (view === 'list') {
    return (
      <div className="book-rows">
        {novels.map((n) => (
          <BookRow key={n.id} novel={n} progress={byBook.get(n.id)} favorite={favorites?.has(n.id)} />
        ))}
      </div>
    );
  }
  return (
    <div className="book-grid">
      {novels.map((n) => (
        <BookCard key={n.id} novel={n} progress={byBook.get(n.id)} favorite={favorites?.has(n.id)} />
      ))}
    </div>
  );
}
