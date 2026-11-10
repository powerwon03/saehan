'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

const SHOW_MS = 4_000;

const ToastContext = createContext<(text: string) => void>(() => {});

/** Bottom-centre stack of short messages (errors from the admin APIs), each gone after 4 s. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; text: string }[]>([]);
  const seq = useRef(0);

  const show = useCallback((text: string) => {
    const id = ++seq.current;
    setItems((xs) => [...xs, { id, text }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), SHOW_MS);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2" aria-live="assertive">
        {items.map((x) => (
          <p key={x.id} role="alert" className="rounded-lg bg-gray-900 px-5 py-3 text-[15px] font-semibold text-white shadow-lg">
            {x.text}
          </p>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
