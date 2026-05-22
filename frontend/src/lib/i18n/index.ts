export type Locale = 'zh' | 'ja' | 'en';

export const LOCALES: { value: Locale; label: string; flag: string }[] = [
  { value: 'zh', label: '中文', flag: '🇨🇳' },
  { value: 'ja', label: '日本語', flag: '🇯🇵' },
  { value: 'en', label: 'English', flag: '🇺🇸' },
];

// Simple template interpolation: t('hello {name}', { name: 'world' }) → 'hello world'
export function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v)),
    str
  );
}
