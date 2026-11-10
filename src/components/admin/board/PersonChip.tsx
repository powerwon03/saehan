'use client';

import { useCallback, useState } from 'react';
import type { BoardView } from '@/server/views/boardView';
import { FLAG } from '../labels';
import { Popover } from '../Popover';
import { ExceptionMenu } from './ExceptionMenu';

type Person = BoardView['lines'][number]['people'][number];

const LockIcon = () => (
  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} aria-label="고정" role="img">
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);

/** One assigned person: name + 사번, lock when locked, small warning badges per flag. Click → ExceptionMenu. */
export function PersonChip({ person, postId, postLabel }: { person: Person; postId: string; postLabel: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Popover
      open={open}
      onClose={close}
      trigger={
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${person.name} ${person.empNo}${person.locked ? ' 고정' : ''}${person.flags.map((f) => ` · ${FLAG[f] ?? f}`).join('')}`}
          className={`flex h-[52px] flex-col items-start justify-center rounded-lg border px-2.5 text-left hover:border-blue-500 ${
            person.source === 'sub' ? 'border-green-400 bg-green-50' : 'border-gray-300 bg-white'
          }`}
        >
          <span className="flex items-center gap-1 leading-tight">
            {person.locked && <span className="text-gray-500"><LockIcon /></span>}
            <span className="font-semibold">{person.name}</span>
            <span className="text-xs text-gray-500">{person.empNo}</span>
          </span>
          {person.flags.length > 0 && (
            <span className="mt-0.5 flex gap-1">
              {person.flags.map((f) => (
                <span key={f} className="rounded bg-amber-100 px-1 text-[11px] font-semibold leading-4 text-amber-900">
                  {FLAG[f] ?? f}
                </span>
              ))}
            </span>
          )}
        </button>
      }
    >
      <ExceptionMenu chip={person} postId={postId} postLabel={postLabel} onDone={close} />
    </Popover>
  );
}
