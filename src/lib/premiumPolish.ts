// ============================================================
// Premium Polish (surface finish) — device-local on/off toggle.
// Adds `data-premium-polish="on"` on <html> so index.css can
// apply softer shadows, subtle bg wash, focus ring & button lift.
// No structural / colour change; safe on every theme.
// ============================================================
const KEY = 'dtpos-premium-polish';

export function isPremiumPolishOn(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function applyPremiumPolish(on: boolean = isPremiumPolishOn()) {
  if (typeof document === 'undefined') return;
  try {
    if (on) document.documentElement.setAttribute('data-premium-polish', 'on');
    else document.documentElement.removeAttribute('data-premium-polish');
  } catch {}
}

export function setPremiumPolish(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {}
  applyPremiumPolish(on);
  try { window.dispatchEvent(new CustomEvent('dtpos-premium-polish-changed', { detail: { on } })); } catch {}
}