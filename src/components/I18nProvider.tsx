"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, makeI18n, type I18n, type Locale } from "@/lib/i18n";

const I18nContext = createContext<I18n>(makeI18n(DEFAULT_LOCALE));

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => makeI18n(locale), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** `const { t, L, locale } = useI18n()` in client components. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}
