import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LandingPage } from '@/components/landing/landing-page';
import { getLandingCopy } from '@/lib/content/landing';
import { isLocale, locales } from '@/lib/i18n';
import {
  defaultOpenGraphImage,
  localizedAlternates,
  localizedPath,
  openGraphAlternateLocales,
  openGraphLocale,
  siteName,
  siteTitle,
} from '@/lib/site';

type LocalizedHomePageProps = {
  params: Promise<{
    lang: string;
  }>;
};

export async function generateMetadata({ params }: LocalizedHomePageProps): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};

  const copy = getLandingCopy(lang);
  const pageUrl = localizedPath(lang);

  return {
    title: {
      absolute: siteTitle,
    },
    description: copy.description,
    alternates: {
      canonical: pageUrl,
      languages: localizedAlternates(),
    },
    openGraph: {
      type: 'website',
      siteName,
      title: siteTitle,
      description: copy.description,
      url: pageUrl,
      locale: openGraphLocale(lang),
      alternateLocale: openGraphAlternateLocales(lang),
      images: [
        {
          url: defaultOpenGraphImage,
          alt: `${siteName} preview`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: siteTitle,
      description: copy.description,
      images: [defaultOpenGraphImage],
    },
  };
}

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function HomePage({ params }: LocalizedHomePageProps) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return <LandingPage locale={lang} copy={getLandingCopy(lang)} />;
}
