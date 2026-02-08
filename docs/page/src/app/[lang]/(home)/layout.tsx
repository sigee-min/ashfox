import { HomeHeader } from '@/components/home-header';
import { SiteFooter } from '@/components/site-footer';
import { isLocale } from '@/lib/i18n';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

type HomeLayoutProps = {
  children: ReactNode;
  params: Promise<{
    lang: string;
  }>;
};

export default async function Layout({ children, params }: HomeLayoutProps) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <main id="nd-home-layout" className="flex flex-1 flex-col [--fd-layout-width:1400px]">
      <HomeHeader locale={lang} />
      <div className="flex-1">{children}</div>
      <SiteFooter locale={lang} />
    </main>
  );
}
