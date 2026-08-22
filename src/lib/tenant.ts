// Holds the current tenant (restaurant) ID after the owner logs in via Firebase.
// All Firestore reads/writes in store.ts are scoped to this tenant.

const TENANT_KEY = 'pos-tenant-id';
const TENANT_NAME_KEY = 'pos-tenant-name';

let _tenantId: string | null = localStorage.getItem(TENANT_KEY);
let _tenantName: string | null = localStorage.getItem(TENANT_NAME_KEY);

export function getTenantId(): string | null {
  return _tenantId;
}

export function getTenantName(): string | null {
  return _tenantName;
}

export function setTenant(id: string, name?: string) {
  const prev = _tenantId;
  _tenantId = id;
  _tenantName = name || null;
  localStorage.setItem(TENANT_KEY, id);
  if (name) localStorage.setItem(TENANT_NAME_KEY, name);
  // Notify store.ts to drop any in-memory cache from the previous tenant.
  if (prev !== id) {
    try { window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: prev, to: id } })); } catch {}
  }
}

export function clearTenant() {
  const prev = _tenantId;
  _tenantId = null;
  _tenantName = null;
  localStorage.removeItem(TENANT_KEY);
  localStorage.removeItem(TENANT_NAME_KEY);
  // Remove legacy global cache so old data never leaks into a new tenant login.
  try { localStorage.removeItem('desi-pos-data'); } catch {}
  // Notify listeners — sessionIsolation.ts will hard-wipe localStorage,
  // sessionStorage, IndexedDB (Firestore offline) and CacheStorage so the
  // next login on the same browser starts 100% clean.
  if (prev) {
    try { window.dispatchEvent(new CustomEvent('pos-tenant-change', { detail: { from: prev, to: null } })); } catch {}
  }
}

export function requireTenantId(): string {
  if (!_tenantId) throw new Error('No tenant selected. Owner must log in first.');
  return _tenantId;
}

// Device fingerprint — random UUID per machine. Stored locally.
const DEVICE_KEY = 'pos-device-id';
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = (crypto as any).randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export interface DeviceMeta {
  deviceId: string;
  browser: string;
  browserVersion?: string;
  os: string;
  deviceName: string;
  deviceType?: 'mobile' | 'tablet' | 'desktop';
  platform?: 'electron' | 'web';
  appVersion?: string;
  screen?: string;
  language?: string;
  timezone?: string;
  hostname?: string;
  cpuCores?: number;
  memoryGb?: number;
  /** effectiveType — 2g / 3g / 4g / 5g (browser API hint). */
  connectionType?: string;
  /** Downlink Mbps from Network Information API. */
  downlinkMbps?: number;
  /** Round trip time ms. */
  networkRtt?: number;
  /** True if user enabled data-saver. */
  saveData?: boolean;
  touchSupport?: boolean;
  /** Machine MAC addresses (Electron only). First non-internal NIC. */
  macAddresses?: string[];
  /** OS-level logged-in username (Electron only). */
  osUser?: string;
  /** CPU model (Electron only). */
  cpuModel?: string;
}

export function getDeviceMeta(): DeviceMeta {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let browser = 'Unknown';
  let browserVersion: string | undefined;
  const match = (re: RegExp) => { const m = ua.match(re); return m?.[1]; };
  if (/Edg\//.test(ua)) { browser = 'Edge'; browserVersion = match(/Edg\/([\d.]+)/); }
  else if (/Chrome\//.test(ua)) { browser = 'Chrome'; browserVersion = match(/Chrome\/([\d.]+)/); }
  else if (/Firefox\//.test(ua)) { browser = 'Firefox'; browserVersion = match(/Firefox\/([\d.]+)/); }
  else if (/Safari\//.test(ua)) { browser = 'Safari'; browserVersion = match(/Version\/([\d.]+)/); }

  let os = 'Unknown';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10/11';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  // Device type
  let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';
  if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) deviceType = 'tablet';
  else if (/Mobile|iPhone|iPod|Android.*Mobile/i.test(ua)) deviceType = 'mobile';

  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
  const platform: 'electron' | 'web' = isElectron ? 'electron' : 'web';

  let screen: string | undefined;
  let timezone: string | undefined;
  let language: string | undefined;
  let cpuCores: number | undefined;
  let memoryGb: number | undefined;
  let connectionType: string | undefined;
  let downlinkMbps: number | undefined;
  let networkRtt: number | undefined;
  let saveData: boolean | undefined;
  let touchSupport: boolean | undefined;
  let appVersion: string | undefined;
  try {
    if (typeof window !== 'undefined' && window.screen) {
      screen = `${window.screen.width}x${window.screen.height}`;
    }
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    language = navigator.language;
    cpuCores = (navigator as any).hardwareConcurrency || undefined;
    memoryGb = (navigator as any).deviceMemory || undefined;
    const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (conn?.effectiveType) connectionType = conn.effectiveType;
    if (typeof conn?.downlink === 'number') downlinkMbps = conn.downlink;
    if (typeof conn?.rtt === 'number') networkRtt = conn.rtt;
    if (typeof conn?.saveData === 'boolean') saveData = conn.saveData;
    touchSupport = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
  } catch {}

  return {
    deviceId: getDeviceId(),
    browser,
    browserVersion,
    os,
    // deviceName is finalized by enrichDeviceMeta() once electron hostname resolves.
    deviceName: `${browser} on ${os}`,
    deviceType,
    platform,
    appVersion,
    screen,
    language,
    timezone,
    cpuCores,
    memoryGb,
    connectionType,
    downlinkMbps,
    networkRtt,
    saveData,
    touchSupport,
  };
}

/**
 * Async version — pulls real OS hostname (DESKTOP-XXXX), MAC addresses and OS
 * username when running inside Electron. On web it returns the sync meta as-is.
 */
export async function enrichDeviceMeta(base?: DeviceMeta): Promise<DeviceMeta> {
  const meta = base || getDeviceMeta();
  const api = typeof window !== 'undefined' ? (window as any).electronAPI : null;
  if (api?.getSystemInfo) {
    try {
      const sys = await api.getSystemInfo();
      if (sys && !sys.error) {
        meta.hostname = sys.hostname || meta.hostname;
        meta.macAddresses = sys.macAddresses || undefined;
        meta.osUser = sys.userInfo || undefined;
        meta.cpuModel = sys.cpuModel || undefined;
        if (typeof sys.cpuCount === 'number') meta.cpuCores = sys.cpuCount;
        if (typeof sys.totalMemGb === 'number') meta.memoryGb = sys.totalMemGb;
        if (sys.hostname) {
          // Prefer the real machine name as the deviceName.
          meta.deviceName = `${sys.hostname} (${meta.browser})`;
        }
      }
    } catch { /* ignore */ }
  }
  return meta;
}

/** Fetch public IP + approximate location (city, country). Best-effort, no API key required. */
export async function fetchDeviceNetworkInfo(): Promise<{ ip?: string; city?: string; region?: string; country?: string; isp?: string }> {
  try {
    const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
    if (!res.ok) throw new Error('ipapi failed');
    const j = await res.json();
    return {
      ip: j.ip,
      city: j.city,
      region: j.region,
      country: j.country_name,
      isp: j.org,
    };
  } catch {
    try {
      const res = await fetch('https://api.ipify.org?format=json');
      const j = await res.json();
      return { ip: j.ip };
    } catch { return {}; }
  }
}
