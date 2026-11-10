'use client';

import { useState } from 'react';
import { LANGS } from '@/i18n';
import { GlobeIcon } from './Icons';
import { useWorker } from './WorkerContext';

/** Small top-right button (globe + 한/EN/MN/VI) that opens the four languages, each named in itself. */
export function LangMenu() {
  const { lang, t, chooseLang } = useWorker();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        className="flex min-h-[56px] min-w-[56px] items-center justify-center gap-1 rounded-xl border-2 border-gray-300 bg-white px-3 text-lg font-bold"
        onClick={() => setOpen((o) => !o)}
        aria-label={t('lang.menu')}
        aria-expanded={open}
      >
        <GlobeIcon size={24} />
        {t(`lang.${lang}.short`)}
      </button>
      {open && (
        <ul className="absolute right-0 z-20 mt-2 flex w-56 flex-col gap-2 rounded-2xl border-2 border-gray-300 bg-white p-2 shadow-xl">
          {LANGS.map((l) => (
            <li key={l}>
              <button
                type="button"
                className={`flex min-h-[56px] w-full items-center justify-between rounded-xl px-4 text-xl ${l === lang ? 'bg-blue-600 font-bold text-white' : 'bg-gray-100'}`}
                onClick={() => {
                  setOpen(false);
                  chooseLang(l);
                }}
              >
                <span>{t(`lang.${l}.name`)}</span>
                <span className="text-lg opacity-70">{t(`lang.${l}.short`)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
