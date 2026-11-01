// Which hash routes belong to people who are not signed-in staff: the customer ordering site, order tracking, and the
// Rider / Order Taker portals (the phone apps open straight into them), plus password reset. They are not the POS, so
// they do not get the POS's splash, and they paint their own colours. No imports, so the document head can use the list.
export const PUBLIC_PREFIXES = ['#/order', '#/track', '#/rider-portal', '#/order-taker', '#/reset-password', '#/verify'] as const;

export function isPublicTenantRoute(hash?: string): boolean {
  const h = hash ?? (typeof window !== 'undefined' ? window.location.hash : '');
  return PUBLIC_PREFIXES.some(p => h.startsWith(p));
}
