import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Smugit - Frictionless Git for Teams',
  description: 'Git, but smoooth.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}