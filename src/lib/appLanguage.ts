// Which language the phone apps speak, and when the phrase layer runs (v1.112.0).
// The language itself is the software's own setting (lib/i18n, saved on this device); the apps offer two choices — English and
// اردو — and the layer only runs INSIDE the Owner, Rider and Order Taker apps, so the till and the website are never touched.
import { getLanguage, initLanguage, setLanguage, onLanguageChange } from '@/lib/i18n';
import { appSplashKind } from '@/lib/appEntry';
import { disablePhraseLayer, enablePhraseLayer, isPhraseLayerOn } from '@/lib/phraseTranslate';
import { PHRASES_UR } from '@/lib/phrasesUr';

export type AppLang = 'en' | 'ur';
export const APP_LANGS: ReadonlyArray<{ id: AppLang; label: string }> = [{ id: 'en', label: 'English' }, { id: 'ur', label: 'اردو' }];

export const appLanguage = (): AppLang => (getLanguage() === 'ur' ? 'ur' : 'en');

/** Run the layer exactly when this is an app and the language is Urdu. Cheap to call any number of times. */
export function syncPhraseLayer(): void {
  const want = appSplashKind() !== null && getLanguage() === 'ur';
  if (want && !isPhraseLayerOn()) enablePhraseLayer(PHRASES_UR);
  else if (!want && isPhraseLayerOn()) disablePhraseLayer();
}

export function setAppLanguage(lang: AppLang): void {
  setLanguage(lang);          // also sets <html lang> and dir (right-to-left for Urdu)
  syncPhraseLayer();
}

/** Called once by the app shell: follows the language and the route from now on. Returns the cleanup. */
export function startAppLanguage(): () => void {
  if (appSplashKind() !== null) initLanguage();        // bring back the language this phone was left on (and the page direction with it)
  syncPhraseLayer();
  const off = onLanguageChange(syncPhraseLayer);
  window.addEventListener('hashchange', syncPhraseLayer);
  return () => { off(); window.removeEventListener('hashchange', syncPhraseLayer); disablePhraseLayer(); };
}
