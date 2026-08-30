// ============================================================================
// v1.29.6 — the Super Admin map pin shows the restaurant's own logo.
//
// REPORTED: "Super Admin map par restaurant ka apna logo aana chahiye, ye 'B'
// wala generic marker nahi."
//
// The pin has always DRAWN r.logo, with the first letter of the name only as a
// fallback. It always drew the letter, because the loader asked PostgREST for
// tenant_settings.data — a column that does not exist. tenant_settings is
// (tenant_id, branch_id, settings, updated_at); verified against the live
// schema. PostgREST answers 42703, sRes.data came back null on every load, and
// nothing noticed because only tRes.error was ever checked.
//
// Assertions run against the source with comments stripped, so the prose above
// cannot satisfy any of them.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const RAW = readFileSync(resolve(process.cwd(), 'src/pages/SuperAdminPage.tsx'), 'utf8');

/** The file as the compiler sees it — no line or block comments, no JSX comments. */
const SRC = RAW
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !l.trim().startsWith('//'))
  .join('\n');

describe('the Super Admin map reads the settings document that actually exists', () => {
  it('selects the settings column, not a column named data', () => {
    expect(SRC).toContain("from('tenant_settings').select('tenant_id,settings')");
  });

  it('never asks tenant_settings for a `data` column anywhere in the panel', () => {
    // One typo in one select emptied the map of every logo, every phone number
    // and the single-branch lat/lng fallback.
    const selects = SRC.match(/from\('tenant_settings'\)[\s\S]{0,80}?select\((['"])([^'"]*)\1\)/g) ?? [];
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) {
      expect(s, s).not.toMatch(/\bdata\b/);
    }
  });

  it('reads the row through .settings', () => {
    expect(SRC).toContain('settingsByTid[r.tenant_id] = r.settings ?? {}');
    expect(SRC).not.toContain('settingsByTid[r.tenant_id] = r.data ?? {}');
  });

  it('still takes the pin logo from the restaurant\'s own POS settings', () => {
    // appLogo is the field the POS admin screen offers for the app icon.
    expect(SRC).toContain('logo: st.appLogo || st.logo || st.webPortalLogo');
  });

  it('draws the logo when there is one and the initial only as a fallback', () => {
    const at = SRC.indexOf('const logoHtml = r.logo');
    expect(at).toBeGreaterThan(-1);
    const block = SRC.slice(at, at + 700);
    expect(block).toContain('<img src="${escape(r.logo)}"');
    expect(block).toContain("(r.name || '?').charAt(0).toUpperCase()");
    // the image comes first — the letter is the else branch
    expect(block.indexOf('<img src=')).toBeLessThan(block.indexOf('charAt(0)'));
  });
});

describe('a failed query no longer disappears', () => {
  it('reports every non-fatal query that failed, by table name', () => {
    const at = SRC.indexOf('if (tRes.error) throw tRes.error;');
    expect(at).toBeGreaterThan(-1);
    const after = SRC.slice(at, at + 900);
    for (const t of ['pending_owners', 'devices', 'branches', 'tenant_settings']) {
      expect(after, t).toContain(`'${t}'`);
    }
    expect(after).toContain('console.error');
    expect(after).toContain('res.error');
  });

  it('does not make them fatal — the panel is still useful without devices', () => {
    const at = SRC.indexOf('if (tRes.error) throw tRes.error;');
    const after = SRC.slice(at + 40, at + 900);
    expect(after).not.toContain('throw');
  });
});
