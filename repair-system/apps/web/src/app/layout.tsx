import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'خالد لصيانة المحمول',
  description: 'تابع صيانة جهازك لحظة بلحظة — خالد لصيانة المحمول',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
  applicationName: 'خالد لصيانة المحمول',
  appleWebApp: { capable: true, title: 'خالد للصيانة', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  themeColor: '#0B1F3A',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
