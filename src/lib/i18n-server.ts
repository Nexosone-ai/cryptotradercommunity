import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, makeI18n, parseLocale, type I18n, type Locale } from "./i18n";

/** Reader's locale for server components, layouts and generateMetadata. */
export async function getLocale(): Promise<Locale> {
  try {
    return parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  } catch {
    // Outside a request (build-time prerender): default language.
    return DEFAULT_LOCALE;
  }
}

export async function getI18n(): Promise<I18n> {
  return makeI18n(await getLocale());
}
