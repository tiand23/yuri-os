import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale } from './i18n';

interface I18nStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nStore>()(
  persist(
    (set) => ({
      locale: 'zh',
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'yuri-locale' }
  )
);
