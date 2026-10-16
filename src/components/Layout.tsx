import { useMemo, useState } from 'react';
import { BookOpen, Clock, Home, Library, Menu, MonitorSmartphone, Moon, Search, Settings, Heart, Send, Sun } from 'lucide-react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { SITE_NAME, SITE_NAME_EN, SITE_TAGLINE, REPO_URL, TELEGRAM_URL } from '@/config';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { useCatalog } from '@/hooks/useCatalog';
import { useDebounced } from '@/hooks/misc';
import { useEffect } from 'react';

/** چرخه تم سایت — تاریک → روشن → سیستم (افق میان‌مدت گزارش) */
const THEME_NEXT: Record<Theme, Theme> = { dark: 'light', light: 'system', system: 'dark' };

const NAV_ITEMS = [
  { to: '/', label: 'خانه', icon: Home, end: true },
  { to: '/library', label: 'کتابخانه', icon: Library },
  { to: '/favorites', label: 'علاقه‌مندی‌ها', icon: Heart },
  { to: '/history', label: 'تاریخچه', icon: Clock },
  { to: '/settings', label: 'تنظیمات', icon: Settings },
];

const BOTTOM_NAV_ITEMS = [
  { to: '/', label: 'خانه', icon: Home, end: true },
  { to: '/library', label: 'کتابخانه', icon: Library },
  { to: '/favorites', label: 'علاقه‌مندی', icon: Heart },
  { to: '/history', label: 'تاریخچه', icon: Clock },
  { to: '/settings', label: 'تنظیمات', icon: Settings },
];

function Header() {
  const { theme, setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const debounced = useDebounced(query, 350);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // جست‌وجوی زنده: با تغییر عبارت به کتابخانه منتقل شو
  useEffect(() => {
    if (!debounced.trim()) return;
    navigate(`/library?q=${encodeURIComponent(debounced.trim())}`, { replace: location.pathname === '/library' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  // بستن منوی موبایل هنگام تغییر مسیر
  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  return (
    <header className="site-header">
      <div className="container header-inner">
        {/* A11Y-002 — برچسب در نام (WCAG 2.5.3): نام قابل دسترس باید شامل متن قابل
         * مشاهده باشد؛ aria-label قبلی متن دیده‌شده را نداشت. متن پنهان اضافه می‌شود. */}
        <Link to="/" className="brand" title={`${SITE_NAME} | ${SITE_NAME_EN}`}>
          <span className="logo" aria-hidden="true">
            <BookOpen size={21} strokeWidth={2.2} />
          </span>
          <span>
            {SITE_NAME}
            <small>
              {SITE_NAME_EN} — {SITE_TAGLINE}
            </small>
          </span>
          <span className="sr-only">— صفحه اصلی</span>
        </Link>

        <nav className={`main-nav ${menuOpen ? 'open' : ''}`} aria-label="منوی اصلی">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <item.icon size={16} aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          <div className="header-search">
            <input
              type="search"
              placeholder="جست‌وجوی سریع…"
              aria-label="جست‌وجوی سریع کتاب‌ها"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="search-ico" aria-hidden="true">
              <Search size={16} />
            </span>
          </div>
          {/* تم سایت — چرخه سه‌حالته: تاریک → روشن → سیستم (پیش‌فرض تم تاریک می‌ماند) */}
          <button
            type="button"
            className="icon-btn"
            onClick={() => setTheme(THEME_NEXT[theme])}
            aria-label={
              theme === 'dark' ? 'تغییر به تم روشن' : theme === 'light' ? 'تغییر به تم سیستم (خودکار)' : 'تغییر به تم تاریک'
            }
            title={theme === 'dark' ? 'تم تاریک' : theme === 'light' ? 'تم روشن' : 'تم سیستم'}
          >
            {theme === 'dark' ? <Sun size={18} /> : theme === 'light' ? <Moon size={18} /> : <MonitorSmartphone size={18} />}
          </button>
          <button
            type="button"
            className="icon-btn menu-toggle"
            aria-label={menuOpen ? 'بستن منو' : 'بازکردن منو'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <Menu size={19} />
          </button>
        </div>
      </div>
    </header>
  );
}

/** نوار ناوبری پایین — فقط موبایل */
function BottomNav() {
  const location = useLocation();
  return (
    <nav className="bottom-nav" aria-label="ناوبری موبایل">
      {BOTTOM_NAV_ITEMS.map((item) => {
        const active = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
        return (
          <Link key={item.to} to={item.to} className={`bn-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined}>
            <item.icon size={20} aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function Footer() {
  /* افق میان‌مدت گزارش — شفافیت تازگی کاتالوگ: نمایش زمان آخرین Build کاتالوگ */
  const { catalog } = useCatalog();
  const freshness = useMemo(() => {
    const raw = catalog?.generatedAt;
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric' });
  }, [catalog]);

  return (
    <footer className="site-footer">
      <div className="container footer-grid">
        <div>
          <strong>{SITE_NAME}</strong>
          <p style={{ margin: '0.3rem 0 0', maxWidth: '46ch' }}>
            کتابخانه‌ای رایگان برای مطالعه آنلاین ناول و فایل‌های EPUB. تمام تنظیمات، نشانک‌ها و پیشرفت مطالعه شما فقط
            در مرورگر خودتان ذخیره می‌شود و به هیچ سروری ارسال نمی‌گردد.
          </p>
          {freshness && (
            <p className="footer-freshness" title="زمان ساخت آخرین نسخه فهرست کتاب‌ها">
              آخرین به‌روزرسانی کتابخانه: {freshness}
            </p>
          )}
        </div>
        {/* F-06 — لینک‌های فوتر از div به nav تغییر کرد تا نقش معنایی داشته باشند
         * (axe: aria-prohibited-attr — aria-label روی div نقش ندارد) */}
        <nav className="footer-links" aria-label="پیوندها">
          <Link to="/library">کتابخانه</Link>
          <Link to="/guide">راهنمای استفاده</Link>
          <Link to="/about">درباره پروژه</Link>
          <Link to="/settings">تنظیمات و داده‌ها</Link>
          <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <Send size={13} /> کانال تلگرام
          </a>
          {REPO_URL && (
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              مخزن GitHub
            </a>
          )}
        </nav>
        <div>
          <p style={{ margin: 0 }}>
            حقوق نشر کتاب‌ها نزد ناشران و مؤلفان آن‌هاست؛ این سایت فقط کتاب‌هایی با مجوز انتشار عمومی را میزبانی می‌کند.
          </p>
        </div>
      </div>
    </footer>
  );
}

/**
 * مدیریت اسکرول هوشمند:
 * - PUSH/REPLACE → پرش به بالای صفحه
 * - POP (دکمه بازگشت) → بازیابی دقیق موقعیت قبلی از حافظه جلسه
 * این کار «بهم‌ریختن صفحه» هنگام برگشت از صفحات دیگر (به‌ویژه کتاب‌خوان) را در موبایل برطرف می‌کند.
 */
function ScrollManager() {
  const { pathname, search } = useLocation();
  const navType = useNavigationType();
  const key = `${pathname}${search}`;

  useEffect(() => {
    if (navType === 'POP') {
      const saved = sessionStorage.getItem(`ns-scroll:${key}`);
      const y = saved ? Number(saved) : 0;
      // پس از رندر و آرام‌شدن چیدمان بازیابی شود
      requestAnimationFrame(() => window.scrollTo(0, y));
    } else {
      window.scrollTo(0, 0);
    }
    const onScroll = () => {
      try {
        sessionStorage.setItem(`ns-scroll:${key}`, String(Math.round(window.scrollY)));
      } catch {
        /* حافظه پر است — نادیده */
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [key, navType]);

  return null;
}

export function Layout() {
  return (
    <div className="app-shell">
      <ScrollManager />
      <Header />
      <main className="site-main">
        <div className="container">
          <Outlet />
        </div>
      </main>
      <Footer />
      <BottomNav />
    </div>
  );
}
