// Sidebar labels that follow the app language (src/lib/i18n). Shared by the
// Classic and the Modern sidebar and by the module launcher.
import { t as tr } from '@/lib/i18n';

const NAV_I18N: Record<string, string> = {
  'reports': 'reports', 'reports-center': 'reports', 'settings': 'settings',
  'token-module': 'tokenModule', 'printer-settings': 'printingCenter', 'tables': 'tables',
  'running-bills': 'runningBills', 'retray': 'retrieve', 'menu-manager': 'menu',
};

export function navTitle(key: string, fallback: string): string {
  const k = NAV_I18N[key];
  if (!k) return fallback;
  const v = tr(k);
  return v === k ? fallback : v;
}
