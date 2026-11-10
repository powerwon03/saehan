import type { ReactNode } from 'react';

/** Label above a control, with an optional error line under it. */
export function Field({ label, error, children, wide }: { label: string; error?: string | null; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${wide ? 'col-span-2' : ''}`}>
      <span className="text-sm font-semibold text-gray-600">{label}</span>
      {children}
      {error && (
        <span role="alert" className="text-sm font-semibold text-red-600">
          {error}
        </span>
      )}
    </label>
  );
}
