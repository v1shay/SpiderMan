import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'New York — Spider-Man',
  description: 'Choose your Spider-Man and swing through a streamed 3D New York City.',
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
