import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: '원터치 라인' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
