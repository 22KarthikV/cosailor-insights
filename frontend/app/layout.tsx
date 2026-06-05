/**
 * Root layout for the Cosailor Insights Next.js application.
 *
 * Wraps every page with the Inter font, a light grey background, and the
 * global CSS reset. Metadata is defined here so it applies to all routes.
 */
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Cosailor Insights',
  description: 'AI-powered B2B sales intelligence for roofing distributors',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>{children}</body>
    </html>
  );
}
