// ============================================================================
// v1.60.0 — two things a restaurant could not get past
//
// 1. A NEW RESTAURANT HAD A PASSWORD NOBODY HAD EVER SEEN
//
//    REPORTED: "default user hota ha user pass jb resturant create hota ha
//    super admin sy, or nzr ana chyi mujy super admin me ky user ky pass kya
//    ha ... qky some time login nhi hota ... ye meny last time set krwaya tha
//    nhi howa."
//
//    sa_create_restaurant has ALWAYS returned pos_username and pos_password —
//    the random one it mints for the `admin` POS login. The panel read
//    neither. Its toast said "POS user: admin" and stopped, so the password
//    existed for exactly as long as the RPC's reply and was then
//    unrecoverable: it is stored bcrypt-hashed and cannot be read back.
//
//    That is the whole reason a new restaurant "sometimes does not log in".
//
// 2. PRA ONLY WORKED ON WINDOWS
//
//    REPORTED: "ye medul web py kam nhi krta, web py b kam kry".
//
//    Two transports, and they are NOT equally fixable:
//
//      LOCAL  http://localhost:8524 — the fiscal device on the till. A browser
//        CAN address http://localhost (it is potentially trustworthy, so the
//        old "mixed content" explanation was wrong), but the device sends no
//        Access-Control-Allow-Origin and Chrome demands a Private Network
//        Access preflight. Both belong to PRAL's device. A proxy cannot help:
//        our server is not on the restaurant's LAN. Windows stays the route.
//
//      CLOUD  https://ims.pral.com.pk — blocked only by CORS, which is a
//        BROWSER rule. Through our own server it works, exactly as it does in
//        Electron.
//
//    Saying the local device works on the web would leave a restaurant
//    believing it is filing with PRA when it is not.
// ============================================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripTs = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const panel     = stripTs(read('src/pages/SuperAdminPage.tsx'));
const praFns    = stripTs(read('src/lib/pra.functions.ts'));
const transport = stripTs(read('src/lib/praTransport.ts'));

describe('a new restaurant is handed its own credentials', () => {
  it('reads the username and password the RPC already returned', () => {
    expect(panel).toContain('pos_username?: string; pos_password?: string;');
    expect(panel).toContain('posPassword: r.pos_password');
  });

  it('keeps them across a refresh — a toast could not', () => {
    // v1.56.2 cost three live accounts to exactly this mistake.
    expect(panel).toContain("sessionStorage.getItem(JUST_CREATED_KEY)");
    expect(panel).toContain('sessionStorage.setItem(JUST_CREATED_KEY');
  });

  it('confirms before discarding the only copy', () => {
    expect(panel).toContain('cannot be shown again');
    expect(panel).toContain('window.confirm(');
  });

  it('shows the workspace code the staff apps ask for, alongside it', () => {
    expect(panel).toContain('workspaceCode: wsCode');
  });
});

describe('PRA cloud works from a browser', () => {
  it('goes through our own server, where CORS does not apply', () => {
    expect(transport).toContain("await import('./pra.functions')");
    expect(transport).toContain('praCloudRequest(');
  });

  it('only the cloud host is routed that way', () => {
    expect(transport).toMatch(/ims\\\.pral\\\.com\\\.pk/);
  });

  it('a failure is reported, never swallowed into a fake success', () => {
    expect(transport).toContain("return { success: false, error: e?.message || 'Could not reach the PRA service' };");
  });
});

describe('the proxy cannot be turned into an open relay', () => {
  it('refuses any host but PRAL', () => {
    expect(praFns).toContain("const PRAL_HOST = 'ims.pral.com.pk';");
    expect(praFns).toContain('parsed.hostname === PRAL_HOST');
  });

  it('refuses plain http', () => {
    expect(praFns).toContain("parsed.protocol === 'https:'");
  });

  it('only GET and POST, and a bounded timeout', () => {
    expect(praFns).toContain("z.enum(['GET', 'POST'])");
    expect(praFns).toContain('.min(1000).max(60000)');
  });
});

describe('the local fiscal device is not claimed to work on the web', () => {
  it('still sends browsers to the desktop app for the device', () => {
    expect(transport).toContain('use the Windows desktop app for the local device');
  });

  it('no longer blames mixed content, which was not the reason', () => {
    const fn = transport.slice(transport.indexOf('export function praBrowserLimitation'));
    expect(fn.slice(0, 900)).not.toContain('mixed content');
  });

  it('and the cloud transport is no longer flagged as a browser limitation', () => {
    expect(transport).toContain('return null;');
    expect(transport).not.toContain('may be blocked from a browser by CORS');
  });
});
