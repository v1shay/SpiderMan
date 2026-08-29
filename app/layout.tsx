import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SpiderMan',
  description: 'Choose your hero and traverse a full-scale 3D city.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
