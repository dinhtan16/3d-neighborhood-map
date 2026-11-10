import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bản đồ khu phố 3D · Chơn Thành',
  description: 'Interactive illustrated 3D neighbourhood map built from OpenStreetMap data.',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f4e9d8' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
