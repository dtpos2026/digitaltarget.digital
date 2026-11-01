import * as U from './lib.mjs';
const { shell, pageHead, chip, tableHtml, card, icon, btn } = U;
/** A standard list page: header, search + filter chips, table, optional right panel. */
export function L({ active, title, sub, actions = [], chips = [], cols, rows, sel, panel, top, theme }) {
  return shell(active, title, `${pageHead(title, sub, actions)}${top || ''}<div class="row wrap"><span class="search" style="min-width:300px">${icon('Search', 16)}Search ${title.toLowerCase()}…</span>${chips.map((c, i) => chip(c, { on: i === 0 })).join('')}</div><div style="display:flex;gap:16px;flex:1;min-height:0"><div class="card p0 grow" style="overflow:hidden">${tableHtml(cols, rows, { sel })}</div>${panel ? `<div class="card" style="width:360px;overflow:hidden">${panel}</div>` : ''}</div>`, { theme });
}
export const kv = (k, v) => `<div class="row between" style="padding:6px 0"><span class="muted">${k}</span><b>${v}</b></div>`;
