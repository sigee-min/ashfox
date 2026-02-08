import { getPageImage, source } from '@/lib/source';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/mdx-components';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { isLocale } from '@/lib/i18n';
import { localizedAlternates, localizedPath, openGraphAlternateLocales, openGraphLocale, siteName, siteTitle } from '@/lib/site';

type DocsPageProps = {
  params: Promise<{
    lang: string;
    slug?: string[];
  }>;
};

export default async function Page({ params }: DocsPageProps) {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();

  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams('slug', 'lang');
}

export async function generateMetadata({ params }: DocsPageProps): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang)) notFound();

  const page = source.getPage(slug, lang);
  if (!page) notFound();
  const docsSuffix = slug?.length ? `/docs/${slug.join('/')}` : '/docs';
  const pageUrl = localizedPath(lang, docsSuffix);
  const pageImage = getPageImage(page).url;

  return {
    title:
      page.data.title === siteTitle
        ? {
            absolute: siteTitle,
          }
        : page.data.title,
    description: page.data.description,
    alternates: {
      canonical: pageUrl,
      languages: localizedAlternates(docsSuffix),
    },
    openGraph: {
      type: 'article',
      siteName,
      title: page.data.title,
      description: page.data.description,
      url: pageUrl,
      locale: openGraphLocale(lang),
      alternateLocale: openGraphAlternateLocales(lang),
      images: [
        {
          url: pageImage,
          alt: `${page.data.title} | ${siteName}`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: [pageImage],
    },
  };
}
