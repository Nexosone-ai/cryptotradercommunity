/**
 * Site language. English is the default; Korean is chosen with the header
 * switch and remembered in a cookie. No URL prefixes: the same page renders
 * in the reader's language.
 *
 * - Pages/components: `t(en, ko)` picks one of two values (strings or JSX).
 * - Server-side text that travels through APIs or shared labels (errors,
 *   validation messages, status labels): `bi(en, ko)` packs both languages
 *   into one string; `L(text)` / `localize()` unpacks it for the reader.
 *   API JSON is localized centrally in lib/http.ts.
 */
export type Locale = "en" | "ko";
export const LOCALES: readonly Locale[] = ["en", "ko"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "ctc_lang";

// U+241E SYMBOL FOR RECORD SEPARATOR — never typed by users in practice.
const SEP = "␞";

export function parseLocale(value: string | null | undefined): Locale {
  return value === "ko" ? "ko" : DEFAULT_LOCALE;
}

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

/** Reads the locale from a raw Cookie header (route handlers). */
export function localeFromCookieHeader(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === LOCALE_COOKIE) return parseLocale(v);
  }
  return DEFAULT_LOCALE;
}
