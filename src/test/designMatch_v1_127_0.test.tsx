// v1.127.0 — the page header follows the design package (no icon tile before the title), and the design-match board and plan are in the repository.
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inbox } from 'lucide-react';
import { PageHeader, PageTitle } from '@/components/layout/PageFrame';

const read = (p: string) => readFileSync(resolve(__dirname, '../..', p), 'utf8');

describe('the page header', () => {
  it('the package draws a plain title (24 px) and one muted line — and that is what sw-06.html says', () => {
    const sw06 = read('design-project/02-restaurant-software/screens/sw-06.html');
    expect(sw06).toContain('<div class="t-h1" style="font-size:24px;line-height:32px">Orders</div>');
    expect(sw06).not.toMatch(/<div class="t-h1"[^>]*>[^<]*<svg/);
  });
  it('PageTitle and PageHeader still carry the icon in the markup, marked so DT Refined can leave it out', () => {
    const a = render(<PageTitle icon={Inbox} subtitle="Today">Orders</PageTitle>);
    expect(a.container.querySelector('[data-page-icon]')).not.toBeNull();
    expect(a.container.querySelector('[data-page-title]')!.textContent).toBe('Orders');
    a.unmount();
    const b = render(<PageHeader title="Orders" subtitle="Today" icon={<Inbox />} />);
    expect(b.container.querySelector('[data-page-icon]')).not.toBeNull();
  });
  it('DT Refined hides it inside the page area; no other look is touched', () => {
    const css = read('src/styles/ui-screen.css');
    expect(css).toContain('html[data-ui="modern"][data-ui-theme="dt-refined"] [data-ui-shell="content"] [data-page-icon] { display: none; }');
    expect(css.match(/\[data-page-icon\] \{ display: none; \}/g)).toHaveLength(1);
  });
});

describe('the board and the plan', () => {
  it('are in the repository, and the board output is not', () => {
    for (const f of ['scripts/design-board/README.md', 'scripts/design-board/build-harness.py', 'scripts/design-board/board.cjs', 'scripts/design-board/compose.py', 'docs/design-match/PLAN.md']) {
      expect(existsSync(resolve(__dirname, '../..', f))).toBe(true);
    }
    expect(read('.gitignore')).toContain('.design-board/');
  });
  it('the harness page is never committed', () => {
    expect(existsSync(resolve(__dirname, '../shotHarness.tsx'))).toBe(false);
    expect(existsSync(resolve(__dirname, '../routes/shot.tsx'))).toBe(false);
  });
  it('the plan names the shell items and the order of work', () => {
    const plan = read('docs/design-match/PLAN.md');
    for (const s of ['S1', 'S2', 'S3', 'SW-03 POS', 'SW-06 Orders', 'SW-10 Tables', 'SW-13 Menu', 'v1.128.0']) expect(plan).toContain(s);
  });
});
