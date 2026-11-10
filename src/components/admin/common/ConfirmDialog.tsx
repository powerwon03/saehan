'use client';

import { useEffect, type ReactNode } from 'react';
import { btn, btnDanger, btnPrimary } from './styles';

/** Centered yes/no dialog over a dimmed page. Esc or 취소 = no. */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div role="alertdialog" aria-label={title} className="w-[440px] rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold">{title}</h2>
        {children && <div className="mt-3 text-gray-700">{children}</div>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={btn}>
            취소
          </button>
          <button type="button" autoFocus disabled={busy} onClick={onConfirm} className={danger ? btnDanger : btnPrimary}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
