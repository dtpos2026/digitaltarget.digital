// English | اردو — the language choice of the three phone apps (v1.112.0). `row` draws it as a line of a profile list;
// the plain form is the small switch on a sign-in screen. The two names are never translated.
import { useEffect, useState } from 'react';
import { Languages } from 'lucide-react';
import { onLanguageChange } from '@/lib/i18n';
import { APP_LANGS, appLanguage, setAppLanguage, type AppLang } from '@/lib/appLanguage';
import { cn } from '@/lib/utils';

export default function AppLanguageSwitch({ row, onDark }: { row?: boolean; onDark?: boolean }) {
  const [lang, setLang] = useState<AppLang>(appLanguage);
  useEffect(() => onLanguageChange(() => setLang(appLanguage())), []);
  const group = (
    <div role="radiogroup" aria-label="Language" data-app-language-switch translate="no"
      className={cn('inline-flex rounded-full p-1 text-[13px] font-bold', onDark ? 'bg-white/20' : 'bg-muted')}>
      {APP_LANGS.map(l => (
        <button key={l.id} type="button" role="radio" aria-checked={lang === l.id} data-lang={l.id} onClick={() => setAppLanguage(l.id)}
          className={cn('min-w-[4.5rem] rounded-full px-3 py-1.5 transition-colors', lang === l.id ? (onDark ? 'bg-white text-primary shadow-sm' : 'bg-card text-foreground shadow-sm') : (onDark ? 'text-white/85' : 'text-muted-foreground'))}>
          {l.label}
        </button>
      ))}
    </div>
  );
  if (!row) return <div className="flex justify-center">{group}</div>;
  return (
    <div className="flex items-center gap-3 py-3" data-app-language-row>
      <Languages className="h-5 w-5 text-muted-foreground" aria-hidden />
      <span className="flex-1 text-[15px]">Language</span>
      {group}
    </div>
  );
}
