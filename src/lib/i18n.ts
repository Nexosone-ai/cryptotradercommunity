/**
 * Site language. The site is English-only: every reader gets DEFAULT_LOCALE
 * (the Korean switch was removed). The Korean halves below are kept in the
 * source but never shown.
 *
 * - Pages/components: `t(en, ko)` picks one of two values (strings or JSX).
 * - Server-side text that travels through APIs or shared labels (errors,
 *   validation messages, status labels): `bi(en, ko)` packs both languages
 *   into one string; `L(text)` / `localize()` unpacks it for the reader.
 *   API JSON is localized centrally in lib/http.ts.
 */
export type Locale = "en" | "ko";
export const DEFAULT_LOCALE: Locale = "en";

// U+241E SYMBOL FOR RECORD SEPARATOR — never typed by users in practice.
const SEP = "␞";

/** One message in both languages. Pass whole sentences; interpolate inside each half. */
export function bi(en: string, ko: string): string {
  return `${en}${SEP}${ko}`;
}

/** The reader's half of a bi() string; plain strings pass through unchanged. */
export function localize(text: string, locale: Locale): string {
  const i = text.indexOf(SEP);
  if (i < 0) return text;
  return locale === "ko" ? text.slice(i + SEP.length) : text.slice(0, i);
}

export function isBilingual(text: string): boolean {
  return text.includes(SEP);
}

export interface I18n {
  locale: Locale;
  /** Picks the English or Korean value. Works for strings and JSX. */
  t: <V>(en: V, ko: V) => V;
  /** Localizes a bi() string coming from shared code or an API. */
  L: (text: string) => string;
  /** BCP 47 tag for number/date formatting. */
  intl: string;
}

export function makeI18n(locale: Locale): I18n {
  return {
    locale,
    t: (en, ko) => (locale === "ko" ? ko : en),
    L: (text) => localize(text, locale),
    intl: locale === "ko" ? "ko-KR" : "en-US",
  };
}
