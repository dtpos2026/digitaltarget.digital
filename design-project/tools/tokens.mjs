// The ecosystem's design tokens — one set for all five products. Only the accent differs per product.
// Colours are the brand's (src/lib/brand.ts) and the apps' icon colours; semantic colours are fixed.
export const TOKENS = {
  font: { ui: "Inter, 'Segoe UI', system-ui, sans-serif", mono: "'JetBrains Mono', ui-monospace, Consolas, monospace" },
  brand: { purpleDeep: '#3c096c', purple: '#5b21b6', purpleLight: '#7c3aed', lavender: '#f3effc', ink: '#1a1523', muted: '#6b6478' },
  accent: { // one per product (the mid colour of the app's icon)
    software: { name: 'DT POS software', hex: '#5b21b6', deep: '#3c096c', tint: '#f3effc' },
    owner:    { name: 'Owner app',       hex: '#5b21b6', deep: '#3c096c', tint: '#f3effc' },
    customer: { name: 'Customer web + app', hex: '#b91c1c', deep: '#7f1d1d', tint: '#fef2f2' },
    rider:    { name: 'Rider app',       hex: '#c2410c', deep: '#7c2d12', tint: '#fff7ed' },
    ordertaker: { name: 'Order Taker app', hex: '#0f766e', deep: '#134e4a', tint: '#f0fdfa' },
  },
  semantic: { success: '#15803d', successBg: '#dcfce7', warning: '#b45309', warningBg: '#fef3c7', danger: '#dc2626', dangerBg: '#fee2e2', info: '#1d4ed8', infoBg: '#dbeafe' },
  light: { bg: '#f7f5fb', surface: '#ffffff', surface2: '#f3effc', border: '#e4def0', text: '#1a1523', muted: '#6b6478', faint: '#9a93a8' },
  dark:  { bg: '#0f0b18', surface: '#1a1426', surface2: '#241c35', border: '#352b4a', text: '#f4f1fa', muted: '#b4aac6', faint: '#7d7391' },
  space: [0, 4, 8, 12, 16, 20, 24, 32, 40, 56, 72],
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  shadow: { card: '0 1px 2px rgba(26,21,35,.06), 0 4px 14px rgba(26,21,35,.06)', pop: '0 12px 36px rgba(26,21,35,.18)', focus: '0 0 0 3px rgba(91,33,182,.25)' },
  type: [ // role, size/line, weight
    ['display', '36/44', 800], ['h1', '28/36', 800], ['h2', '22/30', 700], ['h3', '18/26', 700], ['body-lg', '16/24', 500], ['body', '14/22', 500],
    ['caption', '12/18', 500], ['overline', '11/16', 700, 'uppercase, +0.14em'], ['mono', '13/20', 500],
  ],
  motion: { fast: '120ms', base: '200ms', slow: '320ms', ease: 'cubic-bezier(.2,.8,.2,1)' },
  touch: { minTarget: 44, phoneButton: 52, desktopControl: 40 },
};
