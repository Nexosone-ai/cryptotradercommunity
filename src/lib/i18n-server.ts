import { DEFAULT_LOCALE, makeI18n, type I18n, type Locale } from "./i18n";

/** Reader's locale for server components, layouts and generateMetadata. The site is English-only. */
export async function getLocale(): Promise<Locale> {
  return DEFAULT_LOCALE;
}

export async function getI18n(): Promise<I18n> {
  return makeI18n(await getLocale());
}
