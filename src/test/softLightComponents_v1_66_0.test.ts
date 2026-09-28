// v1.66.0 — Soft Light component polish must not leak into any other theme.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/index.css', 'utf8');
const start = css.indexOf('SOFT LIGHT — component polish');
const block = css.slice(start);

describe('Soft Light component polish', () => {
  it('exists', () => { expect(start).toBeGreaterThan(0); });

  it('every selector in the block is scoped to [data-theme="soft-light"]', () => {
    const selectors = block.split('\n')
      .filter(l => /\{\s*$/.test(l) && !l.trim().startsWith('/*') && !l.trim().startsWith('*'))
      .map(l => l.replace(/\{\s*$/, '').trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(8);
    for (const s of selectors) expect(s.startsWith('[data-theme="soft-light"]')).toBe(true);
  });

  it('hard-codes no hex or rgb colour — it follows the theme variables', () => {
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/rgba?\(/);
  });
});
