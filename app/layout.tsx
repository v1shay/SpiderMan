import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Spider-Man 2099 · New York',
  description: 'Build momentum, chain aerial tricks, and run the walls of New York as Spider-Man 2099.',
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
