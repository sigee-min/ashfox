'use client';

import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Monitor, Moon, Sun } from 'lucide-react';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import { useTheme } from 'next-themes';
import type { Locale } from '@/lib/i18n';

type ThemeMode = 'light' | 'dark' | 'system';

type ThemeOption = {
  value: ThemeMode;
  label: string;
  icon: typeof Sun;
};

const optionsByLocale: Record<Locale, ThemeOption[]> = {
  en: [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ],
  ko: [
    { value: 'light', label: '라이트', icon: Sun },
    { value: 'dark', label: '다크', icon: Moon },
    { value: 'system', label: '시스템', icon: Monitor },
  ],
};

export function ThemeSelect({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- keep SSR and initial hydration output identical.
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const trigger = buttonRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const menuWidth = 160;
      const menuHeight = menuRef.current?.offsetHeight ?? 170;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const left = Math.min(Math.max(8, rect.right - menuWidth), viewportWidth - menuWidth - 8);
      const nextTop = rect.bottom + 6;
      const top =
        nextTop + menuHeight > viewportHeight - 8 ? Math.max(8, rect.top - menuHeight - 6) : nextTop;
      setMenuPosition({ top, left });
    };

    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;

      const clickedTrigger = buttonRef.current?.contains(target) ?? false;
      const clickedMenu = menuRef.current?.contains(target) ?? false;
      if (!clickedTrigger && !clickedMenu) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    const handleReposition = () => updateMenuPosition();
    const frame = window.requestAnimationFrame(updateMenuPosition);

    window.addEventListener('pointerdown', handleOutsidePointer);
    window.addEventListener('keydown', handleEscape);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', handleOutsidePointer);
      window.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [open]);

  const options = optionsByLocale[locale];
  const currentValue: ThemeMode =
    mounted && (theme === 'light' || theme === 'dark' || theme === 'system') ? theme : 'system';
  const current = useMemo(
    () => options.find((option) => option.value === currentValue) ?? options[2],
    [currentValue, options],
  );

  const CurrentIcon = current.icon;
  const chooseThemeLabel = locale === 'ko' ? '테마' : 'Theme';

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label={chooseThemeLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        className={buttonVariants({
          color: 'ghost',
          className: 'shrink-0 gap-1.5 p-1.5',
        })}
        onClick={() => setOpen((prev) => !prev)}
      >
        <CurrentIcon className="size-4.5" />
        <span className="max-sm:hidden">{current.label}</span>
        <ChevronDown className={`size-3 text-fd-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && mounted
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={chooseThemeLabel}
              style={{ top: menuPosition.top, left: menuPosition.left }}
              className="fixed z-[90] w-40 overflow-hidden rounded-md border border-fd-border bg-fd-popover p-0 shadow-lg"
            >
              <p className="border-b px-2 py-1.5 text-xs font-medium text-fd-muted-foreground">{chooseThemeLabel}</p>
              <div className="p-1">
                {options.map((option) => {
                  const Icon = option.icon;
                  const selected = currentValue === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        selected
                          ? 'bg-fd-primary/10 font-medium text-fd-primary'
                          : 'text-fd-foreground hover:bg-fd-accent hover:text-fd-accent-foreground'
                      }`}
                      onClick={() => {
                        setTheme(option.value);
                        setOpen(false);
                      }}
                    >
                      <Icon className="size-4" />
                      <span className="flex-1">{option.label}</span>
                      {selected ? <Check className="size-4" /> : null}
                    </button>
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
