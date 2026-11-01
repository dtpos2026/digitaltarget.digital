// Tiny SVG diagram engine for the flow and architecture diagrams. Pure functions, no dependencies.
// Node kinds: start, screen, decision, system, end, gap (does not exist yet), lane (background band).
const C = {
  start: { fill: '#5b21b6', stroke: '#3c096c', text: '#fff' },
  screen: { fill: '#ffffff', stroke: '#b8aed0', text: '#1a1523' },
  system: { fill: '#f3effc', stroke: '#7c3aed', text: '#1a1523' },
  decision: { fill: '#fef3c7', stroke: '#b45309', text: '#1a1523' },
  end: { fill: '#dcfce7', stroke: '#15803d', text: '#14532d' },
  bad: { fill: '#fee2e2', stroke: '#dc2626', text: '#7f1d1d' },
  gap: { fill: '#fffbeb', stroke: '#b45309', text: '#78350f', dash: '6 4' },
  ext: { fill: '#f1f5f9', stroke: '#64748b', text: '#1e293b' },
};
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export function wrap(text, max) {
  const words = String(text).split(' '); const lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur); return lines;
}
export function text(x, y, str, { size = 13, weight = 600, fill = '#1a1523', anchor = 'middle', max = 22, lh = 1.25 } = {}) {
  const lines = wrap(str, max); const y0 = y - (lines.length - 1) * size * lh / 2 + size * .35;
  return `<text x="${x}" y="${y0}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="Inter,Segoe UI,sans-serif">${lines.map((l, i) => `<tspan x="${x}" dy="${i ? size * lh : 0}">${esc(l)}</tspan>`).join('')}</text>`;
}
export function node(n) {
  const k = C[n.kind || 'screen']; const w = n.w || 170, h = n.h || 60; const cx = n.x + w / 2, cy = n.y + h / 2;
  const dash = k.dash ? ` stroke-dasharray="${k.dash}"` : '';
  let shape;
  if (n.kind === 'decision') shape = `<polygon points="${cx},${n.y} ${n.x + w},${cy} ${cx},${n.y + h} ${n.x},${cy}" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.6"/>`;
  else if (n.kind === 'start' || n.kind === 'end') shape = `<rect x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="${h / 2}" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.6"/>`;
  else shape = `<rect x="${n.x}" y="${n.y}" width="${w}" height="${h}" rx="12" fill="${k.fill}" stroke="${k.stroke}" stroke-width="1.6"${dash}/>`;
  const sub = n.sub ? text(cx, cy + 12, n.sub, { size: 10.5, weight: 500, fill: n.kind === 'start' ? '#e9defc' : '#6b6478', max: Math.floor(w / 6) }) : '';
  return `<g data-id="${n.id}">${shape}${text(cx, n.sub ? cy - 8 : cy, n.label, { size: 12.5, fill: k.text, max: Math.floor(w / 7.2) })}${sub}</g>`;
}
const anchor = (n, side) => { const w = n.w || 170, h = n.h || 60; return { r: [n.x + w, n.y + h / 2], l: [n.x, n.y + h / 2], t: [n.x + w / 2, n.y], b: [n.x + w / 2, n.y + h] }[side]; };
export function edge(a, b, { label, from = 'r', to = 'l', dashed, color = '#6b6478', via } = {}) {
  const [x1, y1] = anchor(a, from), [x2, y2] = anchor(b, to); let d;
  if (via) d = `M${x1} ${y1} ` + via.map(p => `L${p[0]} ${p[1]}`).join(' ') + ` L${x2} ${y2}`;
  else if ((from === 'r' || from === 'l') && (to === 'l' || to === 'r')) { const mx = (x1 + x2) / 2; d = y1 === y2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} L${mx} ${y1} L${mx} ${y2} L${x2} ${y2}`; }
  else if (from === 'b' && to === 't') { const my = (y1 + y2) / 2; d = x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} L${x1} ${my} L${x2} ${my} L${x2} ${y2}`; }
  else if (from === 'b' && to === 'l') d = `M${x1} ${y1} L${x1} ${y2} L${x2} ${y2}`;
  else if (from === 'r' && to === 't') d = `M${x1} ${y1} L${x2} ${y1} L${x2} ${y2}`;
  else if (from === 'r' && to === 'b') d = `M${x1} ${y1} L${x2} ${y1} L${x2} ${y2}`;
  else if (from === 't' && to === 'b') d = x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} L${x1} ${(y1 + y2) / 2} L${x2} ${(y1 + y2) / 2} L${x2} ${y2}`;
  else d = `M${x1} ${y1} L${x2} ${y2}`;
  const lx = via ? (via[0][0] + x1) / 2 : (x1 + x2) / 2, ly = via ? (via[0][1] + y1) / 2 : (y1 + y2) / 2;
  const lab = label ? `<g><rect x="${lx - label.length * 3.2 - 5}" y="${ly - 9}" width="${label.length * 6.4 + 10}" height="16" rx="8" fill="#fff" stroke="#e4def0"/>${text(lx, ly, label, { size: 10.5, weight: 600, fill: '#4b4458', max: 40 })}</g>` : '';
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"${dashed ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#ah)"/>${lab}`;
}
export function lane(x, y, w, h, title, fill = '#faf8fe') {
  return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="${fill}" stroke="#e4def0"/><text x="${x + 14}" y="${y + 22}" font-size="11" font-weight="800" fill="#7d7391" stroke="#faf8fe" stroke-width="5" paint-order="stroke" letter-spacing="1.4" font-family="Inter,sans-serif">${esc(title.toUpperCase())}</text></g>`;
}
export function legend(x, y, items) {
  return items.map((it, i) => { const k = C[it[0]]; return `<g><rect x="${x + i * 170}" y="${y}" width="22" height="14" rx="4" fill="${k.fill}" stroke="${k.stroke}"${k.dash ? ` stroke-dasharray="${k.dash}"` : ''}/><text x="${x + i * 170 + 30}" y="${y + 11}" font-size="11" fill="#4b4458" font-family="Inter,sans-serif">${esc(it[1])}</text></g>`; }).join('');
}
// flow({ title, w, h, lanes, nodes, edges, legendItems })  — nodes carry absolute x/y
export function flow({ title, subtitle, w, h, lanes = [], nodes, edges, legendItems }) {
  const map = Object.fromEntries(nodes.map(n => [n.id, n]));
  const head = 64;
  const body = `${lanes.map(l => lane(...l)).join('')}${edges.map(e => edge(map[e[0]], map[e[1]], e[2] || {})).join('')}${nodes.map(node).join('')}`;
  const leg = legendItems ? legend(24, h + head - 8, legendItems) : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h + head + 24}" width="${w}" height="${h + head + 24}" font-family="Inter,Segoe UI,sans-serif"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#6b6478"/></marker></defs><rect width="100%" height="100%" fill="#ffffff"/><text x="24" y="30" font-size="20" font-weight="800" fill="#1a1523">${esc(title)}</text><text x="24" y="50" font-size="12" fill="#6b6478">${esc(subtitle || '')}</text><g transform="translate(0 ${head})">${body}</g>${leg ? `<g transform="translate(0 ${head})">${leg}</g>` : ''}</svg>`;
}
