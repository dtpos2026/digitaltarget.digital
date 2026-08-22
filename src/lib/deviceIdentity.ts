// ============================================================================
// DEVICE IDENTITY — one physical machine, one approved device
//
// THE PROBLEM
// getDeviceId() mints a random uuid and keeps it in localStorage. localStorage
// is scoped to the browser PROFILE, so one Windows PC opened in Chrome, Edge
// and Firefox produces three ids, three registrations and three approval
// requests. A restaurant with a handful of machines and staff who switch
// browsers ends up with a device list nobody can read.
//
// WHAT IS AND IS NOT POSSIBLE
// A web page cannot read a machine serial. There is no honest way to prove
// "this is the same PC" across browser profiles — anything that claims to is a
// fingerprint, and a fingerprint both COLLIDES (two identical machines bought
// together look the same) and DRIFTS (a browser update changes the user agent).
//
// So the fingerprint here is a *hint*, never the identity and never the
// security boundary:
//
//   • The identity stays the random per-profile id. It is unguessable.
//   • The fingerprint lets the SERVER merge registrations that are very
//     probably the same machine, so the operator sees one device.
//   • Approval still gates access, RLS still scopes by tenant, and the caller
//     still needs valid credentials for that restaurant. Someone who forges a
//     fingerprint gains nothing they could not already reach.
//   • Crucially, a merged device inherits BLOCKED as well as APPROVED —
//     otherwise blocking a machine could be undone by opening another browser.
//
// ELECTRON
// The desktop shell can expose a real per-installation id. When
// window.electronAPI.getMachineId() exists it is used verbatim and no
// fingerprint guessing happens at all. That is the accurate path; the browser
// one is the best approximation available.
// ============================================================================

const FP_KEY = 'dtpos-device-fingerprint';

function stableHash(input: string): string {
  // FNV-1a over four seeds — the same construction supabaseStore uses for
  // deterministic ids. No crypto needed: this is a grouping key, not a secret.
  const words: number[] = [];
  for (let seed = 0; seed < 4; seed++) {
    let h = 0x811c9dc5 ^ (seed * 0x9e3779b9);
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    words.push(h >>> 0);
  }
  return words.map(w => w.toString(16).padStart(8, '0')).join('');
}

/**
 * Traits that describe the MACHINE rather than the browser.
 *
 * Deliberately excluded:
 *   • userAgent / browser version — differs per browser, and changes on every
 *     update, which would split one machine into a new device every few weeks.
 *   • IP address — the brief rules it out, and rightly: it changes with wifi,
 *     hotspots and VPNs, and is shared by every device behind one router.
 *   • Canvas / WebGL / font probing — higher entropy, but that is exactly what
 *     makes it tracking rather than device management.
 */
function collectTraits(): string {
  if (typeof navigator === 'undefined' || typeof screen === 'undefined') return '';
  const n = navigator as any;
  const parts = [
    // Screen geometry is a property of the monitor, not the browser.
    `${screen.width}x${screen.height}x${screen.colorDepth}`,
    // Reported identically by every browser on the same OS install.
    String(n.hardwareConcurrency ?? ''),
    String(n.deviceMemory ?? ''),
    String(n.platform ?? ''),
    String(n.maxTouchPoints ?? ''),
    (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })(),
  ];
  return parts.join('|');
}

/**
 * A stable, low-entropy grouping key for this machine, or '' when it cannot be
 * computed. Cached so a browser that later reports a trait differently does not
 * silently become a second device.
 */
export function getDeviceFingerprint(): string {
  try {
    const cached = localStorage.getItem(FP_KEY);
    if (cached) return cached;
  } catch { /* storage unavailable */ }

  const traits = collectTraits();
  if (!traits) return '';
  const fp = stableHash(traits);
  try { localStorage.setItem(FP_KEY, fp); } catch { /* ignore */ }
  return fp;
}

/**
 * Electron's per-installation id, when the shell provides one.
 *
 * This is a real answer rather than an approximation, so it is preferred over
 * the fingerprint. Returns null in a browser and in any Electron build whose
 * preload does not expose it — never throws.
 */
export async function getNativeMachineId(): Promise<string | null> {
  try {
    const api = (globalThis as any).window?.electronAPI;
    if (!api?.getMachineId) return null;
    const id = await api.getMachineId();
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  } catch { return null; }
}

/**
 * What register_device() should be told about this machine.
 *
 * `hardwareId` remains the per-profile identity. `fingerprint` is the merge
 * hint the server may use to recognise the same machine in another browser.
 */
export async function describeDevice(hardwareId: string): Promise<{
  hardwareId: string; fingerprint: string; native: boolean;
}> {
  const native = await getNativeMachineId();
  if (native) {
    // A real installation id needs no guessing, and is stable across every
    // browser surface the shell hosts.
    return { hardwareId: native, fingerprint: stableHash(native), native: true };
  }
  return { hardwareId, fingerprint: getDeviceFingerprint(), native: false };
}
