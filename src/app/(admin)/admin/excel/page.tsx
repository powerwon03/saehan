'use client';

import { Downloads } from '@/components/admin/excel/Downloads';
import { ImportPanel } from '@/components/admin/excel/ImportPanel';

/** 엑셀: 양식 받기 · 월 근태표, then 파일 올리기 → 미리보기 → 저장. */
export default function ExcelPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-extrabold">엑셀</h1>
      <Downloads />
      <ImportPanel />
    </div>
  );
}
