import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { SPRING } from '../landing/motion';

const ToastContext = createContext(null);

/** Transient confirmations ("Patient saved"). Errors that need action stay inline. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback((message, { tone = 'success', duration = 4200 } = {}) => {
    const id = nextId.current++;
    setToasts((list) => [...list.slice(-3), { id, message, tone }]);
    if (duration) setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  const api = useMemo(() => ({
    success: (message, options) => push(message, { ...options, tone: 'success' }),
    error: (message, options) => push(message, { duration: 7000, ...options, tone: 'error' }),
  }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end">
        <AnimatePresence initial={false}>
          {toasts.map((toast) => {
            const Icon = toast.tone === 'error' ? AlertTriangle : CheckCircle2;
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97, transition: { duration: 0.18 } }}
                transition={SPRING.card}
                role={toast.tone === 'error' ? 'alert' : 'status'}
                className="pointer-events-auto flex w-full max-w-[380px] items-start gap-3 rounded-2xl border border-[#E3EAF5] bg-white px-4 py-3 shadow-[0_2px_6px_rgba(16,38,76,0.05),0_16px_40px_rgba(16,38,76,0.12)]"
              >
                <Icon className={`mt-[1px] h-5 w-5 shrink-0 ${toast.tone === 'error' ? 'text-blush' : 'text-mint'}`} strokeWidth={2} />
                <p className="flex-1 text-[14px] font-medium text-ink">{toast.message}</p>
                <button type="button" onClick={() => dismiss(toast.id)} className="-m-1 rounded-lg p-1 text-ink-faint hover:text-ink" aria-label="Dismiss">
                  <X className="h-4 w-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
