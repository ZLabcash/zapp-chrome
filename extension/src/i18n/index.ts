// ZApp's 13 languages: the iOS app's own translations (Localizable.xcstrings, keyed by the
// English text), plus the few lines that only the browser has (extra.json).

import zapp from "./zapp.json";
import extra from "./extra.json";

type Table = Record<string, Record<string, string>>;
const tables: Table = { ...(zapp as Table), ...(extra as Table) };

export const LANGUAGES = ["en", "fr", "es", "it", "pt-BR", "de", "ru", "uk", "zh-Hans", "ja", "ko", "ar", "th"];

const FLAGS: Record<string, string> = {
  en: "gb", fr: "fr", es: "es", it: "it", "pt-BR": "br", de: "de", ru: "ru", uk: "ua", "zh-Hans": "cn", ja: "jp", ko: "kr", ar: "sa", th: "th",
};

let current = "en";

/** The language in use: the one chosen; English until one is (as ZApp). */
export function effective(chosen: string): string {
  return chosen || "en";
}

/** The browser's language, if ZApp speaks it (to suggest it). */
export function browserLanguage(): string {
  for (const pref of navigator.languages) {
    const code = LANGUAGES.find((c) => pref === c || pref.startsWith(c + "-") || c.startsWith(pref));
    if (code) return code;
    const base = pref.split("-")[0];
    const b = LANGUAGES.find((c) => c === base || c.startsWith(base + "-"));
    if (b) return b;
  }
  return "en";
}

export function setLanguage(code: string) {
  current = code;
  document.documentElement.lang = code;
  document.documentElement.dir = isRTL(code) ? "rtl" : "ltr";
}

export const language = () => current;
export const isRTL = (code = current) => code === "ar";
export const flag = (code: string) => FLAGS[code] ?? "gb";

/** "Français", "日本語": each language in its own words. */
export function languageName(code: string, inLanguage = code): string {
  try {
    const n = new Intl.DisplayNames([inLanguage], { type: "language" }).of(code) ?? code;
    return n.charAt(0).toLocaleUpperCase(inLanguage) + n.slice(1);
  } catch {
    return code;
  }
}

/**
 * The text in the current language, with %@ / %lld / %d / %1$@ replaced by `args` in order
 * (the Swift catalog's placeholders).
 */
export function t(key: string, ...args: (string | number)[]): string {
  const s = current === "en" ? key : tables[key]?.[current] ?? key;
  let i = 0;
  return s.replace(/%(?:(\d+)\$)?(?:@|lld|ld|d|f|\.\d+f)/g, (_m, pos) => {
    const v = pos ? args[Number(pos) - 1] : args[i++];
    return v === undefined ? "" : String(v);
  }).replace(/%%/g, "%");
}

export function locale(): string {
  return current === "zh-Hans" ? "zh-CN" : current;
}

export function formatDate(seconds: number, style: "long" | "short" | "day" = "long"): string {
  const d = new Date(seconds * 1000);
  const opts: Intl.DateTimeFormatOptions =
    style === "day" ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : style === "short" ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "long", timeStyle: "short" };
  return new Intl.DateTimeFormat(locale(), opts).format(d);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(locale()).format(n);
}

export function currencyName(code: string): string {
  try {
    const n = new Intl.DisplayNames([locale()], { type: "currency" }).of(code.toUpperCase()) ?? code.toUpperCase();
    return n.charAt(0).toLocaleUpperCase(locale()) + n.slice(1);
  } catch {
    return code.toUpperCase();
  }
}

/** "≈ €12.34" style amount of `zatoshi` at `price`. */
export function formatFiat(zatoshi: number, price: number | undefined, code: string): string | null {
  if (price === undefined) return null;
  const value = (zatoshi / 1e8) * price;
  return new Intl.NumberFormat(locale(), {
    style: "currency",
    currency: code.toUpperCase(),
    maximumFractionDigits: value !== 0 && Math.abs(value) < 0.01 ? 4 : 2,
  }).format(value);
}
