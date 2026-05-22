'use client';
import { useI18nStore } from './i18n-store';
import { interpolate } from './i18n';
import { zh } from './i18n/zh';
import { ja } from './i18n/ja';
import { en } from './i18n/en';

const translations = { zh, ja, en };

export function useT() {
  const locale = useI18nStore((s) => s.locale);
  const dict = translations[locale] as Record<string, string>;

  return function t(key: string, vars?: Record<string, string | number>): string {
    const str = dict[key] ?? (translations.zh as Record<string, string>)[key] ?? key;
    return interpolate(str, vars);
  };
}
