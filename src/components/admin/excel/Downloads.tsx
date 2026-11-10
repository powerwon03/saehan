'use client';

import { useState } from 'react';
import { seoulDate } from '@/engine/time';
import { btn, card, input } from '../common/styles';

/** 「양식 받기」 (명단 / 생산계획) and the 월 근태표 download: plain links, the browser keeps the session cookie. */
export function Downloads() {
  const [month, setMonth] = useState(() => seoulDate(new Date()).slice(0, 7));
  return (
    <section className={`${card} flex flex-wrap items-end gap-8 p-5`}>
      <div className="flex flex-col gap-2">
        <h2 className="font-bold">양식 받기</h2>
        <div className="flex gap-2">
          <a href="/api/admin/template?type=roster" download className={`${btn} inline-flex items-center`}>
            명단 양식
          </a>
          <a href="/api/admin/template?type=plan" download className={`${btn} inline-flex items-center`}>
            생산계획 양식
          </a>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="font-bold">월 근태표</h2>
        <div className="flex gap-2">
          <input type="month" aria-label="월" value={month} onChange={(e) => setMonth(e.target.value)} className={`${input} w-44`} />
          {month ? (
            <a href={`/api/admin/export/attendance?month=${encodeURIComponent(month)}`} download className={`${btn} inline-flex items-center`}>
              내려받기
            </a>
          ) : (
            <span className={`${btn} inline-flex items-center opacity-50`}>내려받기</span>
          )}
        </div>
      </div>
    </section>
  );
}
