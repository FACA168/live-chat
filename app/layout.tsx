import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '在线客服',
  description: '实时在线客服系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
    <body style={{ backgroundColor: 'red' }}>{children}</body>
    </html>
  );
}
