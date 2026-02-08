import Link from 'next/link';
import { BookText, Github } from 'lucide-react';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { LanguageSelect } from '@/components/language-select';
import { ThemeSelect } from '@/components/theme-select';
import type { Locale } from '@/lib/i18n';

export function HomeHeader({ locale }: { locale: Locale }) {
  const docsLabel = locale === 'ko' ? '문서' : 'Docs';

  return (
    <header className="sticky top-0 z-40 border-b bg-fd-background/80 backdrop-blur-lg">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href={`/${locale}`} className="inline-flex items-center text-base font-semibold">
          bbmcp
        </Link>
        <div className="flex items-center gap-1.5">
          <Link href={`/${locale}/docs`} className={buttonVariants({ color: 'ghost', className: 'gap-1.5 px-2.5 text-sm' })}>
            <BookText className="size-4" />
            <span>{docsLabel}</span>
          </Link>
          <ThemeSelect locale={locale} />
          <LanguageSelect locale={locale} />
          <a
            href="https://github.com/sigee-min/bbmcp"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className={buttonVariants({ color: 'ghost', size: 'icon' })}
          >
            <Github className="size-4.5" />
          </a>
        </div>
      </div>
    </header>
  );
}
