'use client';

/** Segmented buttons (board 주간/야간 style); `value` is the selected key. */
export function Tabs<K extends string>({ items, value, onChange, label }: { items: readonly { key: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="flex w-fit overflow-hidden rounded-lg border border-gray-300" role="group" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          aria-pressed={value === it.key}
          onClick={() => onChange(it.key)}
          className={`h-10 px-4 font-semibold ${value === it.key ? 'bg-slate-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
