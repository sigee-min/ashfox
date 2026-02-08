'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type ScrollRevealProps = {
  children: ReactNode;
  className?: string;
  delayMs?: number;
};

export function ScrollReveal({ children, className, delayMs = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;

    if (typeof IntersectionObserver === 'undefined') {
      const frame = window.requestAnimationFrame(() => setVisible(true));
      return () => window.cancelAnimationFrame(frame);
    }

    const isNearPageBottom = () => {
      const doc = document.documentElement;
      return window.innerHeight + window.scrollY >= doc.scrollHeight - 6;
    };

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry) return;

        if (entry.isIntersecting && (entry.intersectionRatio >= 0.24 || isNearPageBottom())) {
          window.requestAnimationFrame(() => setVisible(true));
          observer.disconnect();
        }
      },
      {
        threshold: [0, 0.24, 0.45, 0.65],
        rootMargin: '0px 0px -14% 0px',
      },
    );

    observer.observe(element);

    const onScrollFallback = () => {
      const rect = element.getBoundingClientRect();
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const triggerLine = Math.min(viewportHeight * 0.82, 720);
      if ((rect.top <= triggerLine && rect.bottom > 0) || (isNearPageBottom() && rect.top < viewportHeight)) {
        window.requestAnimationFrame(() => setVisible(true));
        observer.disconnect();
        window.removeEventListener('scroll', onScrollFallback);
        window.removeEventListener('resize', onScrollFallback);
      }
    };

    window.addEventListener('scroll', onScrollFallback, { passive: true });
    window.addEventListener('resize', onScrollFallback);
    const frame = window.requestAnimationFrame(onScrollFallback);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('scroll', onScrollFallback);
      window.removeEventListener('resize', onScrollFallback);
    };
  }, [visible]);

  const classes = ['bb-scroll-reveal', visible ? 'is-visible' : '', className].filter(Boolean).join(' ');
  const style = { '--bb-reveal-delay': `${delayMs}ms` } as CSSProperties;

  return (
    <div ref={ref} className={classes} style={style}>
      {children}
    </div>
  );
}
