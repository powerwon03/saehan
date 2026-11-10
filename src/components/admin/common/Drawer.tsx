'use client';

import { useEffect, type ReactNode } from 'react';

/** Right-hand panel under the top bar (like the absence panel) for add/edit forms; Esc or 닫기 closes it. */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <aside role="dialog" aria-label={title} className="fixed top-14 right-0 bottom-0 z-20 flex w-[520px] flex-col border-l border-gray-200 bg-gray-50 shadow-2xl">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
        <h2 className="text-lg font-bold">{title}</h2>
        <button type="button" onClick={onClose} className="h-10 rounded-lg border border-gray-300 px-4 font-semibold hover:bg-gray-50">
          닫기
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5">{children}</div>
    </aside>
  );
}
