import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Soft Matter. — A study in softness',
  icons: {
    icon:
      process.env.GITHUB_ACTIONS === 'true'
        ? '/soft-matter-jelly-lab/favicon.svg'
        : '/favicon.svg',
  },
  description:
    'Grab, stretch, and let go. A tactile experiment with light, gravity, and soft matter.',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
