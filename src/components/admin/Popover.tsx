'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const WIDTH = 380;

/**
 * Anchored panel under its trigger: closes on outside click or Esc. Opens to the left of the anchor when there
 * is not enough room on the right, so it never causes horizontal page scroll.
 */
export function Popover({ open, onClose, trigger, children }: { open: boolean; onClose: () => void; trigger: ReactNode; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);

  useLayoutEffect(() => {
    if (open && anchor.current) setAlignRight(anchor.current.getBoundingClientRect().left + WIDTH + 16 > window.innerWidth);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <div ref={anchor} className="relative">
      {trigger}
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={onClose} aria-hidden="true" />
          <div
            role="dialog"
            style={{ width: WIDTH }}
            className={`absolute top-full z-40 mt-1 rounded-xl border border-gray-200 bg-white p-4 shadow-xl ${alignRight ? 'right-0' : 'left-0'}`}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
