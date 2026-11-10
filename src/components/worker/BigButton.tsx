'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

export type Tone = 'red' | 'green' | 'gray' | 'white' | 'orange' | 'navy' | 'blue';

const TONES: Record<Tone, string> = {
  red: 'bg-red-600 text-white active:bg-red-700',
  green: 'bg-green-600 text-white active:bg-green-700',
  blue: 'bg-blue-600 text-white active:bg-blue-700',
  gray: 'bg-gray-200 text-gray-900 active:bg-gray-300',
  white: 'bg-white text-gray-900 border-2 border-gray-300 active:bg-gray-100',
  orange: 'bg-white text-[#C2410C] border-4 border-white active:bg-orange-100',
  navy: 'bg-white text-[#1E3A8A] border-4 border-white active:bg-blue-100',
};

type Props = {
  children: ReactNode;
  tone?: Tone;
  /** lg = 80px tall main action, md = 56px. */
  size?: 'lg' | 'md';
  icon?: ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  label?: string;
};

/** The one tappable shape on the worker screens: full width, at least 56px tall, icon + short text. */
export function BigButton({ children, tone = 'gray', size = 'md', icon, href, onClick, disabled, label }: Props) {
  const cls = `flex w-full items-center justify-center gap-3 rounded-2xl px-4 font-bold select-none [&>svg]:shrink-0 ${
    size === 'lg' ? 'min-h-[80px] text-2xl' : 'min-h-[56px] text-xl'
  } ${TONES[tone]} ${disabled ? 'opacity-50' : ''}`;
  const body = (
    <>
      {icon}
      {/* break-keep: two short lines at word boundaries in a narrow tile, never a word split mid-way */}
      <span className="break-keep text-center">{children}</span>
    </>
  );
  if (href && !disabled)
    return (
      <Link href={href} className={cls} aria-label={label}>
        {body}
      </Link>
    );
  return (
    <button type="button" className={cls} onClick={onClick} disabled={disabled} aria-label={label}>
      {body}
    </button>
  );
}
