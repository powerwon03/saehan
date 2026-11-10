'use client';

import { useState, type ReactNode } from 'react';
import { seoulDate } from '@/engine/time';
import { send, type ApiResult } from '@/lib/api';
import { strongEnough } from '@/lib/personRules';
import { Popover } from '../Popover';
import { btnDanger, btnPrimary, btnSm, input } from '../common/styles';
import type { RunWrite } from '../common/useWrite';
import { errorText } from '../labels';
import type { PersonRow } from './logic';

type Mode = 'menu' | 'retire' | 'delete' | 'pin';

const item = 'w-full rounded-lg px-3 py-2 text-left font-semibold hover:bg-gray-100 disabled:opacity-50';

/** 「관리」 menu of one row: 수정, 퇴사/복직, PIN 재설정, 잠금 풀기 (when locked), 삭제. */
export function RowActions({ person, locked, run, busy, onEdit }: { person: PersonRow; locked: boolean; run: RunWrite; busy: boolean; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('menu');
  const [leftAt, setLeftAt] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const key = person.id;
  const base = `/api/admin/persons/${person.id}`;

  const show = (m: Mode) => {
    setMode(m);
    setError(null);
    if (m === 'retire') setLeftAt(seoulDate(new Date()));
    if (m === 'pin') setPin('');
  };
  const close = () => {
    setOpen(false);
    show('menu');
  };
  /** Runs the write; closes on success, keeps the panel open with the error inline otherwise. */
  const act = async (call: () => Promise<ApiResult<unknown>>) => {
    const r = await run(key, call, { quiet: true });
    if (r.ok) close();
    else setError(r.code);
  };

  const accounts = (body: object) => send('POST', '/api/admin/accounts', { personId: person.id, ...body });

  return (
    <Popover
      open={open}
      onClose={close}
      trigger={
        <button type="button" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} className={btnSm}>
          관리 ▾
        </button>
      }
    >
      <div className="text-left">
        <p className="mb-2 font-bold">
          {person.name} <span className="font-normal text-gray-500">{person.empNo}</span>
        </p>

        {mode === 'menu' && (
          <div className="flex flex-col">
            <button type="button" className={item} onClick={() => {
                close();
                onEdit();
              }}>
              수정
            </button>
            {person.active ? (
              <button type="button" className={item} onClick={() => show('retire')}>
                퇴사 처리
              </button>
            ) : (
              <button type="button" className={item} disabled={busy} onClick={() => void act(() => send('POST', base, { action: 'rehire' }))}>
                복직
              </button>
            )}
            <button type="button" className={item} onClick={() => show('pin')}>
              PIN 재설정
            </button>
            {locked && (
              <button type="button" className={item} disabled={busy} onClick={() => void act(() => accounts({ action: 'unlock' }))}>
                잠금 풀기
              </button>
            )}
            <button type="button" className={`${item} text-red-700`} onClick={() => show('delete')}>
              삭제
            </button>
            {error && <ErrorLine code={error} />}
          </div>
        )}

        {mode === 'retire' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">퇴사일부터 배치에서 빠지고 기록은 남아요. 보낸 대체 요청과 휴무 신청은 취소돼요.</p>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-600">퇴사일</span>
              <input type="date" className={input} value={leftAt} onChange={(e) => setLeftAt(e.target.value)} />
            </label>
            {error && <ErrorLine code={error} />}
            <Buttons onBack={() => show('menu')}>
              <button type="button" className={btnDanger} disabled={busy || !leftAt} onClick={() => void act(() => send('POST', base, { action: 'retire', date: leftAt }))}>
                퇴사 처리
              </button>
            </Buttons>
          </div>
        )}

        {mode === 'pin' && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-gray-600">새 PIN (숫자 6자리)</span>
              <input
                className={input}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                autoFocus
              />
            </label>
            <p className="text-sm text-gray-600">잠금도 함께 풀리고, 다음 로그인 때 본인이 PIN을 바꾸게 돼요.</p>
            {error && <ErrorLine code={error} />}
            <Buttons onBack={() => show('menu')}>
              <button
                type="button"
                className={btnPrimary}
                disabled={busy || pin.length !== 6}
                onClick={() => (strongEnough('worker', pin) ? void act(() => accounts({ action: 'resetPin', pin })) : setError('WEAK_SECRET'))}
              >
                PIN 바꾸기
              </button>
            </Buttons>
          </div>
        )}

        {mode === 'delete' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-gray-600">배치·결근·휴무 기록이 없는 사람만 지울 수 있어요. 지우면 되돌릴 수 없어요.</p>
            {error === 'HAS_HISTORY' ? (
              <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm font-semibold text-amber-900">
                {errorText(error)}. 대신 퇴사 처리를 해 주세요.
                <button type="button" className={`${btnSm} mt-2 block`} onClick={() => show('retire')}>
                  퇴사 처리로 가기
                </button>
              </div>
            ) : (
              error && <ErrorLine code={error} />
            )}
            <Buttons onBack={() => show('menu')}>
              <button type="button" className={btnDanger} disabled={busy || error === 'HAS_HISTORY'} onClick={() => void act(() => send('DELETE', base))}>
                삭제
              </button>
            </Buttons>
          </div>
        )}
      </div>
    </Popover>
  );
}

function ErrorLine({ code }: { code: string }) {
  return (
    <p role="alert" className="text-sm font-semibold text-red-600">
      {errorText(code)}
    </p>
  );
}

function Buttons({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onBack} className="h-10 rounded-lg border border-gray-300 px-4 font-semibold hover:bg-gray-50">
        뒤로
      </button>
      {children}
    </div>
  );
}
