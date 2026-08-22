// v1.14.0 — React binding for the i18n engine.
//
// Subscribes to language changes so every component re-renders when the
// language switches, without a provider or a page reload.
import { useEffect, useState, useCallback } from 'react';
import { t as translate, getLanguage, onLanguageChange, type LanguageCode } from '@/lib/i18n';

export function useTranslation() {
  const [lang, setLang] = useState<LanguageCode>(getLanguage());

  useEffect(() => onLanguageChange(() => setLang(getLanguage())), []);

  // Recreated on language change so memoised children re-render too.
  const t = useCallback(
    (key: string, fallback?: string, vars?: Record<string, string | number>) =>
      translate(key, fallback, vars),
    [lang],
  );

  return { t, lang };
}
