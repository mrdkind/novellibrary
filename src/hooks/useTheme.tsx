import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_SITE_SETTINGS } from '@/types';

/**
 * تم سایت — افق میان‌مدت گزارش ممیزی ۱٫۵٫۱:
 * علاوه بر «تاریک» و «روشن»، گزینه سوم «سیستم» به prefers-color-scheme
 * گوش می‌دهد و با تغییر تم سیستم‌عامل، به‌صورت زنده عوض می‌شود.
 * پیش‌فرض همان «تاریک» قبلی می‌ماند تا رفتار کاربران فعلی تغییر نکند.
 */
export type Theme = 'dark' | 'light' | 'system';

interface ThemeCtx {
  theme: Theme;
  /** مقدار مؤثر پس از حل‌کردن «سیستم» — برای رندر */
  resolved: 'dark' | 'light';
  toggle: () => void;
  setTheme: (t: Theme) => void;
}

const Ctx = createContext<ThemeCtx>({ theme: 'dark', resolved: 'dark', toggle: () => {}, setTheme: () => {} });

const THEME_COLOR: Record<'dark' | 'light', string> = {
  dark: '#0f1115',
  light: '#f7f4ee',
};

function prefersLight(): boolean {
  try {
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ?? false;
  } catch {
    return false;
  }
}

export function resolveTheme(t: Theme): 'dark' | 'light' {
  return t === 'system' ? (prefersLight() ? 'light' : 'dark') : t;
}

function readInitial(): Theme {
  try {
    const saved = localStorage.getItem('ns-site-theme');
    if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_SITE_SETTINGS.theme;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readInitial);
  const resolved = resolveTheme(theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', THEME_COLOR[resolved]);
    try {
      localStorage.setItem('ns-site-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme, resolved]);

  /* وقتی روی «سیستم» است، تغییر تم سیستم‌عامل باید بلافاصله اعمال شود */
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const r = mq.matches ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', r);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[r]);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  /* چرخه سه‌حالته: تاریک → روشن → سیستم → تاریک */
  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : t === 'light' ? 'system' : 'dark')), []);
  const value = useMemo(() => ({ theme, resolved, toggle, setTheme }), [theme, resolved, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  return useContext(Ctx);
}
