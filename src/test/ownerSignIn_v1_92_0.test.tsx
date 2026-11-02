// ============================================================
// v1.92.0 — the Owner app's start screen and sign-in in the app's own look (OWN-01, OWN-02, OWN-03).
//
// What is pinned:
//   • the Owner app is recognised by its route (#/owner-app) and nothing else, so the till's sign-in is exactly what
//     it was on every other route;
//   • on that route the frame is the phone screen of the design — purple header, the mark with the crown, the form's
//     own card over it, dark when the owner chose dark — and it still carries the form it is given;
//   • the start screen (OWN-01);
//   • the sign-in's logic is where it was: the device-approval wait uses ONE decision for the live listener and for
//     "Check again", and the Owner app's wording is shown only on its route.
// ============================================================
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { isOwnerAppRoute } from '@/lib/appEntry';
import LoginShell from '@/components/LoginShell';
import OwnerSplash from '@/components/OwnerSplash';

const read = (p: string) => readFileSync(p, 'utf8');
afterEach(() => { cleanup(); window.location.hash = ''; localStorage.clear(); });
beforeEach(() => { localStorage.clear(); });

describe('which app is this', () => {
  it('only the Owner app route', () => {
    for (const h of ['#/owner-app', '#/owner-app/', '#/owner-app/more', '/owner-app/orders', '#/owner-app?x=1']) expect(isOwnerAppRoute(h), h).toBe(true);
    for (const h of ['', '#/', '#/owner', '#/owner-management', '#/rider-portal', '#/order-taker', '#/owner-apps', '#/dashboard']) expect(isOwnerAppRoute(h), h).toBe(false);
  });
});

describe('the sign-in frame', () => {
  it('on the Owner app route: the phone screen, with the form inside and no brand panel', () => {
    window.location.hash = '#/owner-app';
    render(<LoginShell><form data-testid="form">fields</form></LoginShell>);
    const frame = document.querySelector('[data-owner-login]') as HTMLElement;
    expect(frame).toBeTruthy();
    expect(frame).toHaveClass('dt-owner');
    expect(frame).toHaveAttribute('data-theme', 'light');
    expect(frame).toHaveTextContent('DT Owner');
    expect(frame).toHaveTextContent('Your restaurants, from anywhere');
    expect(frame.querySelector('[data-owner-mark]')).toBeTruthy();
    expect(screen.getByTestId('form')).toBeInTheDocument();
    expect(document.querySelector('[data-login-brand]')).toBeNull();
  });

  it('dark when the owner chose dark', () => {
    window.location.hash = '#/owner-app';
    localStorage.setItem('owner-theme', 'dark');
    render(<LoginShell><span /></LoginShell>);
    expect(document.querySelector('[data-owner-login]')).toHaveAttribute('data-theme', 'dark');
  });

  it('on every other route: the till\'s sign-in, exactly as before', () => {
    window.location.hash = '#/';
    render(<LoginShell><form data-testid="form">fields</form></LoginShell>);
    expect(document.querySelector('[data-owner-login]')).toBeNull();
    expect(document.querySelector('[data-login-brand]')).toBeTruthy();
    expect(screen.getByTestId('form')).toBeInTheDocument();
  });
});

describe('the start screen', () => {
  it('purple, the mark with its crown, the name and the powered-by line', () => {
    render(<OwnerSplash />);
    const s = screen.getByRole('status', { name: 'Loading DT Owner' });
    expect(s).toHaveTextContent('DT Owner');
    expect(s).toHaveTextContent('Powered by Digital Target');
    expect(s.querySelector('[data-owner-mark]')).toBeTruthy();
  });
});

describe('the logic is where it was', () => {
  const login = read('src/pages/OwnerLoginPage.tsx');
  it('the approval wait: one decision for the live listener and for "Check again"', () => {
    expect(login).toContain('approvalCbRef.current = onApprovalState;');
    expect(login).toContain('watchDeviceApproval(reg.deviceId, onApprovalState)');
    expect(login).toContain('await approvalCbRef.current?.({ approved: !!row.approved, blocked: !!row.blocked })');
    // blocked → signed out, approved → carry on: still in that one function
    const fn = login.slice(login.indexOf('const onApprovalState'), login.indexOf('approvalCbRef.current = onApprovalState'));
    expect(fn).toContain('if (s.blocked)');
    expect(fn).toContain('await authSignOut()');
    expect(fn).toContain('startDeviceHeartbeat(reg.deviceId)');
    expect(fn).toContain("onSuccess({ superAdmin: false })");
  });
  it('the Owner app\'s wording and Check again appear only on its route', () => {
    expect(login).toContain('const ownerApp = isOwnerAppRoute();');
    expect(login).toMatch(/\{ownerApp && \(\s*<Button className="w-full" disabled=\{checking\}/);
    expect(login).toContain("{ownerApp ? 'Sign in with another account' : 'Cancel & Logout'}");
    expect(login).toContain('Aap ka device');   // the till's wording is still there
  });
  it('the app shows the start screen for the Owner route while it loads', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('if (isOwnerAppRoute() && !initTimedOut) return <OwnerSplash />;');
    expect(app).toContain('<Suspense fallback={<OwnerSplash />}>');
  });
});
