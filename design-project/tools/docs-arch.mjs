import { node, edge, text, lane, legend } from './svg.mjs';
const n = (id, x, y, label, kind = 'screen', sub, extra = {}) => ({ id, x, y, label, kind, sub, w: 168, h: 66, ...extra });
const clients = [
  n('win', 24, 96, 'Windows POS', 'screen', 'Electron shell · offline store + sync queue'),
  n('web', 204, 96, 'Web POS', 'screen', 'browser · same app'),
  n('site', 384, 96, 'Customer website', 'screen', '#/order · #/track'),
  n('capp', 564, 96, 'Future customer app', 'gap', 'parked · branded, multi-restaurant'),
  n('rider', 744, 96, 'Rider app', 'screen', '#/rider-portal · Android'),
  n('taker', 924, 96, 'Order Taker app', 'screen', '#/order-taker · Android'),
  n('owner', 1104, 96, 'Owner app', 'screen', 'phone · same login as owner'),
  n('sa', 1284, 96, 'Super Admin', 'screen', 'licences · portfolio'),
];
const edgeHost = n('cf', 24, 232, 'Cloudflare Pages (project dt-pos)', 'system', 'serves the app · runs the TanStack Start server functions', { w: 1428, h: 58 });
const supa = [
  n('auth', 24, 392, 'Auth', 'system', 'owner · staff · super admin sign-in', { w: 262 }),
  n('db', 310, 392, 'Postgres', 'system', 'every row carries tenant_id · RLS decides who sees what', { w: 340 }),
  n('rpc', 674, 392, 'RPC functions', 'system', 'public_place_order · track_order · staff_portal_* · portal_my_history', { w: 400 }),
  n('rt', 1098, 392, 'Realtime', 'system', 'order and delivery changes', { w: 170 }),
  n('st', 1292, 392, 'Storage', 'system', 'logos · item images', { w: 160 }),
];
const ext = [
  n('maps', 24, 560, 'Google Maps', 'ext', 'links for navigation · map SDK in apps', { w: 200 }),
  n('wa', 248, 560, 'WhatsApp', 'ext', 'wa.me links (no API)', { w: 200 }),
  n('prn', 472, 560, 'Printers', 'ext', 'receipt · KOT · A4 via Windows', { w: 200 }),
  n('pra', 696, 560, 'PRA e-invoicing', 'gap', 'off by default · spec not verified', { w: 220 }),
  n('sms', 940, 560, 'SMS / OTP service', 'gap', 'not built', { w: 160 }),
  n('push', 1124, 560, 'Push (FCM)', 'gap', 'not built', { w: 150 }),
  n('pay', 1298, 560, 'Payment gateway', 'gap', 'not built', { w: 154 }),
];
const all = [...clients, edgeHost, ...supa, ...ext];
const byId = Object.fromEntries(all.map(x => [x.id, x]));
const bus = (y, label) => `<g><rect x="24" y="${y}" width="1428" height="28" rx="14" fill="#5b21b6"/>${text(738, y + 14, label, { size: 12, fill: '#fff', max: 140 })}</g>`;
export const ARCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1476 700" width="1476" height="700" font-family="Inter,Segoe UI,sans-serif"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#6b6478"/></marker></defs><rect width="100%" height="100%" fill="#fff"/>
<text x="24" y="30" font-size="20" font-weight="800" fill="#1a1523">Integration architecture — one cloud, many products</text><text x="24" y="50" font-size="12" fill="#6b6478">Solid = exists today · dashed amber = does not exist yet · every product reads and writes the same Supabase project (drpzxzpvkpqfxcjbwypo), kept apart by tenant_id</text>
${lane(12, 70, 1452, 120, 'Products (what people touch)')}${lane(12, 206, 1452, 100, 'Hosting')}${lane(12, 322, 1452, 150, 'Supabase — one project, many restaurants')}${lane(12, 488, 1452, 150, 'Outside services')}
${clients.map(c => node(c)).join('')}
${clients.map(c => edge(c, edgeHost, { from: 'b', to: 't' }).replace(' marker-end="url(#ah)"', '')).join('')}
${node(edgeHost)}
${bus(332, 'HTTPS · Supabase JS client · the caller\'s sign-in token + RLS decide what each product can read or write')}
${supa.map(node).join('')}
${node(byId.maps)}${node(byId.wa)}${node(byId.prn)}${node(byId.pra)}${node(byId.sms)}${node(byId.push)}${node(byId.pay)}
<path d="M738 290 L738 332" stroke="#6b6478" stroke-width="1.6" fill="none" marker-end="url(#ah)"/>
${legend(24, 664, [['screen', 'Exists today'], ['system', 'Platform / data'], ['ext', 'Outside service'], ['gap', 'Does not exist yet']])}
</svg>`;
