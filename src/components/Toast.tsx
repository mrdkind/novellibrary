import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

interface ToastCtx {
  toast: (message: string, kind?: ToastItem['kind']) => void;
}

const Ctx = createContext<ToastCtx>({ toast: () => {} });

/** مدت نمایش توست‌ها (LOGIC-002) — پیام‌های خطا وقت بیشتری برای خواندن دارند */
const TOAST_MS: Record<ToastItem['kind'], number> = {
  info: 3600,
  success: 3600,
  error: 9000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastItem['kind'] = 'info') => {
      const id = ++idRef.current;
      setItems((list) => [...list, { id, message, kind }]);
      setTimeout(() => {
        setItems((list) => list.filter((t) => t.id !== id));
      }, TOAST_MS[kind]);
    },
    [],
  );

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span style={{ flex: 1 }}>{t.message}</span>
            {/* LOGIC-002 — بستن دستی؛ پیام‌های بلند (مثلاً خطای ورود اطلاعات)
             * دیگر پیش از خواندن کامل محو نمی‌شوند */}
            <button type="button" className="toast-close" aria-label="بستن پیام" onClick={() => dismiss(t.id)}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  return useContext(Ctx);
}
