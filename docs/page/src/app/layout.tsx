import type { Metadata } from 'next';
import './global.css';

function resolveMetadataBase() {
  const fallback = new URL('http://localhost:3000');
  const raw = process.env.DOCS_SITE_URL?.trim();
  if (!raw) return fallback;

  try {
    return new URL(raw);
  } catch {
    return fallback;
  }
}

const metadataBase = resolveMetadataBase();

export const metadata: Metadata = {
  title: {
    default: 'bbmcp',
    template: '%s | bbmcp',
  },
  description: 'bbmcp MCP tools for Blockbench modeling, texturing, animation, and validation workflows.',
  metadataBase,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col antialiased">{children}</body>
    </html>
  );
}
