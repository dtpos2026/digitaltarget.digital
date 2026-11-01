import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Lucide from 'lucide-react';
import { BRAND, MARK_TRIANGLES } from '../../src/lib/brand.ts';

// ------------------------------------------------------------------ icons
const missing = new Set();
export function icon(name, size = 18, stroke = 2) {
  const C = Lucide[name];
  if (!C) { missing.add(name); return icon('Circle', size, stroke); }
  return renderToStaticMarkup(createElement(C, { size, strokeWidth: stroke }));
}
export const missingIcons = () => [...missing];
export const mark = (size = 20, fill = 'currentColor') => `<svg width="${size}" height="${size}" viewBox="0 0 2 2" fill="${fill}">${MARK_TRIANGLES.map(p => `<polygon points="${p}"/>`).join('')}</svg>`;

// ------------------------------------------------------------------ small pieces
export const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const btn = (label, o = {}) => `<span class="btn ${o.kind || ''} ${o.size || ''} ${o.block ? 'block' : ''}">${o.icon ? icon(o.icon, o.size === 'sm' ? 14 : 16) : ''}${label ? esc(label) : ''}${o.after ? icon(o.after, 16) : ''}</span>`;
export const ibtn = (name, o = {}) => `<span class="btn icon ${o.kind || ''} ${o.size || ''}">${icon(name, 18)}</span>`;
export const chip = (label, o = {}) => `<span class="chip ${o.on ? 'on' : ''} ${o.soft ? 'soft' : ''}">${o.icon ? icon(o.icon, 14) : ''}${esc(label)}</span>`;
export const badge = (label, kind = '') => `<span class="badge ${kind}">${esc(label)}</span>`;
export const avatar = (txt, o = '') => `<span class="avatar ${o}">${esc(txt)}</span>`;
export const input = (label, value, o = {}) => `<div>${label ? `<span class="label">${esc(label)}</span>` : ''}<div class="input ${o.focus ? 'focus' : ''} ${o.err ? 'err' : ''}">${o.icon ? icon(o.icon, 16) : ''}<span class="grow ${value ? '' : 'muted'}" style="${value ? 'color:var(--text)' : ''}">${esc(value || o.placeholder || '')}</span>${o.after ? icon(o.after, 16) : ''}</div>${o.hint ? `<div class="hint ${o.err ? 'err' : ''}">${esc(o.hint)}</div>` : ''}</div>`;
export const toggle = on => `<span class="toggle ${on ? 'on' : ''}"></span>`;
export const check = on => `<span class="check ${on ? 'on' : ''}">${on ? icon('Check', 13, 3) : ''}</span>`;
export const radio = on => `<span class="radio ${on ? 'on' : ''}"></span>`;
export const card = (body, cls = '') => `<div class="card ${cls}">${body}</div>`;
export const seg = (items, on = 0) => `<span class="seg">${items.map((t, i) => `<span class="${i === on ? 'on' : ''}">${esc(t)}</span>`).join('')}</span>`;
export const tabs = (items, on = 0) => `<div class="tabs">${items.map((t, i) => `<span class="tab ${i === on ? 'on' : ''}">${esc(t)}</span>`).join('')}</div>`;
export const progress = pct => `<div class="progress"><i style="width:${pct}%"></i></div>`;
export const ph = (iconName = 'Utensils', w = 56, h = 56, s = '') => { const px = v => typeof v === 'number' ? v + 'px' : v; const side = Math.min(typeof w === 'number' ? w : 120, typeof h === 'number' ? h : 120); return `<div class="ph ${s}" style="width:${px(w)};height:${px(h)};flex:none">${icon(iconName, Math.round(side * 0.45), 1.8)}</div>`; };
export const skel = (w = '100%', h = 14) => `<div class="skel" style="width:${w};height:${h}px"></div>`;
export const money = n => 'Rs ' + Number(n).toLocaleString('en-PK');
export const kpi = (iconName, label, value, delta, good = true) => card(`<div class="row between"><span class="t-cap b">${esc(label)}</span><span class="ic kpi-ic">${''}</span></div>`.replace('<span class="ic kpi-ic"></span>', `<span class="kpi"><span class="ic">${icon(iconName, 18)}</span></span>`) + `<div class="kpi"><span class="v">${esc(value)}</span>${delta ? `<span class="d ${good ? 'ok' : 'bad'}">${esc(delta)}</span>` : ''}</div>`);
export const empty = (iconName, title, text, action) => `<div class="empty"><div class="ill">${icon(iconName, 36, 1.6)}</div><div class="t-h3" style="color:var(--text)">${esc(title)}</div><div style="max-width:300px">${esc(text)}</div>${action ? btn(action, { kind: 'primary' }) : ''}</div>`;
export const banner = (kind, text, iconName = 'AlertCircle') => `<div class="banner ${kind}">${icon(iconName, 18)}<span>${esc(text)}</span></div>`;
export const gap = txt => `<span class="tag-gap">${icon('Construction', 12)} ${esc(txt)}</span>`;
export const statusBadge = s => {
  const m = { running: ['Running', 'info'], hold: ['Hold', 'warn'], paid: ['Paid', 'ok'], partial: ['Partial', 'warn'], void: ['Void', 'bad'], cancelled: ['Cancelled', 'bad'], pending_approval: ['Awaiting approval', 'warn'], rejected: ['Rejected', 'bad'], credit_pending: ['Credit pending', 'warn'], complimentary: ['Complimentary', 'acc'],
    pending: ['Pending', 'warn'], accepted: ['Accepted', 'info'], cooking: ['Cooking', 'info'], ready: ['Ready', 'ok'], rider_assigned: ['Rider assigned', 'acc'], rider_picked: ['Picked up', 'acc'], onway: ['On the way', 'acc'], rider_reached: ['Reached', 'ok'], delivered: ['Delivered', 'ok'] };
  const [l, k] = m[s] || [s, '']; return badge(l, k);
};

// ------------------------------------------------------------------ charts (inline SVG, deterministic sample data)
export function line(values, { w = 560, h = 180, color = 'var(--accent)', fill = true, labels = [] } = {}) {
  const max = Math.max(...values) * 1.1, min = 0, n = values.length, pad = 8;
  const pts = values.map((v, i) => [pad + i * (w - 2 * pad) / (n - 1), h - 22 - (v - min) / (max - min) * (h - 40)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const grid = [0, 1, 2, 3].map(i => `<line x1="0" x2="${w}" y1="${10 + i * (h - 40) / 3}" y2="${10 + i * (h - 40) / 3}" stroke="var(--border)" stroke-dasharray="3 4"/>`).join('');
  const lab = labels.map((l, i) => `<text x="${pad + i * (w - 2 * pad) / (labels.length - 1)}" y="${h - 4}" font-size="10.5" fill="var(--faint)" text-anchor="middle">${esc(l)}</text>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${grid}${fill ? `<path d="${d} L${pts.at(-1)[0]} ${h - 22} L${pts[0][0]} ${h - 22} Z" fill="${color}" opacity=".12"/>` : ''}<path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>${pts.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="2.6" fill="${color}"/>`).join('')}${lab}</svg>`;
}
export function bars(values, { w = 560, h = 180, color = 'var(--accent)', labels = [] } = {}) {
  const max = Math.max(...values) * 1.15, n = values.length, bw = (w - 20) / n;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${[0, 1, 2, 3].map(i => `<line x1="0" x2="${w}" y1="${10 + i * (h - 40) / 3}" y2="${10 + i * (h - 40) / 3}" stroke="var(--border)" stroke-dasharray="3 4"/>`).join('')}${values.map((v, i) => { const bh = v / max * (h - 40); return `<rect x="${10 + i * bw + bw * 0.18}" y="${h - 22 - bh}" width="${bw * 0.64}" height="${bh}" rx="5" fill="${color}" opacity="${i === n - 1 ? 1 : 0.55}"/>`; }).join('')}${labels.map((l, i) => `<text x="${10 + i * bw + bw / 2}" y="${h - 4}" font-size="10.5" fill="var(--faint)" text-anchor="middle">${esc(l)}</text>`).join('')}</svg>`;
}
export function donut(parts, { size = 140 } = {}) {
  const cols = ['var(--accent)', '#0f766e', '#c2410c', '#1d4ed8', '#9a93a8']; const tot = parts.reduce((s, p) => s + p[1], 0); let a = -90;
  const r = 52, c = 2 * Math.PI * r, arcs = parts.map((p, i) => { const frac = p[1] / tot; const dash = frac * c; const rot = a; a += frac * 360; return `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${cols[i % 5]}" stroke-width="20" stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" transform="rotate(${rot.toFixed(1)} 70 70)"/>`; }).join('');
  return `<div class="row g16"><svg width="${size}" height="${size}" viewBox="0 0 140 140"><circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="20"/>${arcs}</svg><div class="col g4">${parts.map((p, i) => `<div class="row"><span style="width:10px;height:10px;border-radius:3px;background:${cols[i % 5]}"></span><span class="t-cap" style="color:var(--text)">${esc(p[0])}</span><span class="t-cap b">${Math.round(p[1] / tot * 100)}%</span></div>`).join('')}</div></div>`;
}
export const spark = (vals, color = 'var(--accent)') => line(vals, { w: 120, h: 36, color, fill: false });

// map placeholder: stylised roads, a route, pins — "Google Maps SDK renders here" (no tiles are fabricated)
export function map(w, h, { route = true, pins = [], label = true } = {}) {
  const roads = `<path d="M0 ${h * .3} C ${w * .3} ${h * .2} ${w * .6} ${h * .45} ${w} ${h * .35}" stroke="#fff" stroke-width="14" fill="none"/><path d="M${w * .25} 0 C ${w * .3} ${h * .4} ${w * .2} ${h * .7} ${w * .35} ${h}" stroke="#fff" stroke-width="12" fill="none"/><path d="M0 ${h * .75} C ${w * .4} ${h * .65} ${w * .7} ${h * .85} ${w} ${h * .7}" stroke="#fff" stroke-width="10" fill="none"/><path d="M${w * .7} 0 L ${w * .62} ${h}" stroke="#fff" stroke-width="9" fill="none"/>`;
  const r = route ? `<path d="M${w * .22} ${h * .78} C ${w * .3} ${h * .5} ${w * .5} ${h * .55} ${w * .62} ${h * .4} S ${w * .8} ${h * .25} ${w * .84} ${h * .2}" stroke="var(--accent)" stroke-width="5" fill="none" stroke-linecap="round" stroke-dasharray="1 0"/>` : '';
  const pin = (x, y, c, ic) => `<g transform="translate(${x} ${y})"><circle r="15" fill="${c}"/><circle r="15" fill="none" stroke="#fff" stroke-width="3"/></g>`;
  return `<div class="map" style="width:${w === '100%' ? '100%' : w + 'px'};height:${h}px"><svg viewBox="0 0 ${w === '100%' ? 360 : w} ${h}" preserveAspectRatio="xMidYMid slice">${roads}${r}${pins.map(p => pin(p[0] * (w === '100%' ? 360 : w), p[1] * h, p[2])).join('')}</svg>${label ? `<span class="note" style="position:absolute;left:10px;bottom:6px;background:rgba(255,255,255,.8);padding:1px 6px;border-radius:6px;color:#555">map area · Google Maps SDK</span>` : ''}</div>`;
}

// ------------------------------------------------------------------ frames
const sbar = (dark = false) => `<div class="sb"><span>9:41</span><span class="row g4">${icon('Signal', 14)}${icon('Wifi', 14)}${icon('BatteryFull', 16)}</span></div>`;
export function phone(body, { tab, tabs: items, theme, accent, overlay, noStatus } = {}) {
  const tb = items ? `<div class="tabbar">${items.map((t, i) => `<div class="${i === tab ? 'on' : ''}">${icon(t[1], 22)}<span>${esc(t[0])}</span></div>`).join('')}</div>` : '';
  return `<div class="phone" data-theme="${theme || 'light'}" data-accent="${accent || ''}">${noStatus ? '' : sbar()}<div class="scr">${body}${overlay || ''}</div>${tb}</div>`;
}
export const appbar = (title, o = {}) => `<div class="appbar">${o.back ? ibtn('ChevronLeft', { size: 'sm' }) : ''}<h1>${esc(title)}</h1>${(o.right || []).map(r => typeof r === 'string' ? ibtn(r, { size: 'sm' }) : r.html).join('')}</div>`;
export const sheet = body => `<div class="scrim"></div><div class="sheet">${body}</div>`;

export function desktop(content, { theme, accent, kind = '', width } = {}) { return `<div class="desk ${kind}" data-theme="${theme || 'light'}" data-accent="${accent || ''}" ${width ? `style="width:${width}px"` : ''}>${content}</div>`; }

// the software's shell: sidebar grouped as in the real module list (src/lib/permissions.ts), top bar with branch, search, sync, alerts, user
export const MODULE_GROUPS = [
  ['Operations', [['POS', 'ShoppingCart'], ['Tables', 'LayoutGrid'], ['Retrieve', 'Receipt'], ['Delivery', 'Bike'], ['Pickup Orders', 'ShoppingBag'], ['Kitchen', 'ChefHat'], ['Online Order Approval', 'BadgeCheck', 3], ['Credits / Udhaar', 'HandCoins'], ['Refund', 'Undo2'], ['Tokens', 'Ticket']]],
  ['Marketing', [['Customers', 'Users'], ['CRM Insights', 'Sparkles'], ['Promo Codes', 'Percent'], ['WhatsApp', 'MessageCircle'], ['Customer Portal / Website', 'Globe']]],
  ['Inventory', [['Menu', 'UtensilsCrossed'], ['Deals / Combos', 'Layers'], ['Inventory', 'Package'], ['Recipes', 'BookOpen'], ['Wastage', 'Trash2'], ['Receiving', 'Truck']]],
  ['Accounts', [['Accounts', 'Wallet'], ['Party Master', 'Contact'], ['Daily Wages', 'Banknote'], ['Shift & Cash Drawer', 'Landmark']]],
  ['Staff', [['HR', 'IdCard'], ['Users', 'UserCog'], ['Riders', 'Bike'], ['Staff Audit Log', 'ScrollText']]],
  ['Reports', [['Dashboard', 'LayoutDashboard'], ['Reports Center', 'BarChart3'], ['Profitability', 'TrendingUp'], ['Owner Management', 'Crown']]],
  ['Admin', [['Settings', 'Settings'], ['Printing Center', 'Printer'], ['Branches', 'Building2'], ['Devices', 'MonitorSmartphone'], ['Backup', 'DatabaseBackup'], ['Module Management', 'Boxes']]],
];
export function sidebar(active, { collapsed = false } = {}) {
  if (collapsed) return `<div class="side col1"><div class="row" style="height:44px;color:var(--accent)">${mark(30)}</div>${MODULE_GROUPS.flatMap(g => g[1]).map(m => `<div class="nav ${m[0] === active ? 'on' : ''}" style="width:44px;justify-content:center;padding:0" title="${esc(m[0])}">${icon(m[1], 19)}</div>`).slice(0, 15).join('')}</div>`;
  const openGroup = (MODULE_GROUPS.find(([, items]) => items.some(m => m[0] === active)) || [MODULE_GROUPS[0][0]])[0];
  return `<div class="side"><div class="row" style="height:44px;padding:0 8px;color:var(--accent);margin-bottom:6px">${mark(28)}<div style="line-height:1.05;font-weight:700;color:var(--text);font-size:13px"><div>DT POS</div><div style="color:var(--muted);font-weight:600;font-size:11px">Enterprise</div></div><span class="grow"></span>${icon('PanelLeftClose', 16)}</div>${MODULE_GROUPS.map(([g, items]) => g === openGroup
    ? `<div class="grp row" style="padding-right:10px">${esc(g)}<span class="grow"></span>${icon('ChevronUp', 14)}</div>${items.map(m => `<div class="nav ${m[0] === active ? 'on' : ''}">${icon(m[1], 18)}<span>${esc(m[0])}</span>${m[2] ? `<span class="pill-n">${m[2]}</span>` : ''}</div>`).join('')}`
    : `<div class="nav" style="height:34px">${icon(items[0][1], 18)}<span style="font-weight:700">${esc(g)}</span><span class="badge" style="margin-left:auto">${items.length}</span>${icon('ChevronRight', 14)}</div>`).join('')}<span class="grow"></span><div class="card flat row" style="padding:10px;margin:6px 2px 0"><span class="dot"></span><div class="col" style="gap:0;line-height:1.2"><b style="font-size:12.5px">Online</b><span class="t-cap">Offline-ready · queue empty</span></div></div></div>`;
}
export const topbar = (title, o = {}) => `<div class="top"><div class="t-h3">${esc(title)}</div>${o.crumb ? `<span class="t-cap">${esc(o.crumb)}</span>` : ''}<span class="grow"></span><span class="search">${icon('Search', 16)}Search modules, bills, customers…<span class="badge" style="margin-left:auto">Ctrl K</span></span><span class="chip">${icon('Building2', 14)}Main Branch${icon('ChevronDown', 14)}</span><span class="sync">${icon('CloudCheck', 14)}Synced 12 s ago</span>${ibtn('Bell', { size: 'sm' })}<span class="row g4">${avatar('AK', 'sm')}<span class="col" style="gap:0;line-height:1.15"><span class="b" style="font-size:13px">Admin</span><span class="t-cap">Workspace DT-4821</span></span></span></div>`;
export function shell(active, title, page, o = {}) { return desktop(`${sidebar(active, o)}<div class="main">${topbar(title, o)}<div class="page">${page}</div></div>`, o); }

// generic list page: toolbar + filter chips + table
export function tableHtml(cols, rows, { sel } = {}) { return `<table class="tbl"><thead><tr>${cols.map(c => `<th class="${c.r ? 'r' : ''}">${esc(c.h || c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${sel === i ? 'sel' : ''}">${r.map((v, j) => `<td class="${cols[j].r ? 'r' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
export const pageHead = (title, sub, actions = []) => `<div class="row between"><div><div class="t-h1" style="font-size:24px;line-height:32px">${esc(title)}</div>${sub ? `<div class="t-cap">${esc(sub)}</div>` : ''}</div><div class="row">${actions.join('')}</div></div>`;
export const lorem = ['Sample'];
export const lockup = (size = 28, color = 'currentColor') => `<span class="row g12" style="color:${color}">${mark(size)}<span style="line-height:1;font-weight:700;font-size:${size * .45}px;letter-spacing:.4px"><div>${BRAND.wordmark[0]}</div><div style="margin-top:2px">${BRAND.wordmark[1]}</div></span></span>`;
