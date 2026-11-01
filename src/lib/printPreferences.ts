// ============================================================
// Device-level print preferences (offline, per computer).
//
//  • Print Preview  — ON hone par paid bill seedha print nahi hoga;
//    pehle screen par preview aayega aur Print button dabane par nikle ga.
//  • Print Retry    — silent print fail ho jaye to kitni baar dobara try
//    kare (thermal printer red light / reconnect ke baad stability).
// ============================================================

const PREVIEW_KEY = 'dtpos-print-preview-enabled';
const RETRY_KEY = 'dtpos-print-retry-count';

export function isPrintPreviewEnabled(): boolean {
  try { return localStorage.getItem(PREVIEW_KEY) === '1'; } catch { return false; }
}

export function setPrintPreviewEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(PREVIEW_KEY, '1');
    else localStorage.removeItem(PREVIEW_KEY);
    window.dispatchEvent(new CustomEvent('dtpos-print-prefs-changed'));
  } catch { /* storage unavailable */ }
}

/** How many extra attempts after the first silent print fails (0–3). */
export function getPrintRetryCount(): number {
  try {
    const raw = Number(localStorage.getItem(RETRY_KEY));
    if (!Number.isFinite(raw)) return 1;
    return Math.max(0, Math.min(3, Math.round(raw)));
  } catch { return 1; }
}

export function setPrintRetryCount(n: number) {
  try {
    localStorage.setItem(RETRY_KEY, String(Math.max(0, Math.min(3, Math.round(n)))));
    window.dispatchEvent(new CustomEvent('dtpos-print-prefs-changed'));
  } catch { /* storage unavailable */ }
}

export function onPrintPrefsChange(handler: () => void): () => void {
  window.addEventListener('dtpos-print-prefs-changed', handler);
  return () => window.removeEventListener('dtpos-print-prefs-changed', handler);
}
