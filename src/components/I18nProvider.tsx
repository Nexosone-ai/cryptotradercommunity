"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { cx } from "./ui";
import { DEFAULT_LOCALE, LOCALE_COOKIE, makeI18n, type I18n, type Locale } from "@/lib/i18n";

const I18nContext = createContext<I18n>(makeI18n(DEFAULT_LOCALE));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => makeI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const { t, L, locale } = useI18n()` in client components. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}

function saveLocale(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/** EN | 한국어 switch. Stores the choice in a cookie and re-renders server components. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale } = useI18n();
  const router = useRouter();
  const choose = (next: Locale) => {
    if (next === locale) return;
    saveLocale(next);
    router.refresh();
  };
  return (
    <div role="group" aria-label="Language / 언어" className={cx("flex overflow-hidden rounded-md border border-line-strong text-xs", className)}>
      {(
        [
          ["en", "EN"],
          ["ko", "한국어"],
        ] as const
      ).map(([l, label]) => (
        <button
          key={l}
          type="button"
          lang={l}
          aria-pressed={locale === l}
          onClick={() => choose(l)}
          className={cx("px-2 py-1", locale === l ? "bg-panel-2 text-text" : "text-muted hover:text-text")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
