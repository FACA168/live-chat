import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '在线客服系统',
  description: '实时在线蓝色主题客服系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-blue-50">{children}</body>
    </html>
  );
}