// ============================================================================
// REPORTED: "kuch module click karo, white screen."
//
// App.tsx lazy-loads 75 pages and the only ErrorBoundary wrapped the WHOLE
// app, so one page's crash tore down the till around it and left nothing on
// screen to report. These cases render the boundary for real — react-dom into
// happy-dom, no new dependency — and prove a broken page now fails alone and
// says which route it was.
// ============================================================================
import { describe, it, expect, vi, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import PageBoundary from '@/components/PageBoundary';

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(ui: React.ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(ui); });
  return host;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  host?.remove();
  host = null; root = null;
});

function Boom({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

describe('a broken page fails alone', () => {
  it('shows the failure instead of a blank screen, and names the route', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const el = mount(
      <PageBoundary route="/credit-customers">
        <Boom message="something exploded" />
      </PageBoundary>,
    );
    const text = el.textContent ?? '';
    expect(text).toMatch(/could not open/i);
    expect(text).toContain('/credit-customers');   // so a report can name the module
    expect(text).toContain('something exploded');
    err.mockRestore();
  });

  it('a healthy page is untouched', () => {
    const el = mount(<PageBoundary route="/"><div>the till</div></PageBoundary>);
    expect(el.textContent).toContain('the till');
  });

  it('offers a retry that remounts only the page', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    const Flaky = (): React.ReactElement => {
      if (shouldThrow) throw new Error('first time fails');
      return <div>the page works now</div>;
    };
    const el = mount(<PageBoundary route="/reports"><Flaky /></PageBoundary>);
    expect(el.textContent).toMatch(/could not open/i);

    shouldThrow = false;
    const retry = Array.from(el.querySelectorAll('button'))
      .find(b => /try again/i.test(b.textContent ?? ''));
    expect(retry, 'a Try again button must be offered').toBeTruthy();
    act(() => { retry!.click(); });
    expect(el.textContent).toContain('the page works now');
    err.mockRestore();
  });

  it('re-throws a stale-chunk error so the app-level boundary can reload', () => {
    // Two components racing to clear caches and reload is worse than one.
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => mount(
      <PageBoundary route="/super-admin">
        <Boom message="Failed to fetch dynamically imported module: /assets/x.js" />
      </PageBoundary>,
    )).toThrow(/dynamically imported module/);
    err.mockRestore();
  });
});

describe('it is wired around the routed page, not the whole app', () => {
  it('App renders it inside the layout', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync('src/App.tsx', 'utf8');
    // Inside AppLayout, so the sidebar survives a page crash.
    expect(app).toContain('<RoutedPageBoundary>');
    expect(app.indexOf('<RoutedPageBoundary>')).toBeGreaterThan(app.indexOf('<AppLayout'));
    expect(app.indexOf('</RoutedPageBoundary>')).toBeLessThan(app.indexOf('</AppLayout>'));
  });
});
