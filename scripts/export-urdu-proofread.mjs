// Writes docs/qa/urdu-proofread-sheet.html — every English phrase next to its Urdu, by app, for someone who reads Urdu to check.
// A wrong phrase is one line in src/lib/phrasesUr.ts (or phrasesUrOwnerMore.ts). Run again afterwards to refresh the sheet.
//   node --experimental-strip-types scripts/export-urdu-proofread.mjs
import { writeFileSync } from 'node:fs';
import { PHRASE_SECTIONS, PHRASES_UR } from '../src/lib/phrasesUr.ts';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rows = (dict) => Object.entries(dict).sort((a, b) => a[0].localeCompare(b[0]))
  .map(([en, ur], i) => `<tr><td class="n">${i + 1}</td><td class="en" dir="ltr">${esc(en)}</td><td class="ur" dir="rtl" lang="ur">${esc(ur)}</td><td class="ok"></td></tr>`).join('\n');
const sections = Object.entries(PHRASE_SECTIONS).map(([name, dict]) => `<h2>${esc(name)} <small>${Object.keys(dict).length} phrases</small></h2>
<table><thead><tr><th>#</th><th>English (as on the screen)</th><th>اردو</th><th>✔ / correction</th></tr></thead><tbody>
${rows(dict)}
</tbody></table>`).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DT apps — Urdu proofreading sheet</title><style>
body{font-family:Inter,system-ui,sans-serif;margin:0;padding:20px 4vw 60px;color:#1b1330;background:#fff;line-height:1.5}
h1{margin:0 0 4px;font-size:24px}p.lead{margin:0 0 22px;color:#5b5470;max-width:70ch}
h2{margin:34px 0 8px;font-size:19px}h2 small{font-weight:500;color:#7b7490;font-size:13px}
table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #ece8f3;padding:8px 10px;vertical-align:top;text-align:left}
th{color:#5b5470;font-weight:600;background:#faf8fd;position:sticky;top:0}td.n{color:#9a94ad;width:38px}td.en{width:42%}
td.ur{font-size:18px;line-height:1.9;width:40%;font-family:"Noto Nastaliq Urdu","Noto Naskh Arabic","Jameel Noori Nastaleeq",serif;text-align:right}td.ok{width:12%}
@media print{th{position:static}h2{break-before:page}h2:first-of-type{break-before:auto}}
</style></head><body>
<h1>DT Rider · DT Order Taker · DT Owner — Urdu proofreading sheet</h1>
<p class="lead">${Object.keys(PHRASES_UR).length} phrases. Read the Urdu column against the English: tick it, or write the better wording in the last column. Words in <b>{n}</b> / <b>{}</b> are where a number or a name goes. Some English lines are only a piece of a longer sentence (for example “is complete. Nice work,”) because the screen draws the sentence in pieces.</p>
${sections}
</body></html>`;
writeFileSync(new URL('../docs/qa/urdu-proofread-sheet.html', import.meta.url), html);
console.log('rows:', Object.keys(PHRASES_UR).length);
