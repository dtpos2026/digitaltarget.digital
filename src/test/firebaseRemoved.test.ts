// ============================================================
// Tests — v1.24.0 Firebase is gone
//
// The SDK is uninstalled and every `firebase/*` import resolves to a local
// stub. These lock that in: the package must not creep back via a merge, and
// no Firebase endpoint or project identifier may appear in a build.
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('the Firebase SDK is not a dependency', () => {
  it('firebase is absent from dependencies', () => {
    expect(pkg.dependencies?.firebase).toBeUndefined();
    expect(pkg.devDependencies?.firebase).toBeUndefined();
  });

  it('no firebase package is installed', () => {
    expect(fs.existsSync(path.join(root, 'node_modules', 'firebase'))).toBe(false);
  });
});

describe('firebase imports resolve to the local stub', () => {
  const stub = path.join(root, 'src', 'lib', 'firebaseStub.ts');

  it('the stub exists', () => {
    expect(fs.existsSync(stub)).toBe(true);
  });

  it('the build aliases every firebase entry point', () => {
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    for (const m of ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage']) {
      // vite.config.ts uses double quotes; the assertion must not care which.
      expect(vite).toMatch(new RegExp(`['\"]${m.replace('/', '\\/')}['\"]`));
    }
  });

  it('the tests alias them too, so tests exercise what ships', () => {
    const vt = fs.readFileSync(path.join(root, 'vitest.config.ts'), 'utf8');
    expect(vt).toContain('firebaseStub');
  });

  it('a live Firestore call throws a NAMED error rather than failing silently', async () => {
    // If an unguarded legacy path is ever reached, it must say so clearly —
    // a silent no-op there could lose a bill without anyone noticing.
    const m: any = await import('@/lib/firebaseStub');
    expect(() => m.getDocs()).toThrow(/firebase-removed/i);
    expect(() => m.setDoc()).toThrow(/firebase-removed/i);
    expect(() => m.getAuth()).toThrow(/firebase-removed/i);
  });

  it('sign-out never throws — logging out must always work', () => {
    // A throw here would trap a user in a session they asked to leave.
    return import('@/lib/firebaseStub').then((m: any) => m.signOut());
  });

  it('onSnapshot attaches nothing and returns an unsubscribe', async () => {
    const m: any = await import('@/lib/firebaseStub');
    const off = m.onSnapshot();
    expect(typeof off).toBe('function');
    off();
  });
});

describe('no Firebase identifiers remain in source', () => {
  function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') sourceFiles(p, out); }
      else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it('no hardcoded API key', () => {
    const offenders = sourceFiles(path.join(root, 'src'))
      .filter(f => /AIzaSy[A-Za-z0-9_-]{20,}/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no retired firebase hosting domain in customer-facing links', () => {
    // A stale *.web.app base would send QR menus and track-order links to a
    // site that is no longer the product.
    const offenders = sourceFiles(path.join(root, 'src'))
      .filter(f => {
        const src = fs.readFileSync(f, 'utf8');
        return /https:\/\/[a-z0-9-]+\.web\.app/.test(src);
      });
    expect(offenders).toEqual([]);
  });

  it('the super-admin allow-list no longer ships in the bundle', () => {
    // It used to name the accounts holding platform-wide power, readable by
    // anyone who opened devtools. Super admins live in the database now.
    const fb = fs.readFileSync(path.join(root, 'src', 'lib', 'firebase.ts'), 'utf8');
    const arr = /SUPER_ADMIN_EMAILS:\s*string\[\]\s*=\s*\[([^\]]*)\]/.exec(fb);
    expect(arr).not.toBeNull();
    expect(arr![1].replace(/\s|\/\/.*$/gm, '')).toBe('');
  });
});
