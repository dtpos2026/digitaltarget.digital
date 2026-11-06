// v1.110.0 — the privacy policy page: public route, says what the software really does, names the restaurant, tells how to ask.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import PrivacyPolicyPage, { PRIVACY_SECTIONS } from '@/pages/PrivacyPolicyPage';
import { getSettings, saveSettings } from '@/lib/store';

afterEach(cleanup);

describe('privacy policy page', () => {
  it('is one public route, outside the signed-in shell, and linked from Settings → Privacy', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/<Route path="\/privacy" element=\{<PrivacyPolicyPage \/>\} \/>/);
    expect(app.indexOf('path="/privacy"')).toBeLessThan(app.indexOf('path="/rider-portal"'));
    expect(readFileSync('src/components/settings/PrivacyCard.tsx', 'utf8')).toContain('href="#/privacy"');
  });
  it('says what is kept, why, who sees it, how long, the customer’s choices and how it is protected — and that no card number is stored', () => {
    expect(PRIVACY_SECTIONS.map(s => s.id)).toEqual(['what', 'why', 'share', 'long', 'rights', 'safe']);
    render(<PrivacyPolicyPage />);
    const page = screen.getByTestId('privacy-policy').textContent || '';
    expect(page).toMatch(/does not keep your card number/i);
    expect(page).toMatch(/erase/i);
    expect(page).toMatch(/never sold/i);
    expect(page).toMatch(/within 30 days/);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
  it('names the restaurant and its phone', () => {
    saveSettings({ ...getSettings(), name: 'Gold Kitchen', phone1: '0300 1112223' });
    render(<PrivacyPolicyPage />);
    const page = screen.getByTestId('privacy-policy').textContent || '';
    expect(page).toContain('Gold Kitchen');
    expect(page).toContain('0300 1112223');
  });
});
